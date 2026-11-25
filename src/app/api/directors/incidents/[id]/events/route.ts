import { NextRequest, NextResponse } from "next/server";
import { guardIncidents } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addIncidentEvent } from "@/lib/siteDocs/incidents";

// POST { kind: INVESTIGATION | ACTION | CLOSED | REOPENED, note, from } -> 201 { status } - a follow-up note (append-only;
// the report itself is never touched): Open -> Investigating -> Closed, reopen with why. A stale page 409. The owner and
// DIRECTOR logins only.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardIncidents();
  if ("denied" in g) return g.denied;
  const raw = await req.json().catch(() => ({}));
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = await addIncidentEvent((await paramsP).id, g.user, body);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});