// Travel to and from regional jobs (2 Nov 2026) - loading and saving. Rules in ./rules.ts. Writes TravelLeg and
// TravelEdit only; never a sign-in, a JobActual, an allocation or a cost. Link-facing answers carry words, times
// and hours only (assertNoMoney before they leave).
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { jobDateWhere, jobLabel, sydneyTime } from "../signin";
import { parseGps } from "../payroll/rules";
import { assertNoMoney } from "../moneyGuard";
import { linkLabel } from "../dailyLog/money";
import { lockedWeekFor, weekEnd } from "../timesheets";
import {
  correctionError, DIRECTION_LABEL, homeFrom, HOME_OFFER_HOURS, legHours, outRefusal, stillOpen, TRAVEL_CAP_HOURS,
  type Direction, type TravelFlag,
} from "./rules";

type Problem = { error: string; status: number };
const HOUR = 3_600_000;
const label = (j: { title: string; shift: string; project: { name: string } | null }) => linkLabel(jobLabel(j), "Regional job");
const gpsOf = (prefix: "start" | "end", v: unknown) => {
  const g = parseGps(v);
  return { [`${prefix}GpsLat`]: g.gpsLat, [`${prefix}GpsLng`]: g.gpsLng, [`${prefix}GpsAccuracyM`]: g.gpsAccuracyM, [`${prefix}GpsStatus`]: g.gpsStatus };
};

// ---------- the worker's phone ----------

// Today's regional jobs this person is allocated to (and last night's night shift) - the same days sign-in uses.
async function regionalJobsFor(resourceId: string) {
  return prisma.job.findMany({
    where: { AND: [jobDateWhere(), { assignments: { some: { resourceId } } }, { project: { regional: true } }] },
    select: { id: true, date: true, title: true, shift: true, project: { select: { id: true, name: true, regional: true } } },
    orderBy: [{ date: "desc" }, { shift: "asc" }],
  });
}

export type LegView = { id: string; direction: Direction; label: string; site: string; since: string | null; ended: string | null; open: boolean };
const viewOf = (l: { id: string; direction: string; siteLabel: string; startAt: Date; endAt: Date | null }, now = new Date()): LegView => ({
  id: l.id, direction: l.direction as Direction, label: DIRECTION_LABEL[l.direction as Direction] ?? "Travel", site: linkLabel(l.siteLabel, "Regional job"),
  since: sydneyTime(l.startAt), ended: sydneyTime(l.endAt), open: stillOpen(l.startAt, l.endAt, now),
});

export type TravelStatus = {
  name: string;
  open: LegView | null; // the leg on the go now (one at a time)
  outJobs: { jobId: string; label: string; leg: LegView | null }[]; // regional jobs today; leg = already started
  home: { attendanceId: string; label: string } | null; // "Travelling home" on offer
  homeLeg: LegView | null; // today's home leg, if one was started
};

export async function travelStatus(resourceId: string): Promise<TravelStatus | Problem> {
  const person = await prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true, type: true, active: true } });
  if (!person || person.type !== "PERSONNEL" || !person.active) return { error: "Sign in on site once with this phone first.", status: 403 };
  const now = new Date();
  const jobs = await regionalJobsFor(resourceId);
  const [legs, signIns, recentOuts] = await Promise.all([
    prisma.travelLeg.findMany({ where: { resourceId, startAt: { gte: new Date(now.getTime() - 36 * HOUR) } }, orderBy: { startAt: "desc" } }),
    prisma.siteAttendance.findMany({ where: { resourceId, jobId: { in: jobs.map((j) => j.id) }, status: { not: "REJECTED" } }, select: { jobId: true } }),
    prisma.siteAttendance.findMany({
      // A real sign-out - not one ended because they signed in at another site (MOVED).
      where: {
        resourceId, jobId: { not: null }, status: { not: "REJECTED" }, signOutAt: { gte: new Date(now.getTime() - HOME_OFFER_HOURS * HOUR) },
        OR: [{ signOutMethod: null }, { signOutMethod: { not: "MOVED" } }],
      },
      select: { id: true, signOutAt: true, job: { select: { title: true, shift: true, project: { select: { name: true, regional: true } } } } },
    }),
  ]);
  const open = legs.find((l) => stillOpen(l.startAt, l.endAt, now)) ?? null;
  const used = new Set(legs.filter((l) => l.direction === "HOME").map((l) => l.startAttendanceId));
  const home = homeFrom(recentOuts.map((a) => ({ attendanceId: a.id, regional: !!a.job?.project?.regional, signOutAt: a.signOutAt, existingLeg: used.has(a.id) })), now);
  const homeJob = home ? recentOuts.find((a) => a.id === home.attendanceId)?.job : null;
  const homeLeg = legs.find((l) => l.direction === "HOME") ?? null;
  const out: TravelStatus = {
    name: linkLabel(person.name, "You"),
    open: open ? viewOf(open, now) : null,
    outJobs: jobs
      .filter((j) => !signIns.some((s) => s.jobId === j.id) || legs.some((l) => l.direction === "OUT" && l.jobId === j.id))
      .map((j) => {
        const leg = legs.find((l) => l.direction === "OUT" && l.jobId === j.id);
        return { jobId: j.id, label: label(j), leg: leg ? viewOf(leg, now) : null };
      }),
    home: home && homeJob && !open ? { attendanceId: home.attendanceId, label: label(homeJob) } : null,
    homeLeg: homeLeg && now.getTime() - homeLeg.startAt.getTime() < 24 * HOUR ? viewOf(homeLeg, now) : null,
  };
  if (!assertNoMoney(JSON.stringify(out))) throw new Error("money on the travel link");
  return out;
}

const dup = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// "Start travel" to a regional job. A second tap shows the leg already started - never a second one.
export async function startOut(resourceId: string, b: { jobId?: unknown; gps?: unknown; deviceId?: string | null }): Promise<{ ok: true; message: string; leg: LegView } | Problem> {
  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  const [person, jobs] = await Promise.all([
    prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true } }),
    regionalJobsFor(resourceId),
  ]);
  const job = jobs.find((j) => j.id === jobId);
  // A job that isn't regional (or isn't theirs today) is never offered - and refused if asked for.
  const [signedIn, existing, anyOpen] = await Promise.all([
    job ? prisma.siteAttendance.count({ where: { resourceId, jobId, status: { not: "REJECTED" } } }) : 0,
    prisma.travelLeg.findUnique({ where: { resourceId_jobId_direction: { resourceId, jobId: jobId || "-", direction: "OUT" } } }),
    prisma.travelLeg.findFirst({ where: { resourceId, endAt: null, startAt: { gte: new Date(Date.now() - TRAVEL_CAP_HOURS * HOUR) } } }),
  ]);
  if (existing) return { ok: true, message: `Travel already started at ${sydneyTime(existing.startAt)}.`, leg: viewOf(existing) };
  const why = outRefusal(job ? { jobId, regional: !!job.project?.regional, signedIn: signedIn > 0, existingLeg: false } : undefined);
  if (why) return { error: why, status: job ? 409 : 403 };
  if (anyOpen) return { error: `You've already got ${DIRECTION_LABEL[anyOpen.direction as Direction].toLowerCase()} on the go since ${sydneyTime(anyOpen.startAt)}.`, status: 409 };
  const now = new Date();
  try {
    const leg = await prisma.travelLeg.create({
      data: {
        direction: "OUT", resourceId, workerName: person?.name ?? "Unknown", jobId: job!.id, projectId: job!.project!.id, siteLabel: jobLabel(job!),
        date: job!.date.toISOString().slice(0, 10), startAt: now, deviceId: b.deviceId ?? null, ...gpsOf("start", b.gps),
      },
    });
    return { ok: true, message: `Travel started at ${sydneyTime(now)} - ${label(job!)}. Sign in on site when you get there.`, leg: viewOf(leg) };
  } catch (e) {
    if (!dup(e)) throw e;
    const leg = await prisma.travelLeg.findUnique({ where: { resourceId_jobId_direction: { resourceId, jobId, direction: "OUT" } } });
    return { ok: true, message: `Travel already started at ${sydneyTime(leg!.startAt)}.`, leg: viewOf(leg!) };
  }
}

// "Travelling home" after signing out of a regional job.
export async function startHome(resourceId: string, b: { gps?: unknown; deviceId?: string | null }): Promise<{ ok: true; message: string; leg: LegView } | Problem> {
  const s = await travelStatus(resourceId);
  if ("error" in s) return s;
  if (s.open?.direction === "HOME") return { ok: true, message: `Travelling home since ${s.open.since}.`, leg: s.open };
  if (s.open) return { error: `You've already got travel on the go since ${s.open.since}.`, status: 409 };
  if (!s.home) return { error: "Travelling home is for after you sign out of a regional job.", status: 409 };
  const a = await prisma.siteAttendance.findUnique({
    where: { id: s.home.attendanceId },
    select: { id: true, date: true, workerName: true, job: { select: { id: true, title: true, shift: true, project: { select: { id: true, name: true } } } } },
  });
  if (!a?.job?.project) return { error: "Travelling home is for after you sign out of a regional job.", status: 409 };
  const now = new Date();
  try {
    const leg = await prisma.travelLeg.create({
      data: {
        direction: "HOME", resourceId, workerName: a.workerName, jobId: a.job.id, projectId: a.job.project.id, siteLabel: jobLabel(a.job),
        date: a.date, startAt: now, startAttendanceId: a.id, deviceId: b.deviceId ?? null, ...gpsOf("start", b.gps),
      },
    });
    return { ok: true, message: `Travelling home from ${sydneyTime(now)}. Tap Arrived when you get there.`, leg: viewOf(leg) };
  } catch (e) {
    if (!dup(e)) throw e;
    const leg = await prisma.travelLeg.findFirst({ where: { resourceId, direction: "HOME", startAttendanceId: a.id } });
    return { ok: true, message: `Travelling home since ${sydneyTime(leg!.startAt)}.`, leg: viewOf(leg!) };
  }
}

// "Arrived": ends the open home leg (the outward leg is ended by the site sign-in, never by this).
export async function arrive(resourceId: string, b: { gps?: unknown }): Promise<{ ok: true; message: string } | Problem> {
  const now = new Date();
  const leg = await prisma.travelLeg.findFirst({
    where: { resourceId, direction: "HOME", endAt: null, startAt: { gte: new Date(now.getTime() - TRAVEL_CAP_HOURS * HOUR) } },
    orderBy: { startAt: "desc" },
  });
  if (!leg) return { error: "You're not travelling home right now.", status: 404 };
  await prisma.travelLeg.update({ where: { id: leg.id }, data: { endAt: now, endMethod: "ARRIVED", ...gpsOf("end", b.gps) } });
  const h = legHours(leg.startAt, now).hours;
  return { ok: true, message: `Arrived at ${sydneyTime(now)}${h != null ? ` - ${h}h travel` : ""}. Safe home.` };
}

// Called from a site sign-in: ends their open outward leg to that project (within the window). Message for the phone.
export async function endOutOnSignIn(resourceId: string | null, projectId: string | null, attendanceId: string, at: Date): Promise<string | null> {
  if (!resourceId || !projectId) return null;
  const leg = await prisma.travelLeg.findFirst({
    where: { resourceId, projectId, direction: "OUT", endAt: null, startAt: { gte: new Date(at.getTime() - TRAVEL_CAP_HOURS * HOUR), lte: at } },
    orderBy: { startAt: "desc" },
  });
  if (!leg) return null;
  await prisma.travelLeg.update({ where: { id: leg.id }, data: { endAt: at, endMethod: "SIGN_IN", endAttendanceId: attendanceId } });
  const h = legHours(leg.startAt, at).hours;
  return h != null ? `Travel ended - ${h}h.` : "Travel ended.";
}

// After a sign-out: is "Travelling home" on offer (a regional project)? Plain yes / no for the phone.
export async function homeOffered(resourceId: string | null, projectId: string | null) {
  if (!resourceId || !projectId) return false;
  return !!(await prisma.project.findFirst({ where: { id: projectId, regional: true }, select: { id: true } }));
}

// Does this person have a regional job coming up (today to two weeks out)? The phone then shows the travel link.
export async function hasRegionalWork(resourceId: string | null, today: string) {
  if (!resourceId) return false;
  const from = new Date(today + "T00:00:00.000Z");
  return (await prisma.assignment.count({
    where: { resourceId, job: { date: { gte: new Date(from.getTime() - 86_400_000), lte: new Date(from.getTime() + 14 * 86_400_000) }, status: "ACTIVE", project: { regional: true } } },
  })) > 0;
}

// ---------- the office: Sign-ins, Timesheets ----------

export type TravelLine = {
  legId: string; direction: Direction; date: string; resourceId: string; name: string; role: string | null; jobId: string; site: string;
  start: string; end: string | null; startAt: string; endAt: string | null; hours: number | null; flag: TravelFlag | null; changedByOffice: string | null;
};

const EDIT_FIELD: Record<string, string> = { startAt: "start", endAt: "end" };
const timeOrNone = (v: string | null) => (v ? sydneyTime(new Date(v)) ?? v : "none");
type LegRow = Prisma.TravelLegGetPayload<{ include: { edits: true } }>;
function lineOf(l: LegRow, roles: Map<string, string | null>, now = new Date()): TravelLine {
  const { hours, flag } = legHours(l.startAt, l.endAt, now);
  return {
    legId: l.id, direction: l.direction as Direction, date: l.date, resourceId: l.resourceId, name: l.workerName, role: roles.get(l.resourceId) ?? null,
    jobId: l.jobId, site: l.siteLabel, start: sydneyTime(l.startAt)!, end: sydneyTime(l.endAt), startAt: l.startAt.toISOString(), endAt: l.endAt?.toISOString() ?? null, hours, flag,
    changedByOffice: l.edits.length ? l.edits.map((e) => `${EDIT_FIELD[e.field] ?? e.field} ${timeOrNone(e.before)} -> ${timeOrNone(e.after)} (${e.reason})`).join("; ") : null,
  };
}

async function linesWhere(where: Prisma.TravelLegWhereInput): Promise<TravelLine[]> {
  const legs = await prisma.travelLeg.findMany({ where, include: { edits: { orderBy: { editedAt: "asc" } } }, orderBy: [{ workerName: "asc" }, { startAt: "asc" }] });
  const roles = new Map((await prisma.resource.findMany({ where: { id: { in: [...new Set(legs.map((l) => l.resourceId))] } }, select: { id: true, role: true } })).map((r) => [r.id, r.role]));
  return legs.map((l) => lineOf(l, roles));
}
export const travelLinesForWeek = (weekStart: string) => linesWhere({ date: { gte: weekStart, lte: weekEnd(weekStart) } });
export const travelLinesForDate = (date: string) => linesWhere({ date });

// An office correction (Manager+): start / end with a reason, kept in TravelEdit. Locked weeks refuse it.
export async function editTravelLeg(id: string, b: Record<string, unknown>, reason: string, by: string): Promise<{ ok: true; changed: boolean } | Problem> {
  const leg = await prisma.travelLeg.findUnique({ where: { id } });
  if (!leg) return { error: "not found", status: 404 };
  if (await lockedWeekFor(leg.date)) return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its travel can change.", status: 400 };
  const parse = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const startAt = "startAt" in b ? parse(b.startAt) : leg.startAt;
  const endAt = "endAt" in b ? parse(b.endAt) : leg.endAt;
  if (!startAt) return { error: "The start time isn't valid.", status: 400 };
  const bad = correctionError(startAt, endAt);
  if (bad) return { error: bad, status: 400 };
  const edits: { field: string; before: string | null; after: string | null }[] = [];
  if (startAt.getTime() !== leg.startAt.getTime()) edits.push({ field: "startAt", before: leg.startAt.toISOString(), after: startAt.toISOString() });
  if ((endAt?.getTime() ?? null) !== (leg.endAt?.getTime() ?? null)) edits.push({ field: "endAt", before: leg.endAt?.toISOString() ?? null, after: endAt?.toISOString() ?? null });
  if (!edits.length) return { ok: true, changed: false };
  await prisma.travelLeg.update({
    where: { id },
    data: { startAt, endAt, ...(endAt && edits.some((e) => e.field === "endAt") ? { endMethod: "OFFICE" } : {}), edits: { create: edits.map((e) => ({ ...e, reason, editedBy: by })) } },
  });
  return { ok: true, changed: true };
}
