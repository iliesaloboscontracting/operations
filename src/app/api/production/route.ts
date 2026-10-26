import { NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { productionView } from "@/lib/production/store";
import { EVIDENCE_BAR } from "@/lib/production/benchmarks";

// GET /api/production -> production benchmarks per activity code (LCI 5b): actual vs budget hours per
// unit, the jobs and logs behind each, delay hours, confidence, and what was offered to Estimating with
// the estimator's decision read back. Manager+ read; hours only, never money.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  return NextResponse.json({ ...(await productionView()), canOffer: !!user?.directorAccess, bar: EVIDENCE_BAR });
});
