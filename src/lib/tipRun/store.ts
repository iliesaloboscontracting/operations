// Regional tip run (19 Nov 2026) - loading and saving. Rules in ./rules.ts. Writes TipRun and TipRunEdit only; never a
// sign-in, an allocation or a cost (Day Review's sign-in hours are refreshed by lib/signInActuals.ts, which reads the
// runs). Link-facing answers carry words, times and hours only (assertNoMoney before they leave).
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { countsTo, jobLabel, shiftLabel, STILL_ON_HOURS, sydneyTime } from "../signin";
import { assertNoMoney } from "../moneyGuard";
import { linkLabel } from "../dailyLog/money";
import { lockedWeekFor, weekEnd } from "../timesheets";
import { TRAVEL_CAP_HOURS } from "../travel/rules";
import { startRefusal, TIP_CAP_HOURS, TIP_OFFER_HOURS, tipCorrectionError, tipHours, tipRunOn, tipShifts, tipStillOpen, type TipFlag } from "./rules";

type Problem = { error: string; status: number };
const HOUR = 3_600_000;
// The words the phone shows once a run is finished: the docket goes in through the existing Receipts tile.
export const DOCKET_REMINDER = "Now take a photo of the tip docket on your supervisor's or driver's link (Add receipt → Tip docket).";

// Day Review's sign-in hours for the run's job follow every change (loaded on demand: signInActuals reads this file).
const syncDayReview = (jobId: string) => import("../signInActuals").then((m) => m.syncSignInActualsQuietly([jobId]));

// ---------- the worker's phone ----------

type ShiftRow = { id: string; date: string; signOutAt: Date | null; job: { id: string; date: Date; title: string; shift: string; project: { id: string; name: string; regional: boolean } | null } | null };
// Their sign-ins on regional jobs, signed out in the last 12 hours (the shifts a tip run can follow).
async function recentShifts(resourceId: string, now: Date) {
  const rows: ShiftRow[] = await prisma.siteAttendance.findMany({
    where: { resourceId, jobId: { not: null }, status: { not: "REJECTED" }, removedAt: null, signOutAt: { gte: new Date(now.getTime() - TIP_OFFER_HOURS * HOUR), lte: now }, job: { project: { regional: true } } },
    select: { id: true, date: true, signOutAt: true, job: { select: { id: true, date: true, title: true, shift: true, project: { select: { id: true, name: true, regional: true } } } } },
  });
  return tipShifts(rows.map((r) => ({ ...r, attendanceId: r.id, regional: !!r.job?.project?.regional })), now);
}
const shiftWords = (j: { title: string; shift: string; date: Date; project: { name: string } | null }) => linkLabel(shiftLabel(j), "Regional job");

export type RunView = { id: string; site: string; countsTo: string; since: string | null; ended: string | null; hours: number | null; open: boolean };
const viewOf = (r: { id: string; siteLabel: string; date: string; startAt: Date; endAt: Date | null }, now = new Date()): RunView => ({
  id: r.id, site: linkLabel(r.siteLabel, "Regional job"), countsTo: countsTo(new Date(r.date + "T00:00:00.000Z")),
  since: sydneyTime(r.startAt), ended: sydneyTime(r.endAt), hours: tipHours(r.startAt, r.endAt, now).hours, open: tipStillOpen(r.startAt, r.endAt, now),
});

export type TipStatus = {
  name: string;
  enabled: boolean; // TIP_RUN=off: no Start button (an open run can still be finished)
  open: RunView | null; // the run on the go now (one at a time)
  shifts: { attendanceId: string; label: string; signedOut: string | null }[]; // shifts a run can follow, latest first
  recent: RunView[]; // finished in the last 24 hours
  signedIn: boolean; // signed in somewhere right now (no Start while so)
  reminder: string;
};

async function signedInNow(resourceId: string, now: Date) {
  return (await prisma.siteAttendance.count({
    where: { resourceId, signOutAt: null, status: { not: "REJECTED" }, removedAt: null, signInAt: { gte: new Date(now.getTime() - STILL_ON_HOURS * HOUR), lte: now } },
  })) > 0;
}
const openRunOf = (resourceId: string, now: Date) =>
  prisma.tipRun.findFirst({ where: { resourceId, endAt: null, startAt: { gte: new Date(now.getTime() - TIP_CAP_HOURS * HOUR) } }, orderBy: { startAt: "desc" } });

export async function tipRunStatus(resourceId: string, now = new Date()): Promise<TipStatus | Problem> {
  const person = await prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true, type: true, active: true } });
  if (!person || person.type !== "PERSONNEL" || !person.active) return { error: "Sign in on site once with this phone first.", status: 403 };
  const [shifts, open, recent, signedIn] = await Promise.all([
    recentShifts(resourceId, now),
    openRunOf(resourceId, now),
    prisma.tipRun.findMany({ where: { resourceId, endAt: { not: null, gte: new Date(now.getTime() - 24 * HOUR) } }, orderBy: { startAt: "desc" }, take: 5 }),
    signedInNow(resourceId, now),
  ]);
  const out: TipStatus = {
    name: linkLabel(person.name, "You"),
    enabled: tipRunOn(),
    open: open ? viewOf(open, now) : null,
    shifts: tipRunOn() ? shifts.map((s) => ({ attendanceId: s.id, label: shiftWords(s.job!), signedOut: sydneyTime(s.signOutAt) })) : [],
    recent: recent.map((r) => viewOf(r, now)),
    signedIn,
    reminder: DOCKET_REMINDER,
  };
  if (!assertNoMoney(JSON.stringify(out))) throw new Error("money on the tip run link");
  return out;
}

class TwoOpen extends Error {}

// "Start tip run" after a regional shift. A second tap shows the run already on the go - never a second one.
export async function startTipRun(resourceId: string, b: { attendanceId?: unknown; deviceId?: string | null }, now = new Date()): Promise<{ ok: true; message: string; run: RunView } | Problem> {
  const open = await openRunOf(resourceId, now);
  if (open) return { ok: true, message: `Tip run on the go since ${sydneyTime(open.startAt)}.`, run: viewOf(open, now) };
  const [person, shifts, signedIn, travelling] = await Promise.all([
    prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true } }),
    recentShifts(resourceId, now),
    signedInNow(resourceId, now),
    prisma.travelLeg.count({ where: { resourceId, endAt: null, startAt: { gte: new Date(now.getTime() - TRAVEL_CAP_HOURS * HOUR) } } }),
  ]);
  // The shift picked, or their latest one when they didn't pick (one shift is the usual case).
  const shift = typeof b.attendanceId === "string" && b.attendanceId ? shifts.find((s) => s.id === b.attendanceId) : shifts[0];
  const why = startRefusal({ on: tipRunOn(), shift: shift ? { attendanceId: shift.id, regional: !!shift.job?.project?.regional, signOutAt: shift.signOutAt } : undefined, now, signedIn, openRun: false, travelling: travelling > 0 });
  if (why) return { error: why, status: tipRunOn() ? 409 : 403 };
  const job = shift!.job!;
  try {
    const run = await prisma.$transaction(async (tx) => {
      const r = await tx.tipRun.create({
        data: {
          resourceId, workerName: person?.name ?? "Unknown", jobId: job.id, projectId: job.project!.id, siteLabel: jobLabel(job),
          date: shift!.date, shiftAttendanceId: shift!.id, startAt: now, deviceId: b.deviceId ?? null,
        },
      });
      // One open run per person: the write first, then the count (a double tap can't make two - the second rolls back).
      if ((await tx.tipRun.count({ where: { resourceId, endAt: null, startAt: { gte: new Date(now.getTime() - TIP_CAP_HOURS * HOUR) } } })) > 1) throw new TwoOpen();
      return r;
    });
    return { ok: true, message: `Tip run started at ${sydneyTime(now)} - counts to ${shiftWords(job)}. Tap Tipped – finished when you're done.`, run: viewOf(run, now) };
  } catch (e) {
    if (!(e instanceof TwoOpen)) throw e;
    const again = await openRunOf(resourceId, now);
    return again ? { ok: true, message: `Tip run on the go since ${sydneyTime(again.startAt)}.`, run: viewOf(again, now) } : { error: "Try again.", status: 409 };
  }
}

// "Tipped – finished": ends their open run (inside the window - after it, only the office can).
export async function finishTipRun(resourceId: string, now = new Date()): Promise<{ ok: true; message: string; reminder: string } | Problem> {
  const run = await openRunOf(resourceId, now);
  if (!run) return { error: "You haven't got a tip run on the go. (Over 6 hours? The office sets the time.)", status: 404 };
  await prisma.tipRun.update({ where: { id: run.id }, data: { endAt: now, endMethod: "FINISHED" } });
  await syncDayReview(run.jobId);
  const h = tipHours(run.startAt, now).hours;
  return { ok: true, message: `Tipped – finished at ${sydneyTime(now)}${h != null ? ` - ${h}h` : ""}, counted to ${countsTo(new Date(run.date + "T00:00:00.000Z"))}.`, reminder: DOCKET_REMINDER };
}

// Called from every sign-in (lib/signinOverlap.ts): a person is never counted at two places at once, so signing in
// ends their open tip run at that moment. A locked week is never changed. The run's job, for Day Review, or null.
export async function endTipRunOnSignIn(resourceId: string | null, at: Date, attendanceId: string | null): Promise<string | null> {
  if (!resourceId) return null;
  const run = await prisma.tipRun.findFirst({ where: { resourceId, endAt: null, startAt: { gte: new Date(at.getTime() - TIP_CAP_HOURS * HOUR), lt: at } }, orderBy: { startAt: "desc" } });
  if (!run || (await lockedWeekFor(run.date))) return null;
  await prisma.tipRun.update({ where: { id: run.id }, data: { endAt: at, endMethod: "SIGN_IN", endAttendanceId: attendanceId } });
  return run.jobId;
}

// ---------- the office: Sign-ins, Timesheets, Day Review ----------

export type TipRunLine = {
  tipRunId: string; date: string; resourceId: string; name: string; role: string | null; jobId: string; site: string;
  start: string; end: string | null; startAt: string; endAt: string | null; hours: number | null; flag: TipFlag | null; changedByOffice: string | null;
};

const EDIT_FIELD: Record<string, string> = { startAt: "start", endAt: "end" };
const timeOrNone = (v: string | null) => (v ? sydneyTime(new Date(v)) ?? v : "none");
type RunRow = Prisma.TipRunGetPayload<{ include: { edits: true } }>;
function lineOf(r: RunRow, roles: Map<string, string | null>, now = new Date()): TipRunLine {
  const { hours, flag } = tipHours(r.startAt, r.endAt, now);
  return {
    tipRunId: r.id, date: r.date, resourceId: r.resourceId, name: r.workerName, role: roles.get(r.resourceId) ?? null,
    jobId: r.jobId, site: r.siteLabel, start: sydneyTime(r.startAt)!, end: sydneyTime(r.endAt), startAt: r.startAt.toISOString(), endAt: r.endAt?.toISOString() ?? null, hours, flag,
    changedByOffice: r.edits.length ? r.edits.map((e) => `${EDIT_FIELD[e.field] ?? e.field} ${timeOrNone(e.before)} -> ${timeOrNone(e.after)} (${e.reason})`).join("; ") : null,
  };
}
async function linesWhere(where: Prisma.TipRunWhereInput): Promise<TipRunLine[]> {
  const runs = await prisma.tipRun.findMany({ where, include: { edits: { orderBy: { editedAt: "asc" } } }, orderBy: [{ workerName: "asc" }, { startAt: "asc" }] });
  const roles = new Map((await prisma.resource.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.resourceId))] } }, select: { id: true, role: true } })).map((r) => [r.id, r.role]));
  return runs.map((r) => lineOf(r, roles));
}
export const tipRunLinesForWeek = (weekStart: string) => linesWhere({ date: { gte: weekStart, lte: weekEnd(weekStart) } });
export const tipRunLinesForDate = (date: string) => linesWhere({ date });

// Day Review (lib/signInActuals.ts): the hours each person's counted tip runs add on each job ("jobId|resourceId").
export async function tipRunHoursForJobs(jobIds: string[], now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobIds.length) return out;
  for (const r of await prisma.tipRun.findMany({ where: { jobId: { in: jobIds }, endAt: { not: null } } })) {
    const h = tipHours(r.startAt, r.endAt, now).hours;
    if (h) out.set(`${r.jobId}|${r.resourceId}`, (out.get(`${r.jobId}|${r.resourceId}`) ?? 0) + h);
  }
  return out;
}

// An office correction (Manager+): start / end with a reason, kept in TipRunEdit. Locked weeks refuse it, and so does
// a time that would overlap one of their sign-ins.
export async function editTipRun(id: string, b: Record<string, unknown>, reason: string, by: string): Promise<{ ok: true; changed: boolean } | Problem> {
  const run = await prisma.tipRun.findUnique({ where: { id } });
  if (!run) return { error: "not found", status: 404 };
  if (await lockedWeekFor(run.date)) return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its tip runs can change.", status: 400 };
  const parse = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const startAt = "startAt" in b ? parse(b.startAt) : run.startAt;
  const endAt = "endAt" in b ? parse(b.endAt) : run.endAt;
  if (!startAt) return { error: "The start time isn't valid.", status: 400 };
  const around = await prisma.siteAttendance.findMany({
    // Their sign-ins around the run (a forgotten open one only if it started in the 20 hours before).
    where: {
      resourceId: run.resourceId, status: { not: "REJECTED" }, removedAt: null, signInAt: { lt: new Date((endAt ?? startAt).getTime() + TIP_CAP_HOURS * HOUR) },
      OR: [{ signOutAt: null, signInAt: { gte: new Date(startAt.getTime() - STILL_ON_HOURS * HOUR) } }, { signOutAt: { gt: new Date(startAt.getTime() - 48 * HOUR) } }],
    },
    select: { signInAt: true, signOutAt: true },
  });
  const bad = tipCorrectionError(startAt, endAt, around.map((a) => ({ in: a.signInAt, out: a.signOutAt })));
  if (bad) return { error: bad, status: 400 };
  const edits: { field: string; before: string | null; after: string | null }[] = [];
  if (startAt.getTime() !== run.startAt.getTime()) edits.push({ field: "startAt", before: run.startAt.toISOString(), after: startAt.toISOString() });
  if ((endAt?.getTime() ?? null) !== (run.endAt?.getTime() ?? null)) edits.push({ field: "endAt", before: run.endAt?.toISOString() ?? null, after: endAt?.toISOString() ?? null });
  if (!edits.length) return { ok: true, changed: false };
  await prisma.tipRun.update({
    where: { id },
    data: { startAt, endAt, ...(endAt && edits.some((e) => e.field === "endAt") ? { endMethod: "OFFICE" } : {}), edits: { create: edits.map((e) => ({ ...e, reason, editedBy: by })) } },
  });
  await syncDayReview(run.jobId);
  return { ok: true, changed: true };
}
