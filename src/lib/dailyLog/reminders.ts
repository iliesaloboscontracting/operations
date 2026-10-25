// The daily log reminder (Task K; A2, approved by Ilies): at 19:00 Sydney (a
// night shift: 2 hours after it finishes), if a pilot job ran and has no
// log, one push to the job's supervisor link(s): "No daily log for Swiss
// Hotel yet - 60 seconds: tap to log." At most once per job per day
// (ShiftReminder kind DAILY_LOG, claimed before sending), none after 21:00.
// Kill switch: A2_RULES / DAILY_LOG_REMINDER=off (lib/dailyLog/rules.ts).
// Run once a minute from instrumentation.ts.
import { prisma } from "../prisma";
import { pushToSiteLinks } from "../push";
import { effectiveTimes, jobFinish } from "../shiftTimes";
import { reminderEnabled } from "./rules";
import { reminderDue, sydneyDay } from "./checks";
import { pilotPeople } from "./store";

const dayBefore = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

export async function remindDailyLogs(now = new Date()): Promise<{ sent: string[] }> {
  const sent: string[] = [];
  if (!reminderEnabled()) return { sent };
  const people = await pilotPeople();
  if (!people.size) return { sent };
  const today = sydneyDay(now);
  const jobs = await prisma.job.findMany({
    where: {
      date: { in: [dayBefore(today), today].map((d) => new Date(`${d}T00:00:00.000Z`)) },
      status: { notIn: ["INACTIVE", "STOOD_DOWN"] },
      assignments: { some: { resourceId: { in: [...people.keys()] } } },
    },
    select: {
      id: true, date: true, shift: true, startTime: true, endTime: true,
      project: { select: { name: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: { select: { resourceId: true, resource: { select: { type: true } } } },
      _count: { select: { attendances: { where: { status: { not: "REJECTED" } } }, dailyLogs: true } },
    },
  });
  for (const j of jobs) {
    const day = j.date.toISOString().slice(0, 10);
    const t = effectiveTimes(j, j.project);
    if (!reminderDue({ date: day, shift: j.shift, finish: jobFinish(day, j.shift, t.start, t.end) }, now)) continue;
    if (j._count.dailyLogs > 0) continue;
    const ran = j._count.attendances > 0 || j.assignments.some((a) => a.resource.type === "PERSONNEL");
    if (!ran) continue;
    if (await prisma.shiftReminder.findUnique({ where: { jobId_kind: { jobId: j.id, kind: "DAILY_LOG" } } })) continue;
    // Claim it first - the unique row stops a second send if two checks overlap.
    const claimed = await prisma.shiftReminder.create({ data: { jobId: j.id, kind: "DAILY_LOG", people: j._count.attendances } }).catch(() => null);
    if (!claimed) continue;
    const pilotLinks = j.assignments.flatMap((a) => people.get(a.resourceId) ?? []);
    const handovers = await prisma.siteLink.findMany({ where: { kind: "HANDOVER", jobId: j.id, revokedAt: null, expiresAt: { gt: now } }, select: { id: true } });
    const linkIds = [...new Set([...pilotLinks, ...handovers.map((h) => h.id)])];
    sent.push(j.id);
    await pushToSiteLinks(
      linkIds,
      { title: "Daily log", body: `No daily log for ${j.project?.name ?? "this job"} yet - 60 seconds: tap to log.`, url: "?go=log", tag: `dailylog-${j.id}` },
      "normal",
    ).catch((e) => console.error("daily log reminder", e));
  }
  return { sent };
}
