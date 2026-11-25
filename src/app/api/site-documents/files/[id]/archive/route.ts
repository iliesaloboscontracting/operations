import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { AGENT_NO_WRITE } from "@/lib/siteDocs/rules";
import { archiveFile, isAgent } from "@/lib/siteDocs/office";

// POST { note } -> 201 - archive a file: hidden from the supervisors' links, never deleted; the archive is its own row
// (who, when, why), once (409 the second time). Managers, Admins and the coordinator; never the Building Agent login.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  if (isAgent(g.user)) return NextResponse.json({ error: AGENT_NO_WRITE }, { status: 403 });
  const raw = await req.json().catch(() => ({}));
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = await archiveFile(g.user, (await paramsP).id, body);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});