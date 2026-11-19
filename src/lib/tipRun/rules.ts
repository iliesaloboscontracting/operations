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
// OVERLAPS_SIGN_IN (SR-003): the run overlaps one of their sign-ins (e.g. one the office added later) - counts nothing.
// SHIFT_REMOVED (SR-004): the shift sign-in it follows was rejected or removed - counts nothing.
export type TipFlag = "ON_THE_GO" | "NOT_ENDED" | "OVER_CAP" | "OVERLAPS_SIGN_IN" | "SHIFT_REMOVED";
export const TIP_FLAG_LABEL: Record<TipFlag, string> = {
  ON_THE_GO: "on the go", NOT_ENDED: "never ended - no hours", OVER_CAP: `over ${TIP_CAP_HOURS}h - not counted`,
  OVERLAPS_SIGN_IN: "overlaps a sign-in - not counted", SHIFT_REMOVED: "shift sign-in removed - not counted",
};

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
// Every flag blocks (SR-003 / SR-004: an overlap or a removed shift sign-in too).
export const tipBlocks = (flag: TipFlag | null) => flag !== null;
export const TIP_BLOCK_REASON: Record<TipFlag, string> = {
  NOT_ENDED: "tip run never ended", OVER_CAP: `tip run over ${TIP_CAP_HOURS}h`, ON_THE_GO: "still on a tip run",
  OVERLAPS_SIGN_IN: "tip run overlaps a sign-in", SHIFT_REMOVED: "tip run's shift sign-in was removed",
};
// The office needs to look (everything except a run still on the go).
export const tipNeedsOffice = (flag: TipFlag | null) => flag !== null && flag !== "ON_THE_GO";

// A run as it counts, checked against the person's sign-ins (SR-003 / SR-004). `shift`: the sign-in it follows (null =
// not found); `signIns`: their sign-ins that aren't rejected or removed. A removed shift or an overlap counts nothing.
export function tipVerdict(
  run: { startAt: Date; endAt: Date | null },
  shift: { status: string; removedAt: Date | null } | null,
  signIns: { in: Date; out: Date | null }[],
  now = new Date(),
): { hours: number | null; flag: TipFlag | null } {
  if (!shift || shift.status === "REJECTED" || shift.removedAt) return { hours: null, flag: "SHIFT_REMOVED" };
  // A run never finished is only looked at over the time it could still have run (the 6 h window), not up to today.
  const end = run.endAt ?? new Date(Math.min(now.getTime(), run.startAt.getTime() + TIP_CAP_HOURS * HOUR));
  if (overlapsSignIn(run.startAt, end, signIns, now)) return { hours: null, flag: "OVERLAPS_SIGN_IN" };
  return tipHours(run.startAt, run.endAt, now);
}

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

// Everything that stops a START, in order (SR-001 / SR-002 / SR-011, 19 Nov 2026): not an active Labour-register
// person, the shift rules above, an approved (locked) week, and a run already made by them for that shift's job
// (finished ones too - runs can't be chained past the 6 h cap). Null = go; else the words and the status.
export const SAME_SHIFT_RUN = "There's already a tip run for this shift – ask the office to change it.";
export const LOCKED_WEEK_RUN = "That week's timesheet has been approved – ask the office.";
export function startDecision(s: Parameters<typeof startRefusal>[0] & { active: boolean; runForShift: boolean; lockedWeek: boolean }): { error: string; status: number } | null {
  if (!s.active) return { error: "You're not on the active Labour register - ask the office.", status: 403 };
  const why = startRefusal(s);
  if (why) return { error: why, status: s.on ? 409 : 403 };
  if (s.lockedWeek) return { error: LOCKED_WEEK_RUN, status: 409 };
  if (s.runForShift) return { error: SAME_SHIFT_RUN, status: 409 };
  return null;
}

// Does [start, end) overlap a sign-in [in, out)? An open sign-in (no out) runs to `now`.
export function overlapsSignIn(start: Date, end: Date | null, signIns: { in: Date; out: Date | null }[], now = new Date()): boolean {
  const e = (end ?? now).getTime();
  return signIns.some((x) => x.in.getTime() < e && (x.out ?? now).getTime() > start.getTime());
}

// ---------- office corrections ----------

// A corrected start / end: valid times, end after start (or none), not in the future (SR-008), never over one of their
// sign-ins, and never over another of their tip runs (SR-008).
export function tipCorrectionError(startAt: Date, endAt: Date | null, signIns: { in: Date; out: Date | null }[], now = new Date(), otherRuns: { in: Date; out: Date | null }[] = []): string | null {
  if (Number.isNaN(startAt.getTime())) return "The start time isn't valid.";
  if (endAt && Number.isNaN(endAt.getTime())) return "The end time isn't valid.";
  if (endAt && endAt <= startAt) return "The end must be after the start.";
  if (startAt.getTime() > now.getTime() || (endAt && endAt.getTime() > now.getTime())) return "That time hasn't happened yet.";
  if (overlapsSignIn(startAt, endAt, signIns, now)) return "That would overlap one of their sign-ins - a tip run can't.";
  if (overlapsSignIn(startAt, endAt, otherRuns, now)) return "That would overlap another of their tip runs.";
  return null;
}
// An office-entered time: a valid ISO string, or null for "none" (an empty value). undefined = not valid (SR-008: 400).
export function parseOfficeTime(v: unknown): Date | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
