// Travel to and from regional jobs (2 Nov 2026, Ilies) - the plain rules, no database (./store.ts loads and saves).
// Two legs, regional projects only:
//   OUT  - the worker taps "Start travel" on their phone; their site sign-in on that project ends it.
//   HOME - after signing out of a regional job they tap "Travelling home"; "Arrived" ends it.
// Travel hours are their own column: never site hours, never a JobActual, never a cost.
// Travel pay (Ilies, 23-24 Nov 2026): see paidTravelHours below - hours only, never a dollar figure.

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

// ---------- travel pay (Ilies, 23-24 Nov 2026) ----------
// 1. Truck driver: signs in on the truck QR for the drive - that sign-in already counts the hours. Never a travel leg
//    (Start travel is refused while they're signed in on a truck - truckRefusal).
// 2. Passenger: paid 1 hour less than the leg takes, once each way - max(0, leg hours - 1) per leg (out and home apart).
// 3. Own car or ute: a driver - the leg is paid in full.
// The worker picks 2 or 3 on the phone before the leg starts. Legs recorded before this was asked have no mode: no
// paid figure, "mode not recorded" for the office (who can set it with a reason).

export type TravelMode = "DRIVER_OWN_VEHICLE" | "PASSENGER";
export const TRAVEL_MODES: readonly TravelMode[] = ["DRIVER_OWN_VEHICLE", "PASSENGER"];
// The two big buttons on the phone.
export const MODE_BUTTON: Record<TravelMode, string> = { DRIVER_OWN_VEHICLE: "I'm driving my own car/ute", PASSENGER: "I'm a passenger" };
// Short words for the office screens and the exports.
export const MODE_LABEL: Record<TravelMode, string> = { DRIVER_OWN_VEHICLE: "own vehicle", PASSENGER: "passenger" };
export const MODE_NOT_RECORDED = "mode not recorded";
export const PASSENGER_LESS_HOURS = 1;
// The rule in one line, for the payroll screen and the summary file.
export const TRAVEL_PAY_RULE = `passenger: ${PASSENGER_LESS_HOURS} hour less each way; driving own car/ute: in full; truck driver: the truck sign-in counts the drive`;

export const isTravelMode = (v: unknown): v is TravelMode => typeof v === "string" && (TRAVEL_MODES as readonly string[]).includes(v);
// A mode as stored (anything else - an old leg, a bad value - is "not recorded").
export const modeOf = (v: unknown): TravelMode | null => (isTravelMode(v) ? v : null);

// The paid travel hours of one leg. hours = legHours(...).hours (already to the quarter hour); null = the leg counts
// nothing (on the way, never ended, over the cap) - still nothing paid. No mode = no paid figure (null).
export function paidTravelHours(hours: number | null | undefined, mode: TravelMode | null | undefined): number | null {
  if (hours == null || !mode) return null;
  if (mode === "DRIVER_OWN_VEHICLE") return hours;
  return Math.max(0, q4(hours - PASSENGER_LESS_HOURS));
}

// A leg the office should look at for pay: it has hours but no mode (recorded before the question was asked).
export const modeMissing = (t: { hours: number | null; mode?: TravelMode | null }) => t.hours != null && !t.mode;

// "Travel 2h · paid 1h (passenger)" - the words on the office screens. hours null = counts nothing.
export function paidText(t: { hours: number | null; mode?: TravelMode | null; paidHours?: number | null }): string {
  if (t.hours == null) return "";
  if (!t.mode) return MODE_NOT_RECORDED;
  return `paid ${t.paidHours ?? paidTravelHours(t.hours, t.mode)}h (${MODE_LABEL[t.mode]})`;
}

// Start travel / Travelling home needs the choice first.
export const MODE_REQUIRED = "Tap one first: I'm driving my own car/ute, or I'm a passenger.";
export const modeRefusal = (mode: unknown): string | null => (isTravelMode(mode) ? null : MODE_REQUIRED);

// Signed in on a truck (truck QR, not signed out): that sign-in already counts the drive - no travel on top of it.
export const TRUCK_REFUSAL = "You're signed in on the truck - that already counts your drive. No need to start travel.";
export const truckRefusal = (openTruckSignIn: boolean): string | null => (openTruckSignIn ? TRUCK_REFUSAL : null);

// ---------- office corrections ----------

// A corrected start / end: end after start (or none). Returns an error, or null.
export function correctionError(startAt: Date, endAt: Date | null): string | null {
  if (Number.isNaN(startAt.getTime())) return "The start time isn't valid.";
  if (endAt && Number.isNaN(endAt.getTime())) return "The end time isn't valid.";
  if (endAt && endAt <= startAt) return "The end must be after the start.";
  return null;
}
