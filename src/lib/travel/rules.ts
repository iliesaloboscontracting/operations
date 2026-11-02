// Travel to and from regional jobs (2 Nov 2026, Ilies) - the plain rules, no database (./store.ts loads and saves).
// Two legs, regional projects only:
//   OUT  - the worker taps "Start travel" on their phone; their site sign-in on that project ends it.
//   HOME - after signing out of a regional job they tap "Travelling home"; "Arrived" ends it.
// Travel hours are their own column: never site hours, never a JobActual, never a cost, and no pay rule here
// (whether and how travel is paid is a separate decision with accounts).

export type Direction = "OUT" | "HOME";
export const DIRECTION_LABEL: Record<Direction, string> = { OUT: "Travel out", HOME: "Travel home" };

// No leg longer than this counts (Ilies). It is also how long an un-ended leg can still be ended by the worker:
// after that it is closed at no time - flagged for the office, no hours.
export const TRAVEL_CAP_HOURS = 8;
// "Travelling home" is offered after a sign-out on a regional job within this long of signing out.
export const HOME_OFFER_HOURS = 8;

// ON_THE_WAY: not ended yet, still inside the window (information only).
// NOT_ENDED: never ended - closed at no time, counts nothing, for the office to sort.
// OVER_CAP: longer than the cap - counts nothing, for the office to check.
export type TravelFlag = "ON_THE_WAY" | "NOT_ENDED" | "OVER_CAP";
export const FLAG_LABEL: Record<TravelFlag, string> = { ON_THE_WAY: "on the way", NOT_ENDED: "never ended - no hours", OVER_CAP: `over ${TRAVEL_CAP_HOURS}h - not counted` };

const HOUR = 3_600_000;
const q4 = (n: number) => Math.round(n * 4) / 4;

// Can the worker still end this leg (or is it closed at no time)?
export const stillOpen = (startAt: Date, endAt: Date | null, now = new Date()) => !endAt && now.getTime() - startAt.getTime() <= TRAVEL_CAP_HOURS * HOUR;

// The hours a leg counts: start to end, to the nearest quarter hour, no break taken off. null = counts nothing.
export function legHours(startAt: Date, endAt: Date | null, now = new Date()): { hours: number | null; flag: TravelFlag | null } {
  if (!endAt) return { hours: null, flag: stillOpen(startAt, null, now) ? "ON_THE_WAY" : "NOT_ENDED" };
  const gross = (endAt.getTime() - startAt.getTime()) / HOUR;
  if (gross <= 0) return { hours: 0, flag: null };
  if (gross > TRAVEL_CAP_HOURS) return { hours: null, flag: "OVER_CAP" };
  return { hours: q4(gross), flag: null };
}

// A flag the office has to look at (ON_THE_WAY is not one).
export const needsOffice = (flag: TravelFlag | null) => flag === "NOT_ENDED" || flag === "OVER_CAP";

// ---------- the travel pass (AT-001, Ilies 2 Nov 2026: "Supervisor QR only") ----------

// A phone gets its travel pass only from a sign-in that proves the person was really there on regional work: on a
// job (not an office / yard / truck point), on the supervisor's changing QR (a poster doesn't count - a photo of it
// works anywhere), on that job's allocation, and with regional work on their board.
export function passAllowed(s: { jobId: string | null; method: string; allocated: boolean; regionalWork: boolean }) {
  return !!s.jobId && s.method === "SUPERVISOR_QR" && s.allocated && s.regionalWork;
}

// ---------- what the worker's phone may do ----------

export type OutCandidate = { jobId: string; regional: boolean; signedIn: boolean; existingLeg: boolean };
// Why "Start travel" isn't allowed for this job, or null when it is.
export function outRefusal(c: OutCandidate | undefined): string | null {
  if (!c) return "Travel sign-in is only for the regional jobs you're on today.";
  if (!c.regional) return "Travel sign-in is only for regional jobs.";
  if (c.signedIn) return "You're already signed in on site.";
  return null; // an existing leg isn't a refusal - the phone is shown that one instead (no duplicate)
}

export type HomeCandidate = { attendanceId: string; regional: boolean; signOutAt: Date | null; existingLeg: boolean };
// The sign-out "Travelling home" follows: the latest one on a regional job, within the window, not already used.
export function homeFrom(candidates: HomeCandidate[], now = new Date()): HomeCandidate | null {
  const ok = candidates
    .filter((c) => c.regional && c.signOutAt && now.getTime() - c.signOutAt.getTime() <= HOME_OFFER_HOURS * HOUR && c.signOutAt.getTime() <= now.getTime())
    .sort((a, b) => b.signOutAt!.getTime() - a.signOutAt!.getTime());
  return ok[0] && !ok[0].existingLeg ? ok[0] : null;
}

// ---------- office corrections ----------

// A corrected start / end: end after start (or none). Returns an error, or null.
export function correctionError(startAt: Date, endAt: Date | null): string | null {
  if (Number.isNaN(startAt.getTime())) return "The start time isn't valid.";
  if (endAt && Number.isNaN(endAt.getTime())) return "The end time isn't valid.";
  if (endAt && endAt <= startAt) return "The end must be after the start.";
  return null;
}
