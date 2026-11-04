// One-tap off-hire (Ilies, 5 Nov 2026: "off hire should stop the cost and hire gear ... more automated").
// The office calls the supplier, then taps "Off-hired" with the day it was called off and the
// supplier's off-hire number. That day is when the hire cost stops (lib/hireEstimate.ts offHireStop)
// and the item leaves the board after it. A supervisor's "Finished" on the hire check only marks it
// Off-hire requested - the cost runs until the office confirms. Plain rules here; the save is store.ts.
import { isISODate } from "../dateRules";
import { assertNoMoney } from "../moneyGuard";
import { stripMoney } from "../dailyLog/money";

// A call-off can be booked for a later day ("pick it up Friday"), up to two weeks ahead.
export const OFF_HIRE_AHEAD_DAYS = 14;
export const OFF_HIRE_REF_MAX = 40;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export type OffHireItem = { type: string; category: string | null; onHireDate: string | null };

// Why this item can't be off-hired on `date`, or null.
export function offHireError(item: OffHireItem, date: unknown, today: string): string | null {
  if (item.type !== "HIRE") return "Only hire items are off-hired.";
  if (item.category === "LABOUR") return "Labour hire isn't off-hired here - it's costed by the hours worked.";
  if (!isISODate(date)) return "Pick the day it was called off.";
  if (item.onHireDate && isISODate(item.onHireDate) && date < item.onHireDate) return `That's before it went on hire (${short(item.onHireDate)}).`;
  if (date > addDays(today, OFF_HIRE_AHEAD_DAYS)) return "That's more than two weeks away - move its expected finish instead.";
  return null;
}

// The supplier's off-hire number: optional, short, never an amount.
export function offHireRef(v: unknown): { ref: string | null } | { error: string } {
  if (v == null || v === "") return { ref: null };
  if (typeof v !== "string") return { error: "Type the off-hire number." };
  const ref = v.trim();
  if (!ref) return { ref: null };
  if (ref.length > OFF_HIRE_REF_MAX) return { error: `Keep the off-hire number under ${OFF_HIRE_REF_MAX} characters.` };
  if (!assertNoMoney(ref) || stripMoney(ref).removed) return { error: "Just the off-hire number - no amounts." };
  return { ref };
}

// Once called off, a form saved afterwards (still showing the old status) mustn't quietly put it back on
// hire - that's "Put back on hire". `next` undefined = status not in the save.
export function hireStatusChangeError(existing: { offHiredOn: string | null } | null, next: unknown): string | null {
  if (next === undefined || !existing?.offHiredOn || next === "RETURNED") return null;
  return "It's off-hired - your off-hire is saved. Close this window, or use \"Put back on hire\" to change it.";
}

// Set to Off-hired from the Status box instead of the button: the off-hire day is the expected finish
// if that's already passed (the box used to double as the returned date), otherwise today.
export function formOffHireDay(next: { onHireDate?: string | null; offHireDate?: string | null }, today: string): string {
  const f = next.offHireDate;
  return f && isISODate(f) && f <= today && (!next.onHireDate || f >= next.onHireDate) ? f : today;
}
// Whether this save off-hires the item from the Status box (so its day is recorded and its request closed).
export const offHiresByStatus = (existing: { hireStatus: string | null; offHiredOn: string | null } | null, next: unknown) =>
  next === "RETURNED" && !existing?.offHiredOn && existing?.hireStatus !== "RETURNED";

// What the supervisor sees on their request once it's done (words and dates only).
export const offHireOutcome = (date: string, ref: string | null, today: string) =>
  `${date > today ? "Called off for" : "Off-hired"} ${short(date)}${ref ? ` - off-hire no. ${ref}` : ""}.`;

// The request is closed by the off-hire unless the yard has it right now (YD-003 - leave theirs alone).
export const CLOSABLE_BY_OFF_HIRE = ["SENT", "SEEN", "NEEDS_INFO", "TODO", "ACTIONING", "MINE", "CANT_DO", "ANSWERED"];

// When the office is reminded about a "Finished" nobody has called off yet: 8am on the next working day.
export function callOffReminderDay(today: string): string {
  let d = addDays(today, 1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}
export const CALL_OFF_REMINDER = "Not called off yet - ring the supplier, then tap Off-hired on the Hire page.";
