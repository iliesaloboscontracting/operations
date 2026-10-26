import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { labourCostView } from "@/lib/oncosts/store";

// Accounts -> Labour cost (stage 3, docs/accounts/STAGE3-DESIGN.md). The ACCOUNTS login and Admins only.
// GET ?from&to&project -> own-crew labour from Tracking (reused, not recomputed) plus each on-cost line, per job
// and per week, and the people on one job. Lines with no rate entered are "not set". Tracking is unchanged.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams;
  return NextResponse.json(await labourCostView(q.get("from"), q.get("to"), q.get("project")));
});
