// The office's view of site sign-ins for a date (19 Oct 2026): each job's
// allocated crew next to who actually signed in, the hours that works out
// to, and what needs a look. Times only - never a dollar figure.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { jobLabel, pointCrew, POINT_BREAK_MINUTES, signedHours, sydneyTime, type Place } from "./signin";
import { todaySydney } from "./today";

export type AttendanceFlag =
  | "NO_SIGN_IN" // allocated, never signed in
  | "STILL_ON" // signed in today, not out yet
  | "NO_SIGN_OUT" // an earlier day, never signed out
  | "NOT_ALLOCATED" // signed in on a job they weren't allocated to
  | "TO_CONFIRM" // poster sign-in waiting for the supervisor
  | "MOVED" // signed in at another site, so this one was ended
  | "SHARED_PHONE" // one phone signed in more than one person that day
  | "REJECTED" // supervisor said they weren't there
  | "ODD_HOURS" // office / yard / truck: signed in before 4am or after 9pm
  | "LONG_DAY"; // office / yard / truck: more than 14 hours signed in

type AttendanceWithEdits = Prisma.SiteAttendanceGetPayload<{ include: { edits: true } }>;

const sydneyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(d));
const weekday = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();

function rowOf(a: AttendanceWithEdits, opts: { date: string; today: string; breakMin: number | null; devices: Map<string, Set<string>>; point: boolean }) {
  const flags: AttendanceFlag[] = [];
  if (a.status === "TO_CONFIRM") flags.push("TO_CONFIRM");
  if (a.status === "REJECTED") flags.push("REJECTED");
  // Hire workers fill placeholder slots on the board, so only register
  // people can be "not allocated".
  if (!a.allocated && a.resourceId) flags.push("NOT_ALLOCATED");
  if (!a.signOutAt) flags.push(opts.date < opts.today ? "NO_SIGN_OUT" : "STILL_ON");
  if (a.signOutMethod === "MOVED") flags.push("MOVED");
  if (a.deviceId && (opts.devices.get(a.deviceId)?.size ?? 0) > 1) flags.push("SHARED_PHONE");
  if (opts.point) {
    const h = sydneyHour(a.signInAt);
    if (h < 4 || h >= 21) flags.push("ODD_HOURS");
    if (a.signOutAt && a.signOutAt.getTime() - a.signInAt.getTime() > 14 * 3_600_000) flags.push("LONG_DAY");
  }
  return {
    id: a.id,
    resourceId: a.resourceId,
    name: a.workerName,
    company: a.company,
    signInAt: a.signInAt.toISOString(),
    signOutAt: a.signOutAt?.toISOString() ?? null,
    in: sydneyTime(a.signInAt),
    out: sydneyTime(a.signOutAt),
    signInMethod: a.signInMethod,
    signOutMethod: a.signOutMethod,
    status: a.status,
    confirmedBy: a.confirmedBy,
    runBy: a.runBy,
    hours: a.status === "REJECTED" ? null : signedHours(a.signInAt, a.signOutAt, opts.breakMin),
    flags,
    edits: a.edits.map((e) => ({ field: e.field, before: e.before, after: e.after, reason: e.reason, editedBy: e.editedBy, editedAt: e.editedAt.toISOString() })),
  };
}

export async function attendanceForDate(date: string) {
  const today = todaySydney();
  const jobs = await prisma.job.findMany({
    where: { date: new Date(date + "T00:00:00.000Z"), status: { not: "COMPLETED" } },
    orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, shift: true, status: true, startTime: true, endTime: true,
      project: { select: { id: true, name: true, unpaidBreakMinutes: true } },
      assignments: { where: { resource: { type: "PERSONNEL" } }, select: { resource: { select: { id: true, name: true } } } },
      attendances: { orderBy: { signInAt: "asc" }, include: { edits: { orderBy: { editedAt: "asc" } } } },
    },
  });

  // Office / yard / truck sign-ins this date, and the Lobos trucks with a QR
  // (or a sign-in) - each shows as its own group.
  const [pointRows, truckPosters] = await Promise.all([
    prisma.siteAttendance.findMany({ where: { date, jobId: null }, orderBy: { signInAt: "asc" }, include: { edits: { orderBy: { editedAt: "asc" } } } }),
    prisma.siteLink.findMany({ where: { kind: "POSTER", place: "VEHICLE", revokedAt: null }, select: { resource: { select: { id: true, name: true } } } }),
  ]);

  // Phones that signed in more than one person this date.
  const devices = new Map<string, Set<string>>();
  for (const a of [...jobs.flatMap((j) => j.attendances), ...pointRows]) {
    if (!a.deviceId) continue;
    const who = a.resourceId ?? `${a.workerName}|${a.company}`;
    devices.set(a.deviceId, (devices.get(a.deviceId) ?? new Set()).add(who));
  }

  const jobGroups = jobs
    .filter((j) => j.status === "ACTIVE" || j.attendances.length > 0)
    .map((j) => {
      const breakMin = j.project?.unpaidBreakMinutes ?? null;
      const rows = j.attendances.map((a) => rowOf(a, { date, today, breakMin, devices, point: false }));
      const signedIn = new Set(j.attendances.filter((a) => a.status !== "REJECTED").map((a) => a.resourceId));
      const noShows = j.status === "ACTIVE" && date <= today
        ? j.assignments.filter((x) => !signedIn.has(x.resource.id)).map((x) => x.resource)
        : [];
      return {
        id: j.id,
        kind: "JOB" as const,
        place: null as Place | null,
        vehicleId: null as string | null,
        note: null as string | null,
        label: jobLabel(j),
        projectId: j.project?.id ?? null,
        shift: j.shift,
        times: j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : null,
        breakMinutes: breakMin,
        allocated: j.assignments.map((x) => x.resource),
        rows,
        noShows,
      };
    });

  // Office, yard, then each truck. The office lists its staff who haven't
  // signed in (weekdays); a truck shows the job it's allocated to that day.
  const pointGroup = async (place: Place, vehicleId: string | null, label: string) => {
    const mine = pointRows.filter((a) => a.place === place && (a.vehicleId ?? null) === vehicleId);
    const signedIn = new Set(mine.filter((a) => a.status !== "REJECTED").map((a) => a.resourceId));
    const staff = place === "OFFICE" ? await pointCrew("OFFICE") : [];
    const day = weekday(date);
    let note: string | null = null;
    if (vehicleId) {
      const on = await prisma.assignment.findFirst({
        where: { resourceId: vehicleId, job: { date: new Date(date + "T00:00:00.000Z"), status: { not: "COMPLETED" } } },
        select: { job: { select: { title: true, shift: true, project: { select: { name: true } } } } },
      });
      note = on ? "On the board: " + jobLabel(on.job) : "Not on the board this day";
    }
    return {
      id: place + (vehicleId ? "-" + vehicleId : ""),
      kind: "POINT" as const,
      place,
      vehicleId,
      note,
      label,
      projectId: null,
      shift: "DAY",
      times: null,
      breakMinutes: POINT_BREAK_MINUTES,
      allocated: staff,
      rows: mine.map((a) => rowOf(a, { date, today, breakMin: POINT_BREAK_MINUTES, devices, point: true })),
      noShows: place === "OFFICE" && date <= today && day >= 1 && day <= 5 ? staff.filter((p) => !signedIn.has(p.id)) : [],
    };
  };
  const trucks = new Map<string, string>();
  for (const p of truckPosters) if (p.resource) trucks.set(p.resource.id, p.resource.name);
  for (const a of pointRows) if (a.place === "VEHICLE" && a.vehicleId) trucks.set(a.vehicleId, a.placeLabel ?? "Truck");
  const points = await Promise.all([
    pointGroup("OFFICE", null, "Office"),
    pointGroup("YARD", null, "Yard"),
    ...[...trucks].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => pointGroup("VEHICLE", id, name)),
  ]);
  return { jobs: jobGroups, points };
}

// Signed-in hours per person on a job (confirmed or waiting; rejected left
// out) - what Day Review shows next to the hours box.
export async function signInHoursForJobs(jobIds: string[]) {
  const rows = await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobIds }, status: { not: "REJECTED" } },
    orderBy: { signInAt: "asc" },
    select: {
      jobId: true, resourceId: true, workerName: true, company: true, signInAt: true, signOutAt: true, status: true,
      job: { select: { project: { select: { unpaidBreakMinutes: true } } } },
    },
  });
  return rows.map((r) => ({
    jobId: r.jobId,
    resourceId: r.resourceId,
    name: r.workerName,
    company: r.company,
    in: sydneyTime(r.signInAt),
    out: sydneyTime(r.signOutAt),
    hours: signedHours(r.signInAt, r.signOutAt, r.job?.project?.unpaidBreakMinutes),
    toConfirm: r.status === "TO_CONFIRM",
  }));
}
