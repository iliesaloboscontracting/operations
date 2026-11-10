// PS-031 (Ilies approved, 10 Nov 2026): a sign-in on a job is only ever made on a job that isn't cancelled - checked in
// the same transaction as the create, so a cancel (lib/jobCancel.ts, which counts sign-ins inside its own transaction)
// and a sign-in can never both go through. Both transactions WRITE first (here the sign-in itself, there the job's
// status), so SQLite takes the write lock before either checks the other - one waits for the other, never both pass.
// Every path that makes a sign-in comes here. Null = the job was cancelled; nothing was saved.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const JOB_CANCELLED_SIGN_IN = "That job has been cancelled - ask the office.";
class JobCancelled extends Error {}

export async function createSignIn(data: Prisma.SiteAttendanceUncheckedCreateInput) {
  if (!data.jobId) return prisma.siteAttendance.create({ data });
  const jobId = data.jobId;
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.siteAttendance.create({ data });
      if (!(await tx.job.count({ where: { id: jobId, cancelledAt: null } }))) throw new JobCancelled(); // rolls the create back
      return row;
    });
  } catch (e) {
    if (e instanceof JobCancelled) return null;
    throw e;
  }
}
