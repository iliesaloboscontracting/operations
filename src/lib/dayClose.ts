// Writes the frozen AllocationCost ledger for one date (Phase 3). Called
// when a day is closed. Keep forever (Ilies, 10 Nov 2026): the date's earlier
// rows are marked superseded (supersededAt / By) and kept - never deleted - and
// a fresh set is written in the same transaction, so only current rows count
// (Tracking reads supersededAt null).
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

// Marks a date's current ledger rows superseded (a re-open, or the start of a fresh close). Returns how many.
export async function supersedeDayCosts(tx: Prisma.TransactionClient, date: string, by: string) {
  const n = await tx.allocationCost.updateMany({ where: { date, supersededAt: null }, data: { supersededAt: new Date(), supersededBy: by.slice(0, 120) } });
  return n.count;
}
import { costAllocation } from "./costAllocation";

export async function freezeDayCosts(date: string, by = "Day close", tx?: Prisma.TransactionClient) {
  const jobs = await (tx ?? prisma).job.findMany({
    where: { date: new Date(date + "T00:00:00.000Z"), projectId: { not: null }, cancelledAt: null },
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

  const write = async (t: Prisma.TransactionClient) => {
    await supersedeDayCosts(t, date, by);
    if (rows.length) await t.allocationCost.createMany({ data: rows });
  };
  if (tx) await write(tx);
  else await prisma.$transaction(write);

  return rows.length;
}
