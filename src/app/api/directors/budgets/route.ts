import { NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { listBudgets } from "@/lib/budgets/estimating";
import { cannotDecide, sortForDirectors } from "@/lib/budgets/rules";

// GET /api/directors/budgets -> budgets submitted from Estimating (Task H,
// 25 Oct 2026): waiting ones first, then decided / superseded. Director
// access only. Commercial: totals and submitted prices are shown here, so
// this never feeds a link or an operational page.
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const r = await listBudgets();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const budgets = sortForDirectors(r.data).map((b) => ({ ...b, cannotDecide: cannotDecide(user, b) }));
  return NextResponse.json({ budgets, waiting: budgets.filter((b) => b.status === "SUBMITTED").length });
});
