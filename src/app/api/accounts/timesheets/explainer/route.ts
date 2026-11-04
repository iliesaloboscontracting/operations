import { NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { markNoticeSeen, noticeSeen, TIMESHEETS_EXPLAINER } from "@/lib/accountsTimesheets";

// GET /api/accounts/timesheets/explainer -> the "How sign-ins and timesheets work" words and whether this login has
// pressed "Got it" - for the Accounts dashboard (4 Nov 2026), which shows the notice without loading a week.
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ seen: await noticeSeen(g.user.id), explainer: TIMESHEETS_EXPLAINER });
});

// POST /api/accounts/timesheets/explainer -> "Got it" on the how-timesheets-work notice: recorded once per login
// (NoticeSeen), so it doesn't come up again. Pressing it again changes nothing. Touches no timesheet data.
export const POST = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ ok: true, ...(await markNoticeSeen(g.user.id)) });
});
