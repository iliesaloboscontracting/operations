import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { decisionLog, getBudget } from "@/lib/budgets/estimating";
import { cannotDecide, parseRevision, validEstimateId } from "@/lib/budgets/rules";

type Ctx = { params: Promise<{ id: string; rev: string }> };

// GET /api/directors/budgets/:id/:rev -> one frozen budget.v1 revision, its
// status in Estimating, whether this director can decide it, and the
// decisions made on it from Operations. Director access only.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: Ctx) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const { id, rev: revText } = await params;
  const rev = parseRevision(revText);
  if (!validEstimateId(id) || rev === null) return NextResponse.json({ error: "Budget revision not found" }, { status: 404 });
  const r = await getBudget(id, rev);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({
    ...r.data,
    cannotDecide: cannotDecide(user, { status: r.data.status.status, submitted_by: r.data.budget.submitted_by }),
    log: await decisionLog(id, rev),
  });
});
