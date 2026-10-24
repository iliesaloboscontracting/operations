// Sign-out reminders (24 Oct 2026): 20 minutes before a job's finish time on
// the board, if anyone on that job is still signed in, the job's supervisors
// get a phone alert ("Swiss Hotel finishes 3:30pm - 4 still signed in").
// Sent once per job (ShiftReminder). A job with no times of its own uses its
// project's usual hours for that shift; with neither (or unclear ones) it
// gets no reminder - those are flagged to Ilies by the daily check instead.
// Run once a minute from instrumentation.ts.
import { prisma } from "./prisma";
import { pushToSiteLinks } from "./push";
import { effectiveTimes, jobFinish } from "./shiftTimes";
import { todaySydney } from "./today";

const BEFORE_MIN = 20;
const LATE_LIMIT_MIN = 60; // server was down at the time? still send up to an hour after the finish

const dayBefore = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function remindBeforeFinish() {
  const now = Date.now();
  const today = todaySydney();
  // Yesterday too: a night shift that started yesterday finishes this morning.
  const days = [dayBefore(today), today];
  const jobs = await prisma.job.findMany({
    where: { date: { in: days.map((d) => new Date(`${d}T00:00:00.000Z`)) }, status: { notIn: ["COMPLETED", "INACTIVE", "STOOD_DOWN"] } },
    select: {
      id: true, date: true, shift: true, startTime: true, endTime: true,
      project: { select: { name: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: { select: { resourceId: true } },
    },
  });
  for (const j of jobs) {
    const times = effectiveTimes(j, j.project); // the job's own, else the project's usual hours
    const finish = jobFinish(j.date.toISOString().slice(0, 10), j.shift, times.start, times.end);
    if (!finish) continue;
    const due = finish.getTime() - BEFORE_MIN * 60_000;
    if (now < due || now > finish.getTime() + LATE_LIMIT_MIN * 60_000) continue;
    if (await prisma.shiftReminder.findUnique({ where: { jobId_kind: { jobId: j.id, kind: "SIGNOUT_20" } } })) continue;

    const still = await prisma.siteAttendance.findMany({
      where: { jobId: j.id, signOutAt: null, status: { not: "REJECTED" } },
      select: { workerName: true, resource: { select: { name: true } } },
    });
    // Claim it first - the unique row stops a second send if two checks overlap.
    const claimed = await prisma.shiftReminder.create({ data: { jobId: j.id, kind: "SIGNOUT_20", people: still.length } }).catch(() => null);
    if (!claimed || !still.length) continue;

    const links = await prisma.siteLink.findMany({
      where: {
        revokedAt: null,
        OR: [
          { kind: "SUPERVISOR", resourceId: { in: j.assignments.map((a) => a.resourceId) } },
          { kind: "HANDOVER", jobId: j.id, expiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true },
    });
    const names = still.map((a) => a.resource?.name ?? a.workerName);
    const shown = names.slice(0, 5).join(", ") + (names.length > 5 ? ` +${names.length - 5} more` : "");
    await pushToSiteLinks(
      links.map((l) => l.id),
      {
        title: `${j.project?.name ?? "Site"} finishes ${times.end}`,
        body: `${names.length} still signed in: ${shown}. Tap to sign them out.`,
        url: "?go=signin",
        tag: `signout-${j.id}`,
      },
      "high",
    ).catch((e) => console.error("sign-out reminder", e));
  }
}
