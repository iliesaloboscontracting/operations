import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { timesheetWeek, weekStartOf } from "@/lib/timesheets";
import { noticeSeen, TIMESHEETS_EXPLAINER } from "@/lib/accountsTimesheets";

// GET /api/accounts/timesheets?week=YYYY-MM-DD -> the week's staff timesheets, read-only, for the Accounts screen
// (2 Nov 2026, Ilies: "no changes just export button for her pay roll"). The same week the Managers see on
// /timesheets, plus whether this login has pressed "Got it" on the how-it-works notice. View only - there is no
// POST here; approving, reopening and changing sign-ins stay on the Operations routes, which refuse ACCOUNTS.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const [week, seen] = await Promise.all([timesheetWeek(weekStart), noticeSeen(g.user.id)]);
  return NextResponse.json({ ...week, explainerSeen: seen, explainer: TIMESHEETS_EXPLAINER });
});
