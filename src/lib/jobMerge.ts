// A board job with no project, attached to a project that already has its job for the same day and shift (Ilies,
// 18 Nov 2026, "approve all"): the loose job is MERGED into that job instead - one job per project per day and shift
// (the @@unique on Job) stays true. In ONE transaction:
//   - its allocations move onto the project's job (anyone already on that job stays there once; the loose job's
//     duplicate allocation comes off with the cancel below, kept in its snapshot);
//   - its sign-ins move onto the project's job, each move kept in the sign-in's edit log (AttendanceEdit);
//   - Day Review rows (JobActual) move too, in their history; a typed figure for someone already on the project's
//     job would be lost, so that refuses the merge;
//   - the loose job is cancelled through the ordinary cancel (lib/jobCancel.ts - kept forever, with the reason).
// Nothing is deleted. Refused: different days or shifts, a closed day, an approved (locked) timesheet week, a loose job
// with a daily site log or supervisor-approved hours (those belong to the job they were made on), and a target job
// that is cancelled - a cancelled job is never brought back by a merge (bring it back from the board first, on purpose).
import type { Job } from "@prisma/client";
import { prisma } from "./prisma";
import { CancelAbort, cancelJobInTx } from "./jobCancel";
import { updateTracked, writeLock } from "./history/store";
import { lockedWeekFor } from "./timesheets";
import { isoDay, logBoardEdit, siteName } from "./boardGuard/store";
import { syncSignInActualsQuietly } from "./signInActuals";

export type MergeProblem = { error: string; status: number };
export type MergeDone = { ok: true; moved: { assignments: number; signIns: number; dayReview: number } };

export async function mergeLooseJob(sourceId: string, targetId: string, who: { id: string; name: string }, reason: string): Promise<MergeDone | MergeProblem> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { error: "Say why the jobs are being merged.", status: 400 };
  if (!targetId || targetId === sourceId) return { error: "Pick the project's job to merge into.", status: 400 };
  const [source, target] = await Promise.all([
    prisma.job.findUnique({ where: { id: sourceId } }),
    prisma.job.findUnique({ where: { id: targetId }, include: { project: { select: { name: true } } } }),
  ]);
  if (!source || source.cancelledAt) return { error: "not found", status: 404 };
  if (source.projectId) return { error: "Only a job with no project can be merged into a project's job.", status: 400 };
  if (!target) return { error: "That job isn't on the board any more.", status: 404 };
  if (target.cancelledAt) {
    return { error: "That project's job for the day was cancelled - a merge never brings a cancelled job back. Add the project's job again from the board first, then merge.", status: 409 };
  }
  if (!target.projectId) return { error: "The job to merge into must be on a project.", status: 400 };
  const day = isoDay(source.date);
  if (isoDay(target.date) !== day || target.shift !== source.shift) {
    return { error: "Only a job on the same day and shift can be merged.", status: 400 };
  }
  const closed = await prisma.dayClose.findUnique({ where: { date: day } });
  if (closed?.status === "CLOSED") return { error: `${day} is closed. An Admin needs to re-open it (with a reason) before this can change.`, status: 409 };
  if (await lockedWeekFor(day)) {
    return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its sign-ins can move.", status: 409 };
  }
  const [logs, approvals] = await Promise.all([
    prisma.dailyLog.count({ where: { jobId: sourceId } }),
    prisma.hoursApproval.count({ where: { jobId: sourceId } }),
  ]);
  if (logs > 0) return { error: "A daily site log is recorded on this job, so it can't be merged - it stays with the job it was written on.", status: 409 };
  if (approvals > 0) return { error: "The supervisor has approved hours on this job, so it can't be merged - those approvals stay with the job they were made on.", status: 409 };

  const into = target.project?.name ? `${target.project.name}${target.shift === "NIGHT" ? " (night)" : ""}` : siteName(target);
  const hist = { by: who, source: "Merge into project job", reason: why };
  let moved: MergeDone["moved"];
  try {
    moved = await prisma.$transaction(async (tx) => {
      await writeLock(tx);
      const fresh = await tx.job.findUnique({ where: { id: sourceId } });
      const t = await tx.job.findUnique({ where: { id: targetId }, select: { cancelledAt: true } });
      if (!fresh || fresh.cancelledAt || fresh.projectId) throw new CancelAbort({ error: "That job has just changed - reload the board and try again.", status: 409 });
      if (!t || t.cancelledAt) throw new CancelAbort({ error: "That project's job has just been cancelled - reload the board.", status: 409 });

      // Allocations: onto the project's job, unless that resource is already on it.
      const onTarget = new Set((await tx.assignment.findMany({ where: { jobId: targetId }, select: { resourceId: true } })).map((a) => a.resourceId));
      const rows = await tx.assignment.findMany({ where: { jobId: sourceId }, select: { id: true, resourceId: true } });
      let assignments = 0;
      for (const a of rows) {
        if (onTarget.has(a.resourceId)) continue;
        await tx.assignment.update({ where: { id: a.id }, data: { jobId: targetId } });
        onTarget.add(a.resourceId);
        assignments++;
      }

      // Sign-ins: onto the project's job, each with a line in its edit log.
      const signIns = await tx.siteAttendance.findMany({ where: { jobId: sourceId }, select: { id: true } });
      for (const s of signIns) {
        await tx.siteAttendance.update({
          where: { id: s.id },
          data: { jobId: targetId, edits: { create: [{ field: "job", before: siteName(fresh), after: into, reason: why, editedBy: who.name }] } },
        });
      }

      // Day Review rows: moved in their history; a typed figure that would clash refuses the merge.
      const targetActuals = new Map((await tx.jobActual.findMany({ where: { jobId: targetId } })).map((a) => [a.resourceId, a]));
      let dayReview = 0;
      for (const a of await tx.jobActual.findMany({ where: { jobId: sourceId } })) {
        if (!targetActuals.has(a.resourceId)) {
          await updateTracked("JobActual", a.id, { jobId: targetId }, hist, { tx });
          dayReview++;
        } else if (!a.removedAt && a.hoursSource !== "SIGN_IN" && a.actualHours != null) {
          throw new CancelAbort({ error: "Hours were typed on Day Review for someone who is on both jobs - fix them on Day Review first, then merge.", status: 409 });
        }
        // Otherwise the sign-in figure is worked out again on the project's job (below); the row stays with the
        // cancelled job, which is left out of every list and total.
      }

      // The loose job is cancelled - kept, with the reason (its leftover duplicate allocations go into the snapshot).
      await cancelJobInTx(tx, fresh as Job, who, why, "Merged into the project's job");
      return { assignments, signIns: signIns.length, dayReview };
    });
  } catch (e) {
    if (e instanceof CancelAbort) return e.problem;
    throw e;
  }
  await logBoardEdit(who, day, "JOB_EDIT", `${siteName(source)} merged into ${into}: ${moved.assignments} allocation(s), ${moved.signIns} sign-in(s) moved`);
  await syncSignInActualsQuietly([targetId]);
  return { ok: true, moved };
}
