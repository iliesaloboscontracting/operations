import { NextRequest, NextResponse } from "next/server";
import { guardVariations } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { setStatus } from "@/lib/variations/store";

// POST /api/variations/:id/status { status: TO_PRICE | PRICED | SENT_TO_CLIENT, from, note? } -> the office's status,
// a new VariationStatusEvent (append-only; the signed docket is never touched). The coordinator or a Manager / Admin.
// Back a step needs a note; someone else changed it first (from is stale) -> 409. No amounts in the note.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardVariations();
  if ("denied" in g) return g.denied;
  const raw = await req.json().catch(() => ({}));
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = await setStatus((await paramsP).id, g.user, body);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
