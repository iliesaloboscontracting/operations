// The frozen AllocationCost ledger for one date (Phase 3), written when a day is closed. Keep forever (Ilies, 10 Nov
// 2026): the date's earlier rows are marked superseded (supersededAt / By) and kept - never deleted - and a fresh set
// is written in the same transaction, so only current rows count (Tracking reads supersededAt null).
// PS-030 (Ilies approved, 10 Nov 2026): the costs are worked out BEFORE the transaction, read-only (planDayCosts). The
// short transaction then takes the write lock first, checks the day still reads the same (dayFingerprint - jobs,
// times, allocations, rates), and only then supersedes and writes. Two closes at once still leave one current ledger:
// each transaction supersedes everything current before it writes its own set.
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { costAllocation } from "./costAllocation";

type Db = Prisma.TransactionClient | typeof prisma;
export type LedgerRow = {
  assignmentId: string; jobId: string; resourceId: string; projectId: string;
  date: string; costType: string; amount: number | null; status: string | null;
};

// Marks a date's current ledger rows superseded (a re-open, or the start of a fresh close). Returns how many.
export async function supersedeDayCosts(tx: Prisma.TransactionClient, date: string, by: string) {
  const n = await tx.allocationCost.updateMany({ where: { date, supersededAt: null }, data: { supersededAt: new Date(), supersededBy: by.slice(0, 120) } });
  return n.count;
}

const RESOURCE_COST = {
  id: true, type: true, category: true, name: true, dailyRateExGst: true,
  payRateBasis: true, ordinaryRate: true, nightRate: true, saturdayRate: true, sundayRate: true,
  payRateConfirmed: true, hireRate: true, hireRateUnit: true, updatedAt: true,
} as const;

function readDay(db: Db, date: string) {
  return db.job.findMany({
    where: { date: new Date(date + "T00:00:00.000Z"), projectId: { not: null }, cancelledAt: null },
    orderBy: { id: "asc" },
    include: {
      project: { select: { id: true, unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true, updatedAt: true } },
      assignments: { orderBy: { id: "asc" }, include: { resource: { select: RESOURCE_COST } } },
    },
  });
}
type Day = Awaited<ReturnType<typeof readDay>>;

// Everything the costs depend on, as one string: each job (times, shift, last change), its project's hours, and each
// allocation with its resource's last change (rates). Equal strings = the same costs.
function fingerprintOf(jobs: Day): string {
  return JSON.stringify(jobs.map((j) => [
    j.id, j.shift, j.startTime, j.endTime, j.updatedAt.toISOString(), j.project?.id, j.project?.updatedAt.toISOString(),
    j.assignments.map((a) => [a.id, a.resourceId, a.resource.updatedAt.toISOString()]),
  ]));
}
export async function dayFingerprint(db: Db, date: string) {
  return fingerprintOf(await readDay(db, date));
}

// Read-only: the rows a close would freeze, and the fingerprint they were worked out from.
export async function planDayCosts(date: string): Promise<{ rows: LedgerRow[]; fingerprint: string }> {
  const jobs = await readDay(prisma, date);
  const rows: LedgerRow[] = [];
  for (const j of jobs) {
    if (!j.project) continue;
    const shift = j.shift as "DAY" | "NIGHT";
    for (const a of j.assignments) {
      const result = costAllocation(date, shift, j.startTime, j.endTime, j.project, a.resource);
      if (!result.costType) continue;
      rows.push({
        assignmentId: a.id, jobId: j.id, resourceId: a.resourceId, projectId: j.project.id,
        date, costType: result.costType, amount: result.amount, status: result.status,
      });
    }
  }
  return { rows, fingerprint: fingerprintOf(jobs) };
}

// Inside the close's transaction: the earlier set superseded, the planned set written.
export async function writeDayCosts(tx: Prisma.TransactionClient, date: string, rows: LedgerRow[], by: string) {
  await supersedeDayCosts(tx, date, by);
  if (rows.length) await tx.allocationCost.createMany({ data: rows });
  return rows.length;
}
