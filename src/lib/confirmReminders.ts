// A: the supervisor's reminder about poster sign-ins still waiting to be confirmed (Ilies, 10 Nov 2026: "do A and B").
// On Mon 9 Nov eight poster sign-ins at Rivkin House were still unconfirmed a day later. Now, at 3:30pm Sydney on the
// job's day (a night shift: 30 min after it finishes), a job with poster sign-ins still TO_CONFIRM gets one push to
// its supervisor's link: "3 sign-ins at Rivkin House are waiting for you to confirm – open your link." Once per job
// (a ShiftReminder row, kind CONFIRM_POSTER, is claimed before sending, so a restart or two overlapping ticks never
// send twice). Names and counts only, never a figure. CONFIRM_REMINDER=off stops it. Run once a minute from
// instrumentation.ts; nothing about confirming changes.
import { prisma } from "./prisma";
import { pushToSiteLinks } from "./push";
import { effectiveTimes } from "./shiftTimes";
import { CONFIRM_REMINDER, confirmReminderDue, confirmReminderTargets, confirmReminderText, sydneyDay } from "./signinFlags";

const RUNNING = { notIn: ["COMPLETED", "INACTIVE", "STOOD_DOWN"] };
const dayBefore = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
export const confirmReminderOff = () => (process.env[CONFIRM_REMINDER.switchEnv] ?? "").trim().toLowerCase() === "off";

export async function remindUnconfirmedPosters(now = new Date()): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  if (confirmReminderOff()) return { sent };
  const today = sydneyDay(now);
  // Yesterday too: last night's night shift is reminded this morning.
  const jobs = await prisma.job.findMany({
    where: {
      date: { in: [dayBefore(today), today].map((d) => new Date(`${d}T00:00:00.000Z`)) },
      status: RUNNING,
      notRunning: false,
      attendances: { some: { status: "TO_CONFIRM", removedAt: null } },
    },
    select: {
      id: true, date: true, title: true, shift: true, startTime: true, endTime: true,
      project: { select: { name: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: { where: { resource: { type: "PERSONNEL" } }, select: { resourceId: true, role: true } },
      _count: { select: { attendances: { where: { status: "TO_CONFIRM", removedAt: null } } } },
    },
  });
  for (const j of jobs) {
    const day = j.date.toISOString().slice(0, 10);
    const t = effectiveTimes(j, j.project);
    if (!confirmReminderDue({ date: day, shift: j.shift, start: t.start, end: t.end }, now)) continue;
    const count = j._count.attendances;
    if (!count) continue;
    if (await prisma.shiftReminder.findUnique({ where: { jobId_kind: { jobId: j.id, kind: CONFIRM_REMINDER.kind } } })) continue;
    // Claim it first - the unique (jobId, kind) row stops a second send.
    const claimed = await prisma.shiftReminder.create({ data: { jobId: j.id, kind: CONFIRM_REMINDER.kind, people: count } }).catch(() => null);
    if (!claimed) continue;
    sent.push(j.id);
    const crewIds = j.assignments.map((a) => a.resourceId);
    const [supervisorLinks, handovers] = await Promise.all([
      prisma.siteLink.findMany({ where: { kind: "SUPERVISOR", revokedAt: null, resourceId: { in: crewIds } }, select: { id: true, resourceId: true } }),
      prisma.siteLink.findMany({ where: { kind: "HANDOVER", jobId: j.id, revokedAt: null, expiresAt: { gt: now } }, select: { id: true } }),
    ]);
    const linkIds = confirmReminderTargets(j.assignments, supervisorLinks, handovers.map((h) => h.id));
    if (!linkIds.length) continue;
    const msg = confirmReminderText(count, j.project?.name ?? j.title);
    await pushToSiteLinks(linkIds, { ...msg, url: "?go=signin", tag: `confirm-${j.id}` }, "high").catch((e) => console.error("confirm reminder", e));
  }
  return { sent };
}
