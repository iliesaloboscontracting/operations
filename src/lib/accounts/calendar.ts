// The Accounts calendar's plain rules (26 Oct 2026): categories, repeats,
// the next date of a repeating item, and which items are overdue or coming
// up. No server imports; `npm test` (calendar.test.ts).

export const CATEGORIES = [
  ["BAS", "BAS (GST)"],
  ["IAS", "IAS (PAYG withholding)"],
  ["PAYROLL_TAX", "Payroll tax"],
  ["SUPER", "Super"],
  ["ICARE", "iCare (workers comp)"],
  ["ATO_PLAN", "ATO payment plan"],
  ["SUPPLIER_PLAN", "Supplier payment plan"],
  ["DIRECT_DEBIT", "Direct debit"],
  ["INSURANCE", "Insurance / premium funding"],
  ["REGO", "Rego renewal"],
  // Stage 5: kept in step with tickets / documents by lib/compliance/reminders.ts.
  ["TICKET", "Worker ticket / licence expiry"],
  ["COMPLIANCE", "Company / subcontractor document expiry"],
  ["OTHER", "Other"],
] as const;
export type Category = (typeof CATEGORIES)[number][0];
export const categoryLabel = (c: string) => CATEGORIES.find(([k]) => k === c)?.[1] ?? "Other";
export const isCategory = (c: unknown): c is Category => typeof c === "string" && CATEGORIES.some(([k]) => k === c);

export const REPEATS = [
  ["NONE", "Once"],
  ["WEEKLY", "Every week"],
  ["FORTNIGHTLY", "Every 2 weeks"],
  ["MONTHLY", "Every month"],
  ["QUARTERLY", "Every 3 months"],
  ["YEARLY", "Every year"],
] as const;
export type Repeat = (typeof REPEATS)[number][0];
export const isRepeat = (r: unknown): r is Repeat => typeof r === "string" && REPEATS.some(([k]) => k === r);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(new Date(d(s).getTime() + n * 86_400_000));
export const daysBetween = (from: string, to: string) => Math.round((d(to).getTime() - d(from).getTime()) / 86_400_000);

// Months move by calendar month, keeping the day where it can (31 Jan -> 28/29 Feb -> 31 Mar
// uses the ORIGINAL day of month, so a "7th of the month" item always stays on the 7th).
function addMonths(s: string, n: number, dayOfMonth: number) {
  const x = d(s);
  const y = x.getUTCFullYear(), m = x.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(dayOfMonth, last))));
}

// The next due date after `date` for a repeating item (null for one-off items).
export function nextDate(date: string, repeat: string, dayOfMonth = Number(date.slice(8, 10))): string | null {
  switch (repeat) {
    case "WEEKLY": return addDays(date, 7);
    case "FORTNIGHTLY": return addDays(date, 14);
    case "MONTHLY": return addMonths(date, 1, dayOfMonth);
    case "QUARTERLY": return addMonths(date, 3, dayOfMonth);
    case "YEARLY": return addMonths(date, 12, dayOfMonth);
    default: return null;
  }
}

export type When = "OVERDUE" | "TODAY" | "SOON" | "LATER";
// Where an open item sits against today: past due, due today, inside its alert window, or later.
export function whenOf(item: { dueDate: string; alertDays: number }, today: string): When {
  const days = daysBetween(today, item.dueDate);
  if (days < 0) return "OVERDUE";
  if (days === 0) return "TODAY";
  return days <= Math.max(0, item.alertDays) ? "SOON" : "LATER";
}

// Should an alert go out now? Once per due date, from the alert window on.
export const alertDue = (item: { dueDate: string; alertDays: number; alertedFor: string | null; status: string }, today: string) =>
  item.status === "OPEN" && item.alertedFor !== item.dueDate && whenOf(item, today) !== "LATER";
