import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { assignTender } from "@/lib/tenders/board";
import { estimatingWords, safeId } from "@/lib/tenders/rules";

// POST /api/directors/tenders/:id/assign { version, assignee, reason } -> Estimating PUT /api/tenders/:id/assign.
// Director access here; Estimating then checks the person (from this session, never the browser) is an issuer.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await paramsP;
  if (!safeId(id)) return NextResponse.json({ error: "Unknown tender." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const version = Number(b?.version);
  const assignee = typeof b?.assignee === "string" ? b.assignee.trim().slice(0, 40) : "";
  const reason = typeof b?.reason === "string" ? b.reason.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 300) : "";
  if (!Number.isInteger(version)) return NextResponse.json({ error: "Refresh and try again." }, { status: 400 });
  if (assignee && !/^[a-z0-9_-]{1,40}$/.test(assignee)) return NextResponse.json({ error: "Unknown person." }, { status: 400 });
  if (reason.length < 3) return NextResponse.json({ error: "Say why (a few words)." }, { status: 400 });
  const r = await assignTender(id, { version, assignee, reason }, user.name);
  if (r.status !== 200) return NextResponse.json({ error: estimatingWords(r.status, r.body?.code, r.body?.error) }, { status: r.status === 0 ? 502 : r.status });
  return NextResponse.json({ ok: true });
});
