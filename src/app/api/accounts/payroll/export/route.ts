import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { weekStartOf } from "@/lib/timesheets";
import { payrollFiles } from "@/lib/payroll/store";

// GET /api/accounts/payroll/export?week=YYYY-MM-DD&file=payrun|summary -> a CSV for Victoria to download.
// payrun: hours per person per pay item per day for the employees she approved, for importing into Xero
// Payroll by hand (Xero stays read-only). summary: everyone's week. Hours only - no bank details, ABA, TFN
// or rates. The ACCOUNTS login and Admins only.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const which = req.nextUrl.searchParams.get("file") === "summary" ? "summary" : "payrun";
  const files = await payrollFiles(weekStart);
  return new NextResponse("﻿" + (which === "summary" ? files.summary : files.payRun), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Lobos ${which === "summary" ? "hours summary" : "pay run hours"} week ${weekStart}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
