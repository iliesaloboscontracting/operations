import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOrCoordinator } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView";
import { withErrorHandling } from "@/lib/apiHandler";
import { daysBetween } from "@/lib/dates";
import { todaySydney } from "@/lib/today";
import { boardDatesByProject } from "@/lib/dateExceptions";
import { buildCalendarSpans, isISODay } from "@/lib/calendarSpans";
import { assertNoMoney } from "@/lib/moneyGuard";
import { withoutAmounts } from "@/lib/coordinatorHire";

// GET /api/calendar/spans?from=YYYY-MM-DD&to=YYYY-MM-DD -> each project's planned span (start -> expected completion)
// that overlaps the range, plus the projects with no dates yet (lib/calendarSpans.ts, Ilies 12 Nov 2026).
// Read-only. The same access as /api/calendar: Viewers and up, plus the coordinator - never anyone else.
// No money: a narrow DTO (names, job numbers, dates, flags) - never the contract value or any cost.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("VIEWER");
  if (denied) return denied;
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!isISODay(from) || !isISODay(to) || to < from) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (daysBetween(from, to) > 400) return NextResponse.json({ error: "At most 400 days at a time" }, { status: 400 });

  const today = todaySydney();
  const [projects, boards] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false, status: { not: "COMPLETED" } },
      select: { id: true, name: true, jobNo: true, status: true, archived: true, startDate: true, startDateConfidence: true, expectedCompletion: true },
    }),
    boardDatesByProject(today),
  ]);
  const out = buildCalendarSpans(projects, boards, from, to, today);
  // The DTO carries no money field; a "$" figure typed into a project name is taken out rather than shown.
  return viewJson(assertNoMoney(JSON.stringify(out)) ? out : withoutAmounts(out));
});
