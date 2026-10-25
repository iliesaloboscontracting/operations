import { NextRequest, NextResponse } from "next/server";
import { guardChanges } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { decide } from "@/lib/changes/store";

// POST /api/changes/:id
//   { action: "APPROVE", fingerprint }  -> run the change (re-checked first); refused unless a different,
//                                          eligible person approves the exact proposal they saw
//   { action: "REJECT", reason }        -> an eligible approver turns it down
//   { action: "WITHDRAW" }              -> the person who proposed it takes it back
//   { action: "UNDO" }                  -> a new proposal setting an executed change back (needs approval again)
// Every refused attempt is logged on the proposal.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardChanges();
  if ("denied" in g) return g.denied;
  const { id } = await paramsP;
  const body = await req.json().catch(() => ({}));
  const out = await decide(g.user, id, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.proposal.id, number: out.proposal.number, status: out.proposal.status });
});
