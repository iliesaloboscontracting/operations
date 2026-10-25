import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { decideBudget } from "@/lib/budgets/estimating";
import { parseDecision, parseRevision, validEstimateId } from "@/lib/budgets/rules";

type Ctx = { params: Promise<{ id: string; rev: string }> };

// POST /api/directors/budgets/:id/:rev/decision {decision: APPROVED|REJECTED,
// reason, version} -> records a director's decision in Estimating (Task H).
// Director access only, never the submitter. The approval key is added on
// the server and never comes back in a response; a stale version (409) and
// Estimating's own refusals pass through with its message.
export const POST = withErrorHandling(async (req: NextRequest, { params }: Ctx) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const { id, rev: revText } = await params;
  const rev = parseRevision(revText);
  if (!validEstimateId(id) || rev === null) return NextResponse.json({ error: "Budget revision not found" }, { status: 404 });
  const body = parseDecision(await req.json());
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: 400 });
  const r = await decideBudget(user, id, rev, body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ status: r.data });
});
