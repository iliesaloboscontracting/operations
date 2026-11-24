// Travel to and from regional jobs (2 Nov 2026) - loading and saving. Rules in ./rules.ts. Writes TravelLeg and
// TravelEdit only; never a sign-in, a JobActual, an allocation or a cost. Link-facing answers carry words, times
// and hours only (assertNoMoney before they leave).
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { jobDateWhere, jobLabel, STILL_ON_HOURS, sydneyTime } from "../signin";
import { parseGps } from "../payroll/rules";
import { assertNoMoney } from "../moneyGuard";
import { linkLabel } from "../dailyLog/money";
import { lockedWeekFor, weekEnd } from "../timesheets";
import { todaySydney } from "../today";
import {
  clashRefusal, correctionError, DIRECTION_LABEL, jobDayRefusal, travelClash, homeFrom, HOME_OFFER_HOURS, isTravelMode, legHours, legVerdict, linkRefusal, MODE_LABEL, MODE_NOT_RECORDED, modeOf,
  linkCountsOn, modeRefusal, outRefusal, overlapping, paidTravelHours, pointFixFor, stillOpen, TRAVEL_CAP_HOURS, TRAVEL_LINK_KINDS, truckRefusal,
  type Direction, type OwnSignIn, type PointFix, type TravelFlag, type TravelMode,
} from "./rules";
import { crewLegVerdict, crewWindow, deriveCrewLegs, viaText, type Att } from "./derive";
import { TIP_CAP_HOURS } from "../tipRun/rules";
import { normName, sameUser } from "../samePerson";

type Problem = { error: string; status: number };
const HOUR = 3_600_000;
// A tip run on the go for this person (lib/tipRun/) - travel out or home never starts on top of one.
export const TIP_RUN_OPEN = "You've got a tip run on the go - tap Tipped – finished first.";
const tipRunOpen = async (resourceId: string) =>
  (await prisma.tipRun.count({ where: { resourceId, endAt: null, startAt: { gte: new Date(Date.now() - TIP_CAP_HOURS * HOUR) } } })) > 0;
// Travel pay (Ilies, 23-24 Nov 2026): signed in on a truck QR and not out yet (within the "on site now" window, so a
// forgotten sign-out from days ago doesn't stop travel for good) - that sign-in already counts the drive.
const onTruckNow = async (resourceId: string) =>
  (await prisma.siteAttendance.count({
    where: { resourceId, place: "VEHICLE", signOutAt: null, removedAt: null, status: { not: "REJECTED" }, signInAt: { gte: new Date(Date.now() - STILL_ON_HOURS * HOUR) } },
  })) > 0;
const label = (j: { title: string; shift: string; project: { name: string } | null }) => linkLabel(jobLabel(j), "Regional job");
const gpsOf = (prefix: "start" | "end", v: unknown) => {
  const g = parseGps(v);
  return { [`${prefix}GpsLat`]: g.gpsLat, [`${prefix}GpsLng`]: g.gpsLng, [`${prefix}GpsAccuracyM`]: g.gpsAccuracyM, [`${prefix}GpsStatus`]: g.gpsStatus };
};

// ---------- who records travel (Ilies, 24 Nov 2026) ----------

// The people with their own SUPERVISOR or DRIVER link - the only ones who record travel. Everyone else's travel is
// worked out from their driver (./derive.ts). TP-007a: held on that date (rules.ts linkCountsOn) - today for the phone
// (and the person still active), the trip's date for the office's lines (linkHolderOn).
export async function linkHolderOn(resourceIds: string[], activeOnly = false): Promise<(resourceId: string, date: string) => boolean> {
  const links = resourceIds.length
    ? await prisma.siteLink.findMany({
        where: { kind: { in: [...TRAVEL_LINK_KINDS] }, resourceId: { in: resourceIds }, ...(activeOnly ? { resource: { active: true } } : {}) },
        select: { resourceId: true, createdAt: true, revokedAt: true },
      })
    : [];
  return (resourceId, date) => links.some((l) => l.resourceId === resourceId && linkCountsOn(l, date));
}
export async function travelLinkHolders(resourceIds: string[], date = todaySydney()): Promise<Set<string>> {
  const held = await linkHolderOn(resourceIds, date === todaySydney());
  return new Set(resourceIds.filter((id) => held(id, date)));
}
export const hasTravelLink = async (resourceId: string | null, date = todaySydney()) => !!resourceId && (await travelLinkHolders([resourceId], date)).has(resourceId);

// ---------- the worker's phone ----------

// Today's regional jobs this person is allocated to (and last night's night shift) - the same days sign-in uses.
async function regionalJobsFor(resourceId: string) {
  return prisma.job.findMany({
    where: { AND: [jobDateWhere(), { cancelledAt: null }, { assignments: { some: { resourceId } } }, { project: { regional: true } }] },
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
  byDriver: boolean; // no SUPERVISOR / DRIVER link: nothing to start - their travel is worked out from their driver
};

export async function travelStatus(resourceId: string): Promise<TravelStatus | Problem> {
  const person = await prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true, type: true, active: true } });
  if (!person || person.type !== "PERSONNEL" || !person.active) return { error: "Sign in on site once with this phone first.", status: 403 };
  const now = new Date();
  const holder = await hasTravelLink(resourceId);
  const jobs = holder ? await regionalJobsFor(resourceId) : [];
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
  // Crew with no link are never offered a start (an open leg from before can still be ended with Arrived).
  const home = holder ? homeFrom(recentOuts.map((a) => ({ attendanceId: a.id, regional: !!a.job?.project?.regional, signOutAt: a.signOutAt, existingLeg: used.has(a.id) })), now) : null;
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
    byDriver: !holder,
  };
  if (!assertNoMoney(JSON.stringify(out))) throw new Error("money on the travel link");
  return out;
}

// TP-009: the signed-in user is this Labour-register person - their login is linked to it (User.personnelId, under any
// of their logins - lib/samePerson.ts sameUser), or their login has the same name.
async function isSelf(userId: string, resourceId: string, personName: string) {
  const linked = await prisma.user.findMany({ where: { personnelId: resourceId }, select: { id: true } });
  if (linked.some((u) => sameUser(u.id, userId))) return true;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return !!me && normName(me.name) === normName(personName);
}

const dup = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// "Start travel" to a regional job. A second tap shows the leg already started - never a second one.
// mode (travel pay, 23-24 Nov 2026): "I'm driving my own car/ute" or "I'm a passenger" - required before a leg starts.
export async function startOut(resourceId: string, b: { jobId?: unknown; mode?: unknown; gps?: unknown; deviceId?: string | null }): Promise<{ ok: true; message: string; leg: LegView } | Problem> {
  // Only link-holders record travel (24 Nov 2026) - refused here, whatever the phone sends.
  const noLink = linkRefusal(await hasTravelLink(resourceId));
  if (noLink) return { error: noLink, status: 403 };
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
  // The refusals that hold whatever they pick come first (24 Nov 2026) - then the "own car/ute or passenger" choice.
  // A truck driver's drive is on their truck sign-in - never a travel leg on top of it.
  const onTruck = truckRefusal(await onTruckNow(resourceId));
  if (onTruck) return { error: onTruck, status: 409 };
  if (anyOpen) return { error: `You've already got ${DIRECTION_LABEL[anyOpen.direction as Direction].toLowerCase()} on the go since ${sydneyTime(anyOpen.startAt)}.`, status: 409 };
  // SR-003 (19 Nov 2026): a tip run on the go is worked time - travel never starts on top of it.
  if (await tipRunOpen(resourceId)) return { error: TIP_RUN_OPEN, status: 409 };
  const noMode = modeRefusal(b.mode);
  if (noMode) return { error: noMode, status: 400 };
  const now = new Date();
  try {
    const leg = await prisma.travelLeg.create({
      data: {
        direction: "OUT", resourceId, workerName: person?.name ?? "Unknown", jobId: job!.id, projectId: job!.project!.id, siteLabel: jobLabel(job!),
        date: job!.date.toISOString().slice(0, 10), startAt: now, mode: b.mode as TravelMode, deviceId: b.deviceId ?? null, ...gpsOf("start", b.gps),
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
export async function startHome(resourceId: string, b: { mode?: unknown; gps?: unknown; deviceId?: string | null }): Promise<{ ok: true; message: string; leg: LegView } | Problem> {
  const s = await travelStatus(resourceId);
  if ("error" in s) return s;
  if (s.byDriver) return { error: linkRefusal(false)!, status: 403 };
  if (s.open?.direction === "HOME") return { ok: true, message: `Travelling home since ${s.open.since}.`, leg: s.open };
  if (s.open) return { error: `You've already got travel on the go since ${s.open.since}.`, status: 409 };
  if (!s.home) return { error: "Travelling home is for after you sign out of a regional job.", status: 409 };
  // Refusals that hold whatever they pick first, then the mode (24 Nov 2026).
  const onTruck = truckRefusal(await onTruckNow(resourceId));
  if (onTruck) return { error: onTruck, status: 409 };
  // A tip run on the go (19 Nov 2026) is worked time - travel home starts once it's finished, never on top of it.
  if (await tipRunOpen(resourceId)) return { error: TIP_RUN_OPEN, status: 409 };
  const noMode = modeRefusal(b.mode);
  if (noMode) return { error: noMode, status: 400 };
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
        date: a.date, startAt: now, startAttendanceId: a.id, mode: b.mode as TravelMode, deviceId: b.deviceId ?? null, ...gpsOf("start", b.gps),
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

// ---------- the office: Sign-ins, Timesheets, Payroll ----------

export type TravelLine = {
  legId: string; direction: Direction; date: string; resourceId: string; name: string; role: string | null; jobId: string; site: string;
  start: string; end: string | null; startAt: string; endAt: string | null; hours: number | null; flag: TravelFlag | null; changedByOffice: string | null;
  // Travel pay (23-24 Nov 2026): how they travelled and the paid hours (lib/travel/rules.ts paidTravelHours). Weeks
  // approved before this have neither in their snapshot - read as null ("mode not recorded").
  mode?: TravelMode | null; paidHours?: number | null;
  // Crew travel (24 Nov 2026): worked out from the driver they travelled with, never stored (./derive.ts). legId is
  // "derived:<their sign-in id>:<OUT|HOME>"; via names the driver ("with Turori's truck (Tipper - CN03RK)"); derived
  // is the site sign-in (out) or sign-out (home) it's matched on - what the office's "Add travel" starts from.
  via?: string | null;
  derived?: { anchorAttendanceId: string; anchorAt: string } | null;
  // TP-001 option A (Ilies, 24 Nov 2026): the one-tap office fix for a Yard / Office sign-in left open into the drive out
  // (rules.ts pointFixFor) - an ordinary office sign-in change, never made automatically.
  pointFix?: PointFix | null;
  // TP-008c: more than one driver could have been the one they travelled with - information only, never a blocker.
  driversPossible?: number;
};

const EDIT_FIELD: Record<string, string> = { startAt: "start", endAt: "end", mode: "travelled as", added: "added by the office" };
const timeOrNone = (v: string | null) => (v ? sydneyTime(new Date(v)) ?? v : "none");
const editValue = (field: string, v: string | null) =>
  field === "mode" ? (isTravelMode(v) ? MODE_LABEL[v] : MODE_NOT_RECORDED)
  : field === "added" ? (v ?? "").split(" - ").map((p) => timeOrNone(p)).join(" - ")
  : timeOrNone(v);
type LegRow = Prisma.TravelLegGetPayload<{ include: { edits: true } }>;
// A recorded leg (the link-holder's own, or one the office added) as it counts - TP-001: over one of their own sign-ins
// it counts nothing (SIGNIN_OVERLAP) and blocks the week.
function lineOf(l: LegRow, roles: Map<string, string | null>, own: OwnSignIn[], now = new Date()): TravelLine {
  const { hours, flag } = legVerdict(l.startAt, l.endAt, own, now);
  const mode = modeOf(l.mode);
  const fix = flag === "SIGNIN_OVERLAP" ? pointFixFor(l.direction as Direction, overlapping(l.startAt, l.endAt, own, now), l.startAt, { site: l.siteLabel, driver: null, truck: false }) : null;
  return {
    legId: l.id, direction: l.direction as Direction, date: l.date, resourceId: l.resourceId, name: l.workerName, role: roles.get(l.resourceId) ?? null,
    jobId: l.jobId, site: l.siteLabel, start: sydneyTime(l.startAt)!, end: sydneyTime(l.endAt), startAt: l.startAt.toISOString(), endAt: l.endAt?.toISOString() ?? null, hours, flag,
    changedByOffice: l.edits.length ? l.edits.map((e) => (e.field === "added" ? `${EDIT_FIELD.added} ${editValue(e.field, e.after)} (${e.reason})` : `${EDIT_FIELD[e.field] ?? e.field} ${editValue(e.field, e.before)} -> ${editValue(e.field, e.after)} (${e.reason})`)).join("; ") : null,
    mode, paidHours: paidTravelHours(hours, mode),
    ...(fix ? { pointFix: fix } : {}),
  };
}

const DAY = 86_400_000;
const shiftDate = (date: string, n: number) => new Date(new Date(date + "T00:00:00.000Z").getTime() + n * DAY).toISOString().slice(0, 10);
const counts = { status: { not: "REJECTED" }, removedAt: null } as const;
const attSelect = { id: true, resourceId: true, jobId: true, date: true, place: true, placeLabel: true, signInAt: true, signOutAt: true, signOutMethod: true } as const;
const toAtt = (a: { id: string; resourceId: string | null; jobId: string | null; date: string; place: string | null; placeLabel: string | null; signInAt: Date; signOutAt: Date | null; signOutMethod: string | null }): Att => ({ ...a, resourceId: a.resourceId! });

// Each person's sign-ins that still count, around these times (TP-001). A sign-in left open counts from the 20 hours
// before the earliest time only (a forgotten one from days ago doesn't run over everything since) - as tip runs do.
async function ownSignIns(people: string[], starts: Date[], ends: Date[]): Promise<Map<string, OwnSignIn[]>> {
  const out = new Map<string, OwnSignIn[]>();
  if (!people.length || !starts.length) return out;
  const first = Math.min(...starts.map((d) => d.getTime()));
  const last = Math.max(...ends.map((d) => d.getTime()));
  const rows = await prisma.siteAttendance.findMany({
    where: {
      resourceId: { in: people }, ...counts, signInAt: { lt: new Date(last + HOUR) },
      OR: [{ signOutAt: { gt: new Date(first - 48 * HOUR) } }, { signOutAt: null, signInAt: { gte: new Date(first - STILL_ON_HOURS * HOUR) } }],
    },
    select: { id: true, resourceId: true, signInAt: true, signOutAt: true, place: true, placeLabel: true },
  });
  for (const r of rows) out.set(r.resourceId!, [...(out.get(r.resourceId!) ?? []), { id: r.id, in: r.signInAt, out: r.signOutAt, place: r.place, placeLabel: r.placeLabel }]);
  // TP-010 (Ilies, 24 Nov 2026): their regional tip runs are worked time too - travel never counts over one. A run not
  // finished is looked at over the time it could still run (its 6 h window).
  const runs = await prisma.tipRun.findMany({
    where: { resourceId: { in: people }, startAt: { lt: new Date(last + HOUR), gte: new Date(first - 48 * HOUR) } },
    select: { id: true, resourceId: true, startAt: true, endAt: true },
  });
  for (const r of runs) {
    const end = r.endAt ?? new Date(Math.min(Date.now(), r.startAt.getTime() + TIP_CAP_HOURS * HOUR));
    out.set(r.resourceId, [...(out.get(r.resourceId) ?? []), { id: `tiprun:${r.id}`, in: r.startAt, out: end, place: "TIP_RUN", placeLabel: "Tip run" }]);
  }
  return out;
}

// Every travel line for these dates - the recorded legs, and the crew legs worked out from their drivers (./derive.ts) -
// each checked against the person's own sign-ins (TP-001). The one place travel is read: Sign-ins and Timesheets
// (travelLinesForDate / ForWeek, and so the approved snapshot) and accounts' Payroll (lib/payroll/store.ts).
export async function travelLinesBetween(from: string, to: string, now = new Date()): Promise<TravelLine[]> {
  const [legs, site] = await Promise.all([
    prisma.travelLeg.findMany({ where: { date: { gte: from, lte: to } }, include: { edits: { orderBy: { editedAt: "asc" } } }, orderBy: [{ workerName: "asc" }, { startAt: "asc" }] }),
    // Site sign-ins on regional jobs (staff only) - who's crew, who's a link-holder, and what to match on.
    prisma.siteAttendance.findMany({
      where: { date: { gte: from, lte: to }, ...counts, jobId: { not: null }, resource: { type: "PERSONNEL" }, job: { project: { regional: true } } },
      select: { ...attSelect, resource: { select: { name: true, role: true } }, job: { select: { title: true, shift: true, project: { select: { name: true } } } } },
    }),
  ]);
  const held = await linkHolderOn([...new Set(site.map((s) => s.resourceId!))]);
  const isHolder = (a: { resourceId: string | null; date: string }) => held(a.resourceId!, a.date);
  const crewAtts = site.filter((s) => !isHolder(s)).map(toAtt);
  const holderIds = [...new Set(site.filter(isHolder).map((s) => s.resourceId!))];
  const crewIds = [...new Set(crewAtts.map((a) => a.resourceId))];
  const crewJobIds = [...new Set(crewAtts.map((a) => a.jobId!))];
  const [trucks, holderLegs, crewRecorded] = await Promise.all([
    // Truck QR sign-ins: the link-holders' (their drive) and the crew's own (those stand - no worked-out leg on top).
    crewAtts.length
      ? prisma.siteAttendance.findMany({ where: { place: "VEHICLE", resourceId: { in: [...holderIds, ...crewIds] }, date: { gte: shiftDate(from, -1), lte: shiftDate(to, 1) }, ...counts }, select: attSelect })
      : [],
    holderIds.length && crewJobIds.length
      ? prisma.travelLeg.findMany({ where: { resourceId: { in: holderIds }, jobId: { in: crewJobIds } }, select: { id: true, resourceId: true, jobId: true, direction: true, startAt: true, endAt: true, mode: true } })
      : [],
    crewJobIds.length ? prisma.travelLeg.findMany({ where: { resourceId: { in: crewIds }, jobId: { in: crewJobIds } }, select: { resourceId: true, jobId: true, direction: true } }) : [],
  ]);
  const holderAtts = [...site.filter(isHolder).map(toAtt), ...trucks.filter((v) => holderIds.includes(v.resourceId!)).map(toAtt)];
  const crewTrucks = trucks.filter((v) => crewIds.includes(v.resourceId!)).map(toAtt);
  // A leg recorded for that person, job and way (the office's, or an older one from before) is used instead.
  const recorded = new Set(crewRecorded.map((l) => `${l.resourceId}|${l.jobId}|${l.direction}`));
  const crew = deriveCrewLegs(crewAtts, holderAtts, holderLegs, crewTrucks).filter((c) => !recorded.has(`${c.resourceId}|${c.jobId}|${c.direction}`));

  const own = await ownSignIns(
    [...new Set([...legs.map((l) => l.resourceId), ...crew.map((c) => c.resourceId)])],
    [...legs.map((l) => l.startAt), ...crew.map((c) => crewWindow(c)?.startAt ?? c.anchorAt)],
    [...legs.map((l) => l.endAt ?? now), ...crew.map((c) => crewWindow(c)?.endAt ?? now)],
  );
  const siteOf = new Map(site.map((s) => [s.id, s]));
  const nameOf = new Map(site.map((s) => [s.resourceId!, s.resource?.name ?? ""]));
  const roleOf = new Map(site.map((s) => [s.resourceId!, s.resource?.role ?? null]));
  const legRoles = await prisma.resource.findMany({ where: { id: { in: [...new Set(legs.map((l) => l.resourceId))].filter((id) => !roleOf.has(id)) } }, select: { id: true, role: true } });
  for (const r of legRoles) roleOf.set(r.id, r.role);

  const lines: TravelLine[] = legs.map((l) => lineOf(l, roleOf, own.get(l.resourceId) ?? [], now));
  for (const c of crew) {
    const a = siteOf.get(c.anchor.id)!;
    const siteLabel = a.job ? jobLabel(a.job) : "Regional job";
    const driver = c.drive ? nameOf.get(c.drive.driverId) || "the driver" : null;
    const v = crewLegVerdict(c, own.get(c.resourceId) ?? [], now, { site: siteLabel, driver });
    const d = crewWindow(c); // the driver's drive, cut at their own sign-in / sign-out
    const anchorAt = c.anchorAt.toISOString();
    lines.push({
      legId: `derived:${c.anchor.id}:${c.direction}`, direction: c.direction, date: c.date, resourceId: c.resourceId, name: a.resource?.name ?? "Unknown", role: roleOf.get(c.resourceId) ?? null,
      jobId: c.jobId, site: siteLabel,
      // No driver found: the side we know (their sign-in / sign-out), the other "?".
      start: d ? sydneyTime(d.startAt)! : c.direction === "HOME" ? sydneyTime(c.anchorAt)! : "?",
      end: d ? sydneyTime(d.endAt) : c.direction === "OUT" ? sydneyTime(c.anchorAt) : null,
      startAt: (d?.startAt ?? c.anchorAt).toISOString(), endAt: d ? d.endAt?.toISOString() ?? null : c.direction === "OUT" ? anchorAt : null,
      hours: v.hours, flag: v.flag, changedByOffice: null,
      // Paid like a passenger: 1 hour less each way.
      mode: d ? "PASSENGER" : null, paidHours: paidTravelHours(v.hours, d ? "PASSENGER" : null),
      via: c.drive && driver ? viaText(c.drive, driver) : null,
      derived: { anchorAttendanceId: c.anchor.id, anchorAt },
      ...(v.pointFix ? { pointFix: v.pointFix } : {}),
      ...((c.drive?.candidates ?? 0) > 1 ? { driversPossible: c.drive!.candidates } : {}),
    });
  }
  return lines.sort((x, y) => x.name.localeCompare(y.name) || x.startAt.localeCompare(y.startAt));
}
export const travelLinesForWeek = (weekStart: string) => travelLinesBetween(weekStart, weekEnd(weekStart));
export const travelLinesForDate = (date: string) => travelLinesBetween(date, date);

// TP-009 / TP-013: an office leg's times never run over the person's other travel on the job's day +-1 - recorded or
// worked out (never NO_DRIVER: those have no times). skip = the line(s) this leg is or takes the place of.
async function otherTravelRefusal(resourceId: string, date: string, startAt: Date, endAt: Date | null, skip: (l: TravelLine) => boolean): Promise<string | null> {
  const travel = (await travelLinesBetween(shiftDate(date, -1), shiftDate(date, 1))).filter((l) => l.resourceId === resourceId && l.flag !== "NO_DRIVER" && !skip(l));
  const clash = travelClash(startAt, endAt, travel);
  return clash ? clashRefusal(clash) : null;
}

// The office adds a leg by hand (Manager+, 24 Nov 2026) - for crew with "no driver found", or to replace a worked-out
// leg that's wrong (e.g. trimmed off a sign-in it ran over). It takes the place of the worked-out one for that person,
// job and way. Start, end, how they travelled and a reason - kept in TravelEdit ("added by the office"). Only on a
// regional job they signed in on; never over one of their sign-ins; locked weeks refuse; one leg each way per job.
export async function addTravelLeg(b: Record<string, unknown>, reason: string, who: { id: string; name: string }): Promise<{ ok: true; id: string } | Problem> {
  const by = who.name;
  const resourceId = typeof b.resourceId === "string" ? b.resourceId : "";
  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  const direction = b.direction;
  if (direction !== "OUT" && direction !== "HOME") return { error: "Pick travel out or travel home.", status: 400 };
  if (!isTravelMode(b.mode)) return { error: "Pick how they travelled: driving their own car/ute, or a passenger.", status: 400 };
  const parse = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const startAt = parse(b.startAt), endAt = parse(b.endAt);
  if (!startAt || !endAt) return { error: "Give the start and the end.", status: 400 };
  const bad = correctionError(startAt, endAt);
  if (bad) return { error: bad, status: 400 };
  if (endAt.getTime() > Date.now() + 5 * 60_000) return { error: "The end can't be in the future.", status: 400 };
  const [person, job] = await Promise.all([
    prisma.resource.findUnique({ where: { id: resourceId }, select: { name: true, type: true } }),
    prisma.job.findUnique({ where: { id: jobId }, select: { id: true, date: true, title: true, shift: true, project: { select: { id: true, name: true, regional: true } } } }),
  ]);
  if (!person || person.type !== "PERSONNEL") return { error: "Pick someone on the Labour register.", status: 400 };
  if (!job?.project?.regional) return { error: "Travel is only for jobs on a regional project.", status: 400 };
  const date = job.date.toISOString().slice(0, 10);
  // TP-009: never your own travel (the same person under any of their logins - lib/samePerson.ts).
  if (await isSelf(who.id, resourceId, person.name)) return { error: "Ask another Manager to add your own travel.", status: 403 };
  // TP-009: on the job's day, one day either side (Sydney).
  const offDay = jobDayRefusal(date, startAt, endAt);
  if (offDay) return { error: offDay, status: 400 };
  if (await lockedWeekFor(date)) return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its travel can change.", status: 400 };
  if (!(await prisma.siteAttendance.count({ where: { resourceId, jobId, ...counts } }))) return { error: "They didn't sign in on this job - add their sign-in first.", status: 400 };
  // One leg each way per job - checked before the time checks, so a second one says "use Fix" (not an overlap with itself).
  const existing = await prisma.travelLeg.findUnique({ where: { resourceId_jobId_direction: { resourceId, jobId, direction } } });
  if (existing) return { error: `They already have ${DIRECTION_LABEL[direction].toLowerCase()} for this job - use Fix on it.`, status: 409 };
  const own = (await ownSignIns([resourceId], [startAt], [endAt])).get(resourceId) ?? [];
  const over = overlapping(startAt, endAt, own);
  if (over.length) return { error: `Those times run over one of their sign-ins (${sydneyTime(over[0].in)}-${sydneyTime(over[0].out) ?? "open"}) - trim them first.`, status: 400 };
  // TP-009: nor over their other travel - recorded or worked out (not the worked-out leg this one takes the place of).
  const clash = await otherTravelRefusal(resourceId, date, startAt, endAt, (l) => !!l.derived && l.jobId === jobId && l.direction === direction);
  if (clash) return { error: clash, status: 400 };

  try {
    const leg = await prisma.travelLeg.create({
      data: {
        direction, resourceId, workerName: person.name, jobId, projectId: job.project.id, siteLabel: jobLabel(job), date, startAt, endAt, endMethod: "OFFICE", mode: b.mode,
        edits: { create: [{ field: "added", before: null, after: `${startAt.toISOString()} - ${endAt.toISOString()}`, reason, editedBy: by }] },
      },
    });
    return { ok: true, id: leg.id };
  } catch (e) {
    if (dup(e)) return { error: `They already have ${DIRECTION_LABEL[direction].toLowerCase()} for this job - use Fix on it.`, status: 409 };
    throw e;
  }
}

// An office correction (Manager+): start / end and (travel pay, 23-24 Nov 2026) how they travelled - "mode":
// DRIVER_OWN_VEHICLE | PASSENGER - with a reason, kept in TravelEdit. Locked weeks refuse it.
// TP-013 (the same checks as an added leg, TP-009): never your own travel; new times on the job's day +-1 and never
// over the person's other travel (recorded or worked out).
export async function editTravelLeg(id: string, b: Record<string, unknown>, reason: string, who: { id: string; name: string }): Promise<{ ok: true; changed: boolean } | Problem> {
  const by = who.name;
  const leg = await prisma.travelLeg.findUnique({ where: { id } });
  if (!leg) return { error: "not found", status: 404 };
  const person = await prisma.resource.findUnique({ where: { id: leg.resourceId }, select: { name: true } });
  if (await isSelf(who.id, leg.resourceId, person?.name ?? leg.workerName)) return { error: "Ask another Manager to change your own travel.", status: 403 };
  if (await lockedWeekFor(leg.date)) return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its travel can change.", status: 400 };
  const parse = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const startAt = "startAt" in b ? parse(b.startAt) : leg.startAt;
  const endAt = "endAt" in b ? parse(b.endAt) : leg.endAt;
  if (!startAt) return { error: "The start time isn't valid.", status: 400 };
  const bad = correctionError(startAt, endAt);
  if (bad) return { error: bad, status: 400 };
  // A mode can be set or changed, never cleared (null is only for legs from before it was asked).
  if ("mode" in b && !isTravelMode(b.mode)) return { error: "Pick how they travelled: driving their own car/ute, or a passenger.", status: 400 };
  const mode = "mode" in b ? (b.mode as TravelMode) : leg.mode;
  const edits: { field: string; before: string | null; after: string | null }[] = [];
  if (startAt.getTime() !== leg.startAt.getTime()) edits.push({ field: "startAt", before: leg.startAt.toISOString(), after: startAt.toISOString() });
  if ((endAt?.getTime() ?? null) !== (leg.endAt?.getTime() ?? null)) edits.push({ field: "endAt", before: leg.endAt?.toISOString() ?? null, after: endAt?.toISOString() ?? null });
  if (mode !== leg.mode) edits.push({ field: "mode", before: leg.mode, after: mode });
  if (!edits.length) return { ok: true, changed: false };
  // TP-013: new times (a mode-only change keeps the times it had) - on the job's day +-1, never over their other travel.
  if (edits.some((e) => e.field === "startAt" || e.field === "endAt")) {
    const offDay = jobDayRefusal(leg.date, startAt, endAt);
    if (offDay) return { error: offDay, status: 400 };
    const clash = await otherTravelRefusal(leg.resourceId, leg.date, startAt, endAt, (l) => l.legId === leg.id);
    if (clash) return { error: clash, status: 400 };
  }
  await prisma.travelLeg.update({
    where: { id },
    data: { startAt, endAt, mode, ...(endAt && edits.some((e) => e.field === "endAt") ? { endMethod: "OFFICE" } : {}), edits: { create: edits.map((e) => ({ ...e, reason, editedBy: by })) } },
  });
  return { ok: true, changed: true };
}
