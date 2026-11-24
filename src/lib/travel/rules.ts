// Travel to and from regional jobs (2 Nov 2026, Ilies) - the plain rules, no database (./store.ts loads and saves).
// Two legs, regional projects only:
//   OUT  - the worker taps "Start travel" on their phone; their site sign-in on that project ends it.
//   HOME - after signing out of a regional job they tap "Travelling home"; "Arrived" ends it.
// Travel hours are their own column: never site hours, never a JobActual, never a cost.
// Travel pay (Ilies, 23-24 Nov 2026): see paidTravelHours below - hours only, never a dollar figure.
// Who records it (Ilies, 24 Nov 2026): only link-holders (TRAVEL_LINK_KINDS); crew's travel is worked out from their
// driver (./derive.ts). TP-001: a leg over the person's own sign-ins counts nothing (legVerdict).
import { overlapsSignIn } from "../tipRun/rules";

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
// SIGNIN_OVERLAP (TP-001, Ilies 24 Nov 2026): the leg runs over one of that person's own sign-ins (e.g. a Yard sign-in
//   still open during the drive) - counts nothing and blocks the week until the office trims one or the other.
// NO_DRIVER (24 Nov 2026, "stay amber"): crew on a regional job with no link-holder to work their travel out from -
//   counts nothing, amber, never blocks the week; the office can add the leg by hand.
export type TravelFlag = "ON_THE_WAY" | "NOT_ENDED" | "OVER_CAP" | "SIGNIN_OVERLAP" | "NO_DRIVER";
export const FLAG_LABEL: Record<TravelFlag, string> = {
  ON_THE_WAY: "on the way", NOT_ENDED: "never ended - no hours", OVER_CAP: `over ${TRAVEL_CAP_HOURS}h - not counted`,
  SIGNIN_OVERLAP: "overlaps a sign-in - not paid", NO_DRIVER: "no driver found",
};

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

// A flag the office has to look at before the week can be approved (ON_THE_WAY and NO_DRIVER are not one).
export const needsOffice = (flag: TravelFlag | null) => flag === "NOT_ENDED" || flag === "OVER_CAP" || flag === "SIGNIN_OVERLAP";
// Amber on the screens: needsOffice, or crew with no driver found (amber, but never in the way of the approval).
export const amberFlag = (flag: TravelFlag | null) => needsOffice(flag) || flag === "NO_DRIVER";

// ---------- TP-001: a leg never runs over the person's own sign-ins ----------

export type OwnSignIn = { id: string; in: Date; out: Date | null; place?: string | null; placeLabel?: string | null };
// The hours a leg counts, checked against the person's own sign-ins (not rejected or removed). A leg that would count
// but overlaps one of them counts nothing - SIGNIN_OVERLAP. A leg already counting nothing keeps its own flag. `skip`:
// a sign-in that belongs to the leg itself (crew: the site sign-in / sign-out their travel is worked out from).
export function legVerdict(startAt: Date, endAt: Date | null, own: OwnSignIn[], now = new Date(), skip: string[] = []): { hours: number | null; flag: TravelFlag | null } {
  const v = legHours(startAt, endAt, now);
  if (v.hours == null) return v;
  return overlapping(startAt, endAt, own, now, skip).length ? { hours: null, flag: "SIGNIN_OVERLAP" } : v;
}
// The person's sign-ins a leg runs over (shared time > 0; touching end to start is not an overlap).
export function overlapping(startAt: Date, endAt: Date | null, own: OwnSignIn[], now = new Date(), skip: string[] = []): OwnSignIn[] {
  return own.filter((x) => !skip.includes(x.id) && overlapsSignIn(startAt, endAt, [x], now));
}

// Option A (Ilies, 24 Nov 2026): crew rarely sign in at the Yard / Office before a regional drive ("the people that are
// usually at the yard are the drivers"). When one does and it runs into the drive out, the leg stays flagged until the
// office taps "End yard sign-in when the truck left" - that point sign-in's sign-out is set to the departure, through the
// ordinary office sign-in change (Manager+, the reason below kept in AttendanceEdit, locked weeks refuse). Never done
// automatically. Offered only for a drive OUT that runs over exactly one sign-in, a Yard / Office point one that started
// before the departure.
// currentSignOutAt: the sign-out it has now (TP-011: the button asks first, showing before -> after).
export type PointFix = { attendanceId: string; signOutAt: string; currentSignOutAt: string | null; label: string; reason: string };
export function pointFixFor(direction: Direction, overlaps: OwnSignIn[], departure: Date, ctx: { site: string; driver: string | null; truck: boolean }): PointFix | null {
  if (direction !== "OUT" || overlaps.length !== 1) return null;
  const p = overlaps[0];
  if ((p.place !== "YARD" && p.place !== "OFFICE") || p.in.getTime() >= departure.getTime()) return null;
  const where = p.place === "YARD" ? "yard" : "office";
  return {
    attendanceId: p.id, signOutAt: departure.toISOString(), currentSignOutAt: p.out?.toISOString() ?? null,
    label: ctx.truck ? `End ${where} sign-in when the truck left` : `End ${where} sign-in when travel started`,
    reason: ctx.driver
      ? `Rode to ${ctx.site} with ${ctx.driver} - travel counted instead (option A, Ilies 24 Nov 2026)`
      : `Travelled to ${ctx.site} - travel counted instead (option A, Ilies 24 Nov 2026)`,
  };
}

// ---------- who records travel (Ilies, 24 Nov 2026) ----------
// Only people with their own SUPERVISOR or DRIVER link (not switched off) record travel on their phone. Everyone else
// riding along records nothing: their travel is worked out from the driver they travelled with (./derive.ts).
export const TRAVEL_LINK_KINDS = ["SUPERVISOR", "DRIVER"] as const;
export const NO_LINK_REFUSAL = "Travel is recorded by your driver - nothing to do.";
export const linkRefusal = (hasLink: boolean): string | null => (hasLink ? null : NO_LINK_REFUSAL);
// TP-007a (Ilies, 24 Nov 2026): who held a link is read on the trip's date, not today - a link counts on a day when it
// was made on or before that day (Sydney) and was not switched off, or was switched off after it. So someone given a
// link later keeps their earlier trips as crew (worked out from the driver), and a link switched off later keeps its
// past legs (and the crew worked out from them).
export const sydneyDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
export const linkCountsOn = (l: { createdAt: Date; revokedAt: Date | null }, date: string) =>
  sydneyDate(l.createdAt) <= date && (!l.revokedAt || sydneyDate(l.revokedAt) > date);

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

// ---------- travel pay (Ilies, 23-24 Nov 2026; who records it, 24 Nov 2026) ----------
// 1. Truck driver (a link-holder): signs in on the truck QR for the drive out and again for the drive back - those
//    sign-ins already count the hours. Never a travel leg (Start travel is refused while on a truck - truckRefusal).
// 2. A link-holder riding as a passenger: "I'm a passenger" - paid 1 hour less than the leg takes, once each way -
//    max(0, leg hours - 1) per leg (out and home apart).
// 3. A link-holder driving their own car or ute: the leg is paid in full.
// 4. Crew with no link: nothing to record. Their travel is the drive of the link-holder they travelled with (./derive.ts),
//    paid like a passenger: 1 hour less each way.
// Link-holders pick 2 or 3 on the phone before the leg starts. Legs recorded before this was asked have no mode: no
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
export const TRAVEL_PAY_RULE = `crew riding along: worked out from their driver, ${PASSENGER_LESS_HOURS} hour less each way; passenger: ${PASSENGER_LESS_HOURS} hour less each way; driving own car/ute: in full; truck driver: the truck sign-in counts the drive`;

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

// "Travel 2h · paid 1h (passenger)" - the words on the office screens. hours null = counts nothing. via: crew's travel
// worked out from their driver - "paid 1h (with Turori's truck, Tipper - CN03RK)".
export function paidText(t: { hours: number | null; mode?: TravelMode | null; paidHours?: number | null; via?: string | null }): string {
  if (t.hours == null) return "";
  if (!t.mode) return MODE_NOT_RECORDED;
  return `paid ${t.paidHours ?? paidTravelHours(t.hours, t.mode)}h (${t.via || MODE_LABEL[t.mode]})`;
}

// For the office: legs with hours but no mode, and crew with no driver found - neither has a paid figure (TP-003 counts
// them in Victoria's approval).
export const noDriver = (t: { flag?: TravelFlag | null }) => t.flag === "NO_DRIVER";
// TP-008c: "2 drivers possible" - more than one link-holder could have been the driver (information only).
export const driversPossibleText = (n: number | null | undefined) => (n && n > 1 ? `${n} drivers possible` : "");

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

// TP-009 / TP-013: an office leg (added or corrected) sits on its job's day, one day either side (Sydney). date = the
// job's day (YYYY-MM-DD). An open end is checked by its start. Returns an error, or null.
export const JOB_DAY_REFUSAL = "The times need to be on the job's day (or the day either side).";
const dayShift = (date: string, n: number) => new Date(new Date(date + "T00:00:00.000Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
export function jobDayRefusal(date: string, startAt: Date, endAt: Date | null): string | null {
  const from = new Date(`${dayShift(date, -1)}T00:00:00+11:00`), to = new Date(`${dayShift(date, 2)}T00:00:00+10:00`);
  return startAt < from || (endAt ?? startAt) > to ? JOB_DAY_REFUSAL : null;
}

// TP-009 / TP-013: the first of the person's other travel lines these times run over (an open end - this leg's or
// theirs - counts as the 8h cap). The caller picks the lines: that person's, never NO_DRIVER, never the leg itself.
type Span = { direction: Direction; start: string; end: string | null; startAt: string; endAt: string | null };
export function travelClash<T extends Span>(startAt: Date, endAt: Date | null, others: T[]): T | undefined {
  const s0 = startAt.getTime(), e0 = endAt ? endAt.getTime() : s0 + TRAVEL_CAP_HOURS * HOUR;
  return others.find((l) => {
    const s = new Date(l.startAt).getTime(), e = l.endAt ? new Date(l.endAt).getTime() : s + TRAVEL_CAP_HOURS * HOUR;
    return s0 < e && e0 > s;
  });
}
export const clashRefusal = (c: Span) => `Those times run over their ${DIRECTION_LABEL[c.direction].toLowerCase()} (${c.start}-${c.end ?? "not ended"}) - trim them first.`;
