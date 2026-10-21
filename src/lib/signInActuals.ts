// Day Review hours filled in from site sign-ins (21 Oct 2026, Ilies): once
// someone on a job has signed out - and nothing of theirs there is waiting
// for the supervisor - their signed-in hours (added up if they signed in more
// than once) go into Day Review's hours box. Labour hire sign-ins count on the
// tile they fill (lib/labourHireMatch.ts). Hours someone typed are never
// overwritten; ones filled from sign-ins (hoursSource SIGN_IN) follow later
// corrections. Closed days are left alone.
import { prisma } from "./prisma";
import { signInHoursForJobs } from "./attendanceView";

export async function syncSignInActuals(jobIds: string[]) {
  if (jobIds.length === 0) return;
  const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, date: true } });
  const closed = new Set(
    (await prisma.dayClose.findMany({
      where: { date: { in: [...new Set(jobs.map((j) => j.date.toISOString().slice(0, 10)))] }, status: "CLOSED" },
      select: { date: true },
    })).map((c) => c.date)
  );
  const open = jobs.filter((j) => !closed.has(j.date.toISOString().slice(0, 10))).map((j) => j.id);
  if (open.length === 0) return;

  // Hours per job + person, only once every one of their sign-ins there is
  // signed out and none is waiting for the supervisor.
  const signIns = await signInHoursForJobs(open);
  const totals = new Map<string, number | null>();
  for (const s of signIns) {
    if (!s.jobId || !s.resourceId) continue;
    const key = `${s.jobId}|${s.resourceId}`;
    const ready = s.hours != null && !s.toConfirm;
    const prev = totals.has(key) ? totals.get(key)! : 0;
    totals.set(key, ready && prev != null ? prev + s.hours! : null);
  }

  const existing = await prisma.jobActual.findMany({ where: { jobId: { in: open } } });
  const byKey = new Map(existing.map((a) => [`${a.jobId}|${a.resourceId}`, a]));

  for (const [key, hours] of totals) {
    if (hours == null) continue;
    const [jobId, resourceId] = key.split("|");
    const a = byKey.get(key);
    const rounded = Math.round(hours * 4) / 4;
    if (!a) {
      await prisma.jobActual.create({ data: { jobId, resourceId, attended: true, actualHours: rounded, hoursSource: "SIGN_IN" } });
    } else if (a.hoursSource === "SIGN_IN" ? a.actualHours !== rounded : a.actualHours == null) {
      await prisma.jobActual.update({ where: { id: a.id }, data: { attended: true, actualHours: rounded, hoursSource: "SIGN_IN" } });
    }
  }
  // Filled from sign-ins, but those sign-ins no longer count (rejected,
  // reopened or moved): clear the hours rather than leave a stale figure.
  for (const a of existing) {
    if (a.hoursSource === "SIGN_IN" && totals.get(`${a.jobId}|${a.resourceId}`) == null) {
      await prisma.jobActual.update({ where: { id: a.id }, data: { actualHours: null, hoursSource: null } });
    }
  }
}

// For the sign-in routes: never let a Day Review refresh break a sign-in.
export function syncSignInActualsQuietly(jobIds: (string | null | undefined)[]) {
  const ids = jobIds.filter((x): x is string => !!x);
  return syncSignInActuals(ids).catch((e) => console.error("Day Review sign-in hours sync failed", e));
}
