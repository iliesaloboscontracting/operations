// Writes the frozen AllocationCost ledger for one date (Phase 3). Called
// when a day is closed. Wholesale replaces any existing rows for that date,
// so closing again after a correction never leaves stale rows behind.
import { prisma } from "./prisma";
import { costAllocation } from "./costAllocation";

export async function freezeDayCosts(date: string) {
  const jobs = await prisma.job.findMany({
    where: { date: new Date(date + "T00:00:00.000Z"), projectId: { not: null } },
    include: {
      project: { select: { id: true, unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: {
        include: {
          resource: {
            select: {
              id: true, type: true, category: true, name: true, dailyRateExGst: true,
              payRateBasis: true, ordinaryRate: true, nightRate: true, saturdayRate: true, sundayRate: true,
              payRateConfirmed: true, hireRate: true, hireRateUnit: true,
            },
          },
        },
      },
    },
  });

  const rows: {
    assignmentId: string; jobId: string; resourceId: string; projectId: string;
    date: string; costType: string; amount: number | null; status: string | null;
  }[] = [];

  for (const j of jobs) {
    if (!j.project) continue;
    const shift = j.shift as "DAY" | "NIGHT";
    for (const a of j.assignments) {
      const result = costAllocation(date, shift, j.startTime, j.endTime, j.project, a.resource);
      if (!result.costType) continue;
      rows.push({
        assignmentId: a.id,
        jobId: j.id,
        resourceId: a.resourceId,
        projectId: j.project.id,
        date,
        costType: result.costType,
        amount: result.amount,
        status: result.status,
      });
    }
  }

  await prisma.$transaction([
    prisma.allocationCost.deleteMany({ where: { date } }),
    ...(rows.length ? [prisma.allocationCost.createMany({ data: rows })] : []),
  ]);

  return rows.length;
}
