import { NextRequest, NextResponse } from "next/server";
import { guardChanges } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { countToApprove, createProposal, listChanges, projectsForPicker } from "@/lib/changes/store";

// Controlled changes (LCI phase 4, A3):
// GET  ?open=1          -> proposals waiting for a decision (the kinds this login may see)
//      &audience=COMMERCIAL -> contract values only (the Directors overview box)
// GET  ?recordId=<id>   -> everything proposed for one record
// GET                   -> the change log (latest 300)
// GET  ?count=1         -> { count } of waiting proposals this login could approve (nav badge)
// GET  ?projects=1      -> projects to pick from (names and numbers only)
// POST { kind, recordId, offHireDate | contractValue(+Notes) | jobNo | quoteNo, reason, sources[], sourcePerson? }
//      -> a new proposal. Nothing changes until a different person approves it.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardChanges();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams;
  if (q.get("count") === "1") return NextResponse.json({ count: await countToApprove(g.user) });
  if (q.get("projects") === "1") return NextResponse.json({ projects: await projectsForPicker() });
  const audience = q.get("audience") === "COMMERCIAL" ? "COMMERCIAL" : undefined; // the Directors overview box
  return NextResponse.json({ changes: await listChanges(g.user, { open: q.get("open") === "1", recordId: q.get("recordId") ?? undefined, audience }) });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardChanges();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await createProposal(g.user, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.proposal.id, number: out.proposal.number }, { status: 201 });
});
