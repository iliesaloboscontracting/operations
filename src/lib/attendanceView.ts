// The office's view of site sign-ins for a date (19 Oct 2026): each job's
// allocated crew next to who actually signed in, the hours that works out
// to, and what needs a look. Times only - never a dollar figure.
import type { Prisma } from "@prisma/client";
import { effectiveTimes } from "./shiftTimes";
import { prisma } from "./prisma";
import { jobLabel, pointCrew, POINT_BREAK_MINUTES, signedHours, sydneyTime, type Place } from "./signin";
import { todaySydney } from "./today";
import { matchHireSignIns } from "./labourHireMatch";
import type { LineHours } from "./dayHours";
import { dayHoursFor } from "./dayHoursStore";
import { staffSuggestions, type StaffMatch } from "./staffMatch";
import { flagsForJobRows, flagSummary, signedInEarlierIds, type SigninFlagSummary } from "./signinFlags";
import { posterGpsFlags } from "./posterGuard/store";
import { locationLabel, signInHow, signOutHow } from "./signinHow";

export type AttendanceFlag =
  | "NO_SIGN_IN" // allocated, never signed in
  | "STILL_ON" // signed in today, not out yet
  | "NO_SIGN_OUT" // an earlier day, never signed out
  | "NOT_ALLOCATED" // signed in on a job they weren't allocated to
  | "NO_HIRE_TILE" // labour hire signed in, but no labour hire tile left on that job
  | "TO_CONFIRM" // poster sign-in waiting for the supervisor
  | "MOVED" // signed in at another site, so this one was ended
  | "SHARED_PHONE" // one phone signed in more than one person that day
  | "REJECTED" // supervisor said they weren't there
  | "ODD_HOURS" // office / yard / truck: signed in before 4am or after 9pm
  | "LONG_DAY" // office / yard / truck: more than 14 hours signed in
  | "OVERLAP" // overlapped another of their sign-ins that day - the shared time counted once (2 Nov 2026)
  | "LOOKS_LIKE_STAFF" // a hire sign-in that looks like Lobos staff (company Lobos, or a staff member's name) - fix 4
  // 10 Nov 2026 (Ilies: "do A and B") - information only (lib/signinFlags.ts); the words are in the row's notes.
  | "LATE_IN" // signed in more than 60 min after the job's start (and not signed in anywhere earlier that day)
  | "LONG_SHIFT" // signed out more than 2 h after the job's finish, or over 12 h on the line
  | "BULK_OUT" // ...and signed out with 2+ others in the same minute by the supervisor / office
  // 11 Nov 2026 (Ilies: "do 1 and 2") - site poster sign-ins only, information only (lib/posterGuard).
  | "NO_LOCATION" // the phone shared no position
  | "FAR_FROM_SITE"; // further than 500 m (+ the fix's accuracy) from where the site's crew sign in

type AttendanceWithEdits = Prisma.SiteAttendanceGetPayload<{ include: { edits: true } }>;

const sydneyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(d));
const weekday = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();

function rowOf(
  a: AttendanceWithEdits,
  // slot: the labour hire tile a hire worker fills on this job (null = none left); undefined for staff / points.
  opts: { date: string; today: string; breakMin: number | null; devices: Map<string, Set<string>>; point: boolean; slot?: string | null; day: Map<string, LineHours>; staff?: StaffMatch[]; handoverNames?: Set<string> }
) {
  // How they signed in / out and whether the phone shared its location (11 Nov 2026) - words and the status only,
  // never the position (that stays accounts / Admin only). A hand-over's QR and ticks carry the stand-in's name.
  const how = { place: a.place, handover: !!a.runBy && !!opts.handoverNames?.has(a.runBy) };
  const flags: AttendanceFlag[] = [];
  if (a.status === "TO_CONFIRM") flags.push("TO_CONFIRM");
  if (a.status === "REJECTED") flags.push("REJECTED");
  // Staff: not on this job's allocation. Hire workers: no labour hire tile
  // left on this job for them (lib/labourHireMatch.ts).
  if (!a.allocated && a.resourceId) flags.push("NOT_ALLOCATED");
  if (opts.slot === null && a.status !== "REJECTED") flags.push("NO_HIRE_TILE");
  if (!a.signOutAt) flags.push(opts.date < opts.today ? "NO_SIGN_OUT" : "STILL_ON");
  if (a.signOutMethod === "MOVED") flags.push("MOVED");
  if (opts.day.get(a.id)?.overlap && a.status !== "REJECTED") flags.push("OVERLAP");
  const staffLike = !a.resourceId && a.status !== "REJECTED" ? staffSuggestions({ name: a.workerName, company: a.company }, opts.staff ?? []) : null;
  if (staffLike) flags.push("LOOKS_LIKE_STAFF");
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
    slot: opts.slot ?? null,
    signInAt: a.signInAt.toISOString(),
    signOutAt: a.signOutAt?.toISOString() ?? null,
    in: sydneyTime(a.signInAt),
    out: sydneyTime(a.signOutAt),
    signInMethod: a.signInMethod,
    signOutMethod: a.signOutMethod,
    how: signInHow(a.signInMethod, how),
    howOut: signOutHow(a.signInMethod, a.signOutMethod, how),
    gpsStatus: a.gpsStatus,
    location: locationLabel(a.gpsStatus),
    status: a.status,
    confirmedBy: a.confirmedBy,
    runBy: a.runBy,
    hours: a.status === "REJECTED" ? null : opts.day.get(a.id)?.hours ?? null,
    breakTaken: opts.day.get(a.id)?.breakMinutes ?? 0,
    staffLike, // fix 4: the staff it may be ("Move to <person>" on the Sign-ins page)
    flags,
    notes: {} as Record<string, string>, // the words for a flag (10 Nov 2026), e.g. LATE_IN: "Signed in 3:05pm – job starts 7am"
    edits: a.edits.map((e) => ({ field: e.field, before: e.before, after: e.after, reason: e.reason, editedBy: e.editedBy, editedAt: e.editedAt.toISOString() })),
  };
}

export async function attendanceForDate(date: string) {
  const today = todaySydney();
  const jobs = await prisma.job.findMany({
    where: { date: new Date(date + "T00:00:00.000Z"), status: { not: "COMPLETED" }, cancelledAt: null },
    orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, shift: true, status: true, startTime: true, endTime: true,
      project: { select: { id: true, name: true, unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: {
        where: { resource: { OR: [{ type: "PERSONNEL" }, { type: "HIRE", category: "LABOUR" }] } },
        select: { resource: { select: { id: true, name: true, type: true } } },
      },
      attendances: { where: { removedAt: null }, orderBy: { signInAt: "asc" }, include: { edits: { orderBy: { editedAt: "asc" } } } },
    },
  });

  // Office / yard / truck sign-ins this date, and the Lobos trucks with a QR
  // (or a sign-in) - each shows as its own group.
  const [pointRows, truckPosters] = await Promise.all([
    prisma.siteAttendance.findMany({ where: { date, jobId: null, removedAt: null }, orderBy: { signInAt: "asc" }, include: { edits: { orderBy: { editedAt: "asc" } } } }),
    prisma.siteLink.findMany({ where: { kind: "POSTER", place: "VEHICLE", revokedAt: null }, select: { resource: { select: { id: true, name: true } } } }),
  ]);

  // Hours per person per day (one break over 5 h, overlaps once - lib/dayHours.ts), and the active staff a hire
  // sign-in might really be (fix 4).
  const [dayMap, staffAll] = await Promise.all([
    dayHoursFor([...jobs.flatMap((j) => j.attendances), ...pointRows]),
    prisma.resource.findMany({ where: { type: "PERSONNEL", active: true }, select: { id: true, name: true } }),
  ]);

  // Phones that signed in more than one person this date.
  const devices = new Map<string, Set<string>>();
  for (const a of [...jobs.flatMap((j) => j.attendances), ...pointRows]) {
    if (!a.deviceId) continue;
    const who = a.resourceId ?? `${a.workerName}|${a.company}`;
    devices.set(a.deviceId, (devices.get(a.deviceId) ?? new Set()).add(who));
  }

  // 10 Nov 2026: who was already signed in somewhere earlier that day (coming on late there isn't missing hours), and
  // the staff with any sign-in at all that day - site, office, yard or truck, any job (completed ones too).
  const dayRows = [...jobs.flatMap((j) => j.attendances), ...pointRows];
  const earlier = signedInEarlierIds(dayRows.map((a) => ({ id: a.id, key: a.resourceId ?? `${a.workerName}|${a.company ?? ""}`, signInAt: a.signInAt, status: a.status })));
  const signedAnywhere = new Set(
    (await prisma.siteAttendance.findMany({ where: { date, removedAt: null, status: { not: "REJECTED" }, resourceId: { not: null } }, select: { resourceId: true } }))
      .map((a) => a.resourceId!),
  );

  // 11 Nov 2026: site poster sign-ins with no location / far from the site (lib/posterGuard), and the stand-ins whose
  // hand-over link ran a job's sign-in (so the line says "Hand-over QR" / "Hand-over tick").
  const [gpsByJob, handovers] = await Promise.all([
    Promise.all(jobs.map(async (j) => [j.id, await posterGpsFlags(j.attendances, j.project?.id ?? null, date)] as const)).then((x) => new Map(x)),
    prisma.siteLink.findMany({ where: { kind: "HANDOVER", jobId: { in: jobs.map((j) => j.id) } }, select: { jobId: true, resource: { select: { name: true } } } }),
  ]);
  const handoverNames = (jobId: string) => new Set(handovers.filter((h) => h.jobId === jobId && h.resource).map((h) => h.resource!.name));

  const jobGroups = jobs
    .filter((j) => j.status === "ACTIVE" || j.attendances.length > 0)
    .map((j) => {
      const breakMin = j.project?.unpaidBreakMinutes ?? null;
      const staff = j.assignments.filter((x) => x.resource.type === "PERSONNEL").map((x) => ({ id: x.resource.id, name: x.resource.name }));
      const tiles = j.assignments.filter((x) => x.resource.type === "HIRE").map((x) => ({ id: x.resource.id, name: x.resource.name }));
      // Labour hire sign-ins paired with this job's labour hire tiles.
      const slots = matchHireSignIns(tiles, j.attendances.filter((a) => !a.resourceId));
      const times = effectiveTimes(j, j.project);
      // Late sign-in / long day / signed out together (10 Nov 2026) - information only, hours unchanged.
      const extra = flagsForJobRows(
        j.attendances.map((a) => ({ id: a.id, signInAt: a.signInAt, signOutAt: a.signOutAt, signOutMethod: a.signOutMethod, status: a.status, signedInEarlier: earlier.has(a.id) })),
        { date, shift: j.shift, start: times.start, end: times.end },
      );
      const gps = gpsByJob.get(j.id);
      const stand = handoverNames(j.id);
      const rows = j.attendances.map((a) => {
        const r = rowOf(a, { date, today, breakMin, devices, point: false, slot: a.resourceId ? undefined : slots.get(a.id)?.name ?? null, day: dayMap, staff: staffAll, handoverNames: stand });
        const x = extra.get(a.id);
        if (x) { r.flags.push(...x.flags); Object.assign(r.notes, x.notes); }
        const p = gps?.get(a.id);
        if (p) { r.flags.push(p.flag); r.notes[p.flag] = p.note; }
        return r;
      });
      const signedIn = new Set(j.attendances.filter((a) => a.status !== "REJECTED").map((a) => a.resourceId));
      const filled = new Set([...slots.values()].map((t) => t.id));
      // staff: a Lobos (Personnel) no-show - nowhere: no sign-in anywhere that day (10 Nov 2026, "On the board, no
      // sign-in"); a labour hire tile is neither.
      const noShows: { id: string; name: string; staff?: boolean; nowhere?: boolean }[] = j.status === "ACTIVE" && date <= today
        ? [
            ...staff.filter((p) => !signedIn.has(p.id)).map((p) => ({ ...p, staff: true, nowhere: !signedAnywhere.has(p.id) })),
            ...tiles.filter((t) => !filled.has(t.id)),
          ]
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
        // The job's own times, else the project's usual hours for the shift.
        startTime: effectiveTimes(j, j.project).start,
        endTime: effectiveTimes(j, j.project).end,
        breakMinutes: breakMin,
        allocated: [...staff, ...tiles],
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
      startTime: null as string | null,
      endTime: null as string | null,
      breakMinutes: POINT_BREAK_MINUTES,
      allocated: staff,
      rows: mine.map((a) => rowOf(a, { date, today, breakMin: POINT_BREAK_MINUTES, devices, point: true, day: dayMap, staff: staffAll })),
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
  // The Sign-ins page's strip (10 Nov 2026): "N to confirm · N late · N long day · N no sign-in".
  return { jobs: jobGroups, points, summary: flagSummary([...points, ...jobGroups]) };
}

// The Sign-ins page's strip added up over several days (10 Nov 2026 - the Timesheets page's "need sorting" banner).
// The same days the Sign-ins page shows, so the counts always agree with it. Counts only.
export async function flagSummaryForDays(dates: string[]): Promise<SigninFlagSummary> {
  const total: SigninFlagSummary = { toConfirm: 0, late: 0, longDay: 0, noSignIn: 0, location: 0 };
  for (const d of dates) {
    const s = (await attendanceForDate(d)).summary;
    for (const k of Object.keys(total) as (keyof SigninFlagSummary)[]) total[k] += s[k];
  }
  return total;
}

// Signed-in hours per person on a job (confirmed or waiting; rejected left
// out) - what Day Review shows next to the hours box.
export async function signInHoursForJobs(jobIds: string[]) {
  const rows = await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobIds }, status: { not: "REJECTED" } },
    orderBy: { signInAt: "asc" },
    select: {
      id: true, jobId: true, date: true, resourceId: true, workerName: true, company: true, signInAt: true, signOutAt: true, status: true,
      job: { select: { project: { select: { unpaidBreakMinutes: true } } } },
    },
  });
  // A labour hire sign-in counts against the tile it fills on that job.
  const tiles = await prisma.assignment.findMany({
    where: { jobId: { in: jobIds }, resource: { type: "HIRE", category: "LABOUR" } },
    select: { jobId: true, resource: { select: { id: true, name: true } } },
  });
  const slot = new Map<string, { id: string; name: string }>();
  for (const jobId of jobIds) {
    const m = matchHireSignIns(tiles.filter((t) => t.jobId === jobId).map((t) => t.resource), rows.filter((r) => r.jobId === jobId && !r.resourceId).map((r) => ({ ...r, workerName: r.workerName })));
    m.forEach((t, id) => slot.set(id, t));
  }
  // A person's whole day counts (their truck / office / other-site lines too): one break over 5 h, overlaps once.
  const day = await dayHoursFor(rows);
  return rows.map((r) => ({
    jobId: r.jobId,
    resourceId: r.resourceId ?? slot.get(r.id)?.id ?? null,
    tile: r.resourceId ? null : slot.get(r.id)?.name ?? null,
    name: r.workerName,
    company: r.company,
    in: sydneyTime(r.signInAt),
    out: sydneyTime(r.signOutAt),
    hours: day.get(r.id)?.hours ?? null,
    toConfirm: r.status === "TO_CONFIRM",
  }));
}
