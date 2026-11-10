// PS-031 (Ilies approved, 10 Nov 2026): a sign-in on a job is only ever made on a job that isn't cancelled - checked in
// the same transaction as the create, so a cancel (lib/jobCancel.ts, which counts sign-ins inside its own transaction)
// and a sign-in can never both go through. Both transactions WRITE first (here the sign-in itself, there the job's
// status), so SQLite takes the write lock before either checks the other - one waits for the other, never both pass.
// Every path that makes a sign-in comes here. Null = the job was cancelled; nothing was saved.
// PS-034 (Ilies approved, 10 Nov 2026: sign-in must never be blocked): the transaction waits up to 15 s for its turn
// (TX, as the pre-start writes). If it still can't run - a lock or timeout error - the sign-in is saved with the plain
// create, exactly as before PS-031; a cancel's own recount (lib/jobCancel.ts) still catches that race.
const BUSY_CODES = new Set(["P2024", "P2028", "P2034"]);
export const isBusyError = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && BUSY_CODES.has(e.code)) ||
  /database is locked|SQLITE_BUSY|busy|timed out|timeout|Transaction already closed|Unable to start a transaction/i.test(e instanceof Error ? e.message : String(e));
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { TX } from "./prestart/queue";

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
    }, TX);
  } catch (e) {
    if (e instanceof JobCancelled) return null;
    if (!isBusyError(e)) throw e;
    console.error("sign-in: transaction busy - saved with the plain create (PS-034)");
    return prisma.siteAttendance.create({ data });
  }
}
