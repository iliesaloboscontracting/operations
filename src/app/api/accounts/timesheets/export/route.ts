import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { exportLines, weekStartOf } from "@/lib/timesheets";
import { accountsTimesheetCsv } from "@/lib/accountsTimesheets";

// GET /api/accounts/timesheets/export?week=YYYY-MM-DD -> the week's staff timesheet as a CSV for payroll, from the
// Accounts screen. The same file as the Managers' "Export for accounts" (lib/timesheets.ts timesheetCsv): a locked
// week exports exactly what was approved, otherwise the live sign-ins marked DRAFT. Hours only - it must pass the
// payroll file check (fileIsSafe) or it isn't sent.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const { approval, lines } = await exportLines(weekStart);
  const csv = accountsTimesheetCsv(weekStart, lines, approval);
  if (csv == null) return NextResponse.json({ error: "This week's timesheet has something that looks like bank, tax or rate details in a note - not sent. Ask the office to check it." }, { status: 409 });
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Lobos timesheet week ${weekStart}${approval ? "" : " DRAFT"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
