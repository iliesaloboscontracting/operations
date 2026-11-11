import { NextRequest, NextResponse } from "next/server";
import { guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { weekStartOf } from "@/lib/timesheets";
import { labourHireWeek } from "@/lib/labourHire/load";
import { labourHireCsv, labourHireFileName } from "@/lib/labourHire/export";

// GET /api/timesheets/labour-hire/export?week=YYYY-MM-DD&company=<key>|all -> that week and company as the staff
// timesheet's spreadsheet (lib/labourHire/export.ts), e.g. Advanced-Labour-Hire_week-2026-11-09.csv. Managers, Admins and
// the coordinator (Ilies, 11 Nov 2026). Hours only: a file that fails the no-money check is refused, never sent.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("week");
  const weekStart = weekStartOf(q && isISODate(q) ? q : todaySydney());
  const week = await labourHireWeek(weekStart, (req.nextUrl.searchParams.get("company") ?? "all").slice(0, 120));
  const csv = labourHireCsv(weekStart, week, week.companies);
  if (csv == null) return NextResponse.json({ error: "The file didn't pass the no-money check, so it wasn't made." }, { status: 422 });
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${labourHireFileName(week, week.companies, weekStart)}"`,
      "Cache-Control": "no-store",
    },
  });
});
