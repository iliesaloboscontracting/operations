import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { exportLines, timesheetCsv, weekStartOf } from "@/lib/timesheets";

// GET /api/timesheets/export?week=YYYY-MM-DD -> the week's staff timesheet as
// a CSV spreadsheet for accounts. An approved week exports exactly what was
// approved; otherwise it's the live sign-ins marked DRAFT.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const { approval, lines, travel } = await exportLines(weekStart);
  const csv = timesheetCsv(weekStart, lines, approval, travel);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="Lobos timesheet week ${weekStart}${approval ? "" : " DRAFT"}.csv"`,
    },
  });
});
