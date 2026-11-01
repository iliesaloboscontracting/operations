import { NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { markNoticeSeen } from "@/lib/accountsTimesheets";

// POST /api/accounts/timesheets/explainer -> "Got it" on the how-timesheets-work notice: recorded once per login
// (NoticeSeen), so it doesn't come up again. Pressing it again changes nothing. Touches no timesheet data.
export const POST = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ ok: true, ...(await markNoticeSeen(g.user.id)) });
});
