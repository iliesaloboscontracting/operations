import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { costAllocation } from "@/lib/costAllocation";
import { liveJobFields } from "@/lib/jobs";
import type { ResourceType, DayReviewRowDTO } from "@/lib/types";

// GET /api/day-review?date=YYYY-MM-DD -> that date's jobs with planned
// (Assignment) and actual (JobActual) rows merged, plus the day's close
// status. Never carries a dollar figure - costStatus is a data-quality
// signal (rate missing/unconfirmed), not a cost view. See Project Tracking
// for money.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });

  const [close, jobs] = await Promise.all([
    prisma.dayClose.findUnique({ where: { date } }),
    prisma.job.findMany({
      where: { date: new Date(date + "T00:00:00.000Z"), status: { not: "COMPLETED" } },
      orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        project: {
          select: {
            name: true, client: true, jobNo: true, address: true,
            unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true,
          },
        },
        assignments: {
          include: {
            resource: {
              select: {
                id: true, name: true, role: true, type: true, category: true, dailyRateExGst: true,
                payRateBasis: true, ordinaryRate: true, nightRate: true, saturdayRate: true, sundayRate: true,
                payRateConfirmed: true, hireRate: true, hireRateUnit: true,
              },
            },
          },
        },
        jobActuals: { include: { resource: { select: { id: true, name: true, role: true, type: true } } } },
      },
    }),
  ]);

  const NO_WINDOW = { unpaidBreakMinutes: null, dayStart: null, dayEnd: null, nightStart: null, nightEnd: null };
  let uncostedCount = 0;
  let unconfirmedCount = 0;

  const outJobs = jobs.map((j) => {
    const shift = j.shift as "DAY" | "NIGHT";
    const rows = new Map<string, DayReviewRowDTO>();

    for (const a of j.assignments) {
      const result = costAllocation(date, shift, j.startTime, j.endTime, j.project ?? NO_WINDOW, a.resource);
      rows.set(a.resourceId, {
        resourceId: a.resourceId,
        name: a.resource.name,
        role: a.role ?? a.resource.role,
        type: a.resource.type as ResourceType,
        planned: true,
        attended: null,
        actualHours: null,
        notes: null,
        costStatus: result.status,
      });
      if (result.status === "RATE_MISSING" || result.status === "HOURS_UNKNOWN") uncostedCount++;
      if (result.status === "RATE_UNCONFIRMED") unconfirmedCount++;
    }

    for (const ja of j.jobActuals) {
      const existing = rows.get(ja.resourceId);
      if (existing) {
        existing.attended = ja.attended;
        existing.actualHours = ja.actualHours;
        existing.notes = ja.notes;
      } else {
        rows.set(ja.resourceId, {
          resourceId: ja.resourceId,
          name: ja.resource.name,
          role: ja.resource.role,
          type: ja.resource.type as ResourceType,
          planned: false,
          attended: ja.attended,
          actualHours: ja.actualHours,
          notes: ja.notes,
          costStatus: null,
        });
      }
    }

    // A project-linked job shows its project's current name, client and job
    // no, not its own stored copy (lib/jobs.ts).
    const live = liveJobFields(j);
    return {
      id: j.id,
      title: live.title,
      client: live.client,
      siteCode: live.siteCode,
      shift,
      startTime: j.startTime,
      endTime: j.endTime,
      dayBrief: j.dayBrief,
      rows: [...rows.values()],
    };
  });

  return NextResponse.json({
    date,
    dayClose: close ?? { date, status: "OPEN", closedBy: null, closedAt: null, reopenedBy: null, reopenedAt: null, reopenReason: null },
    jobs: outJobs,
    uncostedCount,
    unconfirmedCount,
  });
});
