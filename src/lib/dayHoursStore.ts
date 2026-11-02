// Loads what ./dayHours.ts needs: every sign-in (not rejected) of the same people on the same days as the lines
// asked about - a site line's hours depend on that person's truck, office or other-site lines that day (one break
// per day, overlaps counted once). Used where only some of a day's lines are in hand (Approve hours, Day Review /
// JobActual, the Sign-ins page); timesheets and payroll load whole weeks and call dayHours directly.
import { prisma } from "./prisma";
import { POINT_BREAK_MINUTES } from "./signin";
import { dayHours, personKeyFor, type DayLine, type LineHours } from "./dayHours";

type Who = { id: string; date: string; resourceId: string | null; workerName: string; company: string | null };

export const breakOf = (r: { jobId: string | null; job?: { project: { unpaidBreakMinutes: number | null } | null } | null }) =>
  r.jobId ? r.job?.project?.unpaidBreakMinutes ?? 0 : POINT_BREAK_MINUTES;

export async function dayHoursFor(rows: Who[]): Promise<Map<string, LineHours>> {
  if (!rows.length) return new Map();
  const dates = [...new Set(rows.map((r) => r.date))];
  const staff = [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
  const hireNames = [...new Set(rows.filter((r) => !r.resourceId).map((r) => r.workerName))];
  const all = await prisma.siteAttendance.findMany({
    where: {
      date: { in: dates }, status: { not: "REJECTED" },
      OR: [...(staff.length ? [{ resourceId: { in: staff } }] : []), ...(hireNames.length ? [{ resourceId: null, workerName: { in: hireNames } }] : [])],
    },
    select: { id: true, date: true, resourceId: true, workerName: true, company: true, signInAt: true, signOutAt: true, jobId: true, job: { select: { project: { select: { unpaidBreakMinutes: true } } } } },
  });
  const wanted = new Set(rows.map((r) => `${personKeyFor(r.resourceId, r.workerName, r.company)}|${r.date}`));
  const lines: DayLine[] = all
    .map((a) => ({ id: a.id, personKey: personKeyFor(a.resourceId, a.workerName, a.company), date: a.date, start: a.signInAt, end: a.signOutAt, breakMinutes: breakOf(a) }))
    .filter((l) => wanted.has(`${l.personKey}|${l.date}`));
  return dayHours(lines);
}
