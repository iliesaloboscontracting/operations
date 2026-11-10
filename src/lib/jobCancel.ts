// Keep forever (Ilies, 10 Nov 2026): the board's Delete became Cancel. A cancelled job is kept (status CANCELLED,
// cancelledAt / By / Reason) and left out of every list and total (LIVE_JOB in lib/jobs.ts). Its allocations are
// removed - cost allocation reads the live rows - with a full snapshot in BoardEdit, all in one transaction with the
// job's own change history (RecordChange). Adding a job for the same project / day / shift brings it back.
import { prisma } from "./prisma";
import { updateTracked, type Tx, type Who } from "./history/store";
import { logBoardRemoval, isoDay, siteName } from "./boardGuard/store";
import { ASSIGNMENT_FOR_SNAPSHOT, allocationSnapshot, cancelledJobSnapshot } from "./boardGuard/snapshot";

export type CancelProblem = { error: string; status: number };

export async function cancelJob(jobId: string, who: { id: string; name: string }, reason: string): Promise<{ ok: true } | CancelProblem> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { error: "Say why the job is being cancelled.", status: 400 };
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.cancelledAt) return { error: "not found", status: 404 };
  // Sign-ins are the timesheet record and a daily log belongs to its job - a job with either is stood down, not cancelled
  // (as it couldn't be deleted before).
  const [signIns, logs] = await Promise.all([
    prisma.siteAttendance.count({ where: { jobId } }),
    prisma.dailyLog.count({ where: { jobId } }),
  ]);
  if (signIns > 0) {
    return { error: `${signIns} sign-in${signIns === 1 ? " is" : "s are"} recorded on this job, so it can't be cancelled - mark it Stood down instead.`, status: 409 };
  }
  if (logs > 0) return { error: "A daily site log is recorded on this job, so it can't be cancelled - mark it Stood down instead.", status: 409 };

  await prisma.$transaction(async (tx) => {
    const rows = await tx.assignment.findMany({ where: { jobId }, include: ASSIGNMENT_FOR_SNAPSHOT, orderBy: { createdAt: "asc" } });
    const snapshot = { v: 1 as const, kind: "JOB_CANCEL" as const, allocations: rows.map(allocationSnapshot), job: cancelledJobSnapshot(job) };
    if (rows.length) await tx.assignment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await updateTracked("Job", jobId, {
      status: "CANCELLED", cancelledAt: new Date(), cancelledBy: who.name, cancelledById: who.id, cancelReason: why,
    }, { by: who, source: "Cancel job (board)", reason: why }, { tx });
    await logBoardRemoval(tx, who, isoDay(job.date), "JOB_CANCEL",
      `${siteName(job)} cancelled (${rows.length} allocation${rows.length === 1 ? "" : "s"} taken off): ${why}`, snapshot);
  });
  return { ok: true };
}

// A cancelled job for this project / day / shift, if there is one (the unique key still holds it).
export function cancelledJobAt(projectId: string, date: Date, shift: string) {
  return prisma.job.findFirst({ where: { projectId, date, shift, cancelledAt: { not: null } }, select: { id: true } });
}

// Brings a cancelled job back with the new fields - recorded like any edit.
export async function reviveJob(jobId: string, data: Record<string, unknown>, by: Who, source: string, tx?: Tx) {
  return updateTracked("Job", jobId, {
    ...data, cancelledAt: null, cancelledBy: null, cancelledById: null, cancelReason: null,
  }, { by, source, reason: "Added again after it was cancelled" }, { tx });
}
