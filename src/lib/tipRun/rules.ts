// Regional tip run (19 Nov 2026, Ilies: shift rollover) - the plain rules, no database (./store.ts loads and saves).
// After a regional shift the supervisor or driver often tips the truck later (shift 9pm-6am, crew go home, the driver
// goes back at 8-9am when the tip opens). Instead of a second sign-in overlapping the shift, they tap "Start tip run"
// on their own phone, then "Tipped – finished". The run belongs to that shift: its job and its date (the start date).
// Tip run hours are ordinary worked hours on the shift's date, in their own "Tip run" column - never an allocation or
// a job cost, and not travel. Built like regional travel (lib/travel/rules.ts).

// Kill switch: TIP_RUN=off hides the button and refuses a new start. Existing runs still show (and can be finished).
export const tipRunOn = (env: Record<string, string | undefined> = process.env) => (env.TIP_RUN ?? "").trim().toLowerCase() !== "off";

// "Start tip run" is offered for this long after signing out of a regional shift.
export const TIP_OFFER_HOURS = 12;
// No run longer than this counts. It's also how long an open run can still be finished on the phone: after that it is
// closed at no time - flagged for the office, no hours.
export const TIP_CAP_HOURS = 6;

// ON_THE_GO: not finished yet, still inside the window (information only - but it holds up the week's approval).
// NOT_ENDED: never finished - counts nothing, for the office to sort. OVER_CAP: longer than the cap - counts nothing.
export type TipFlag = "ON_THE_GO" | "NOT_ENDED" | "OVER_CAP";
export const TIP_FLAG_LABEL: Record<TipFlag, string> = { ON_THE_GO: "on the go", NOT_ENDED: "never ended - no hours", OVER_CAP: `over ${TIP_CAP_HOURS}h - not counted` };

const HOUR = 3_600_000;
const q4 = (n: number) => Math.round(n * 4) / 4;

// Can the worker still finish this run (or is it closed at no time)?
export const tipStillOpen = (startAt: Date, endAt: Date | null, now = new Date()) => !endAt && now.getTime() - startAt.getTime() <= TIP_CAP_HOURS * HOUR;

// The hours a run counts: start to end, to the nearest quarter hour, no break taken off. null = counts nothing.
export function tipHours(startAt: Date, endAt: Date | null, now = new Date()): { hours: number | null; flag: TipFlag | null } {
  if (!endAt) return { hours: null, flag: tipStillOpen(startAt, null, now) ? "ON_THE_GO" : "NOT_ENDED" };
  const gross = (endAt.getTime() - startAt.getTime()) / HOUR;
  if (gross <= 0) return { hours: 0, flag: null };
  if (gross > TIP_CAP_HOURS) return { hours: null, flag: "OVER_CAP" };
  return { hours: q4(gross), flag: null };
}

// A run that stops the week being approved: never ended, over the cap, or still on the go (approving would lock it
// in with no hours) - like a travel leg.
export const tipBlocks = (flag: TipFlag | null) => flag === "NOT_ENDED" || flag === "OVER_CAP" || flag === "ON_THE_GO";
export const TIP_BLOCK_REASON: Record<TipFlag, string> = { NOT_ENDED: "tip run never ended", OVER_CAP: `tip run over ${TIP_CAP_HOURS}h`, ON_THE_GO: "still on a tip run" };

// ---------- who may start one, and from which shift ----------

// A shift they worked: their sign-in on a job, signed out.
export type TipShift = { attendanceId: string; regional: boolean; signOutAt: Date | null };
// The shifts "Start tip run" is offered for: regional, signed out within the window (latest first).
export function tipShifts<T extends TipShift>(shifts: T[], now = new Date()): T[] {
  return shifts
    .filter((s) => s.regional && s.signOutAt && s.signOutAt.getTime() <= now.getTime() && now.getTime() - s.signOutAt.getTime() <= TIP_OFFER_HOURS * HOUR)
    .sort((a, b) => b.signOutAt!.getTime() - a.signOutAt!.getTime());
}

// Why a tip run can't start now (null = it can).
export function startRefusal(s: { on: boolean; shift: TipShift | undefined; now?: Date; signedIn: boolean; openRun: boolean; travelling: boolean }): string | null {
  if (!s.on) return "Tip runs are switched off - sign in on the shift's QR instead.";
  if (!s.shift || !tipShifts([s.shift], s.now).length) return `A tip run is for after you sign out of a regional shift (within ${TIP_OFFER_HOURS} hours).`;
  if (s.signedIn) return "You're signed in right now - sign out first.";
  if (s.openRun) return "You've already got a tip run on the go - tap Tipped – finished first.";
  if (s.travelling) return "You've got travel on the go - finish that first.";
  return null;
}

// Does [start, end) overlap a sign-in [in, out)? An open sign-in (no out) runs to `now`.
export function overlapsSignIn(start: Date, end: Date | null, signIns: { in: Date; out: Date | null }[], now = new Date()): boolean {
  const e = (end ?? now).getTime();
  return signIns.some((x) => x.in.getTime() < e && (x.out ?? now).getTime() > start.getTime());
}

// ---------- office corrections ----------

// A corrected start / end: end after start (or none), and never over one of their sign-ins.
export function tipCorrectionError(startAt: Date, endAt: Date | null, signIns: { in: Date; out: Date | null }[], now = new Date()): string | null {
  if (Number.isNaN(startAt.getTime())) return "The start time isn't valid.";
  if (endAt && Number.isNaN(endAt.getTime())) return "The end time isn't valid.";
  if (endAt && endAt <= startAt) return "The end must be after the start.";
  if (overlapsSignIn(startAt, endAt, signIns, now)) return "That would overlap one of their sign-ins - a tip run can't.";
  return null;
}
