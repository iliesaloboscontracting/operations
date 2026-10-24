// Hire register (21 Oct 2026): rough cost of a hired item and whether it's
// about to come off hire. Plain functions, used by the Hire page, Project
// Tracking and the alerts, so all three agree.
//
// These are ESTIMATES (Ilies: "keep the invoices at an estimate for now").
// Since 24 Oct 2026 a supplier invoice entered on Tracking can be linked to an
// item and the days it covers; those days then drop out of the estimate.
//
// A hire week is 5 working days (the same divisor idle-hire already uses), so
// an item is charged for each weekday it's on hire. An hourly rate is
// estimated at 8 hours a day.

export const HOURS_PER_HIRE_DAY = 8;
export const OFF_HIRE_WARNING_DAYS = 3;

export type HireLike = {
  onHireDate?: string | null;
  offHireDate?: string | null;
  hireRate?: number | null;
  hireRateUnit?: string | null;
  dailyRateExGst?: number | null;
  hireDeliveryCost?: number | null;
  hireCollectionCost?: number | null;
  hireStatus?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

// Weekdays from `from` to `to`, both counted. 0 if `to` is before `from`.
export function weekdaysBetween(from: string, to: string) {
  if (!ISO.test(from) || !ISO.test(to) || to < from) return 0;
  let n = 0;
  for (let t = utc(from); t <= utc(to); t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

// The day-equivalent rate: DAY as is, WEEK / 5, HOUR x 8; else the old flat
// dailyRateExGst; null when nothing's set.
export function hireDayRate(r: HireLike): number | null {
  if (r.hireRate != null && r.hireRateUnit === "DAY") return r.hireRate;
  if (r.hireRate != null && r.hireRateUnit === "WEEK") return r.hireRate / 5;
  if (r.hireRate != null && r.hireRateUnit === "HOUR") return r.hireRate * HOURS_PER_HIRE_DAY;
  return r.dailyRateExGst ?? null;
}

const round = (n: number) => Math.round(n * 100) / 100;

export type HireEstimate = {
  dayRate: number | null;
  daysToDate: number; // working days on hire up to today (or the return)
  daysTotal: number | null; // working days start -> expected finish; null with no finish date
  daysInvoiced: number; // of daysToDate, how many a supplier invoice already covers
  costToDate: number | null; // estimate for the days NOT yet invoiced; null = no rate to estimate with
  costTotal: number | null; // to the expected finish, incl. delivery + pick-up
};

// Weekdays in [from, to] that fall inside any of the invoiced periods.
function invoicedWeekdays(from: string, to: string, invoiced: { from: string; to: string }[]) {
  if (!invoiced.length || to < from) return 0;
  let n = 0;
  for (let t = utc(from); t <= utc(to); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (invoiced.some((p) => p.from <= iso && iso <= p.to)) n++;
  }
  return n;
}

// `invoiced`: periods a supplier invoice already bills for this item (24 Oct
// 2026). Those days drop out of the estimate - the invoice is the real cost -
// and so do delivery / pick-up once any invoice is linked (suppliers bill them
// on the invoice).
export function hireEstimate(r: HireLike, today: string, invoiced: { from: string; to: string }[] = []): HireEstimate | null {
  if (!r.onHireDate || !ISO.test(r.onHireDate)) return null;
  const dayRate = hireDayRate(r);
  const end = r.offHireDate && ISO.test(r.offHireDate) ? r.offHireDate : null;
  // Returned: charged to the finish date. Otherwise up to today, never past
  // the expected finish (after that it's "overdue" - flagged, not guessed).
  const until = r.hireStatus === "RETURNED" && end ? end : end && end < today ? end : today;
  const daysToDate = r.onHireDate <= today ? weekdaysBetween(r.onHireDate, until) : 0;
  const daysInvoiced = r.onHireDate <= today ? invoicedWeekdays(r.onHireDate, until, invoiced) : 0;
  const daysTotal = end ? weekdaysBetween(r.onHireDate, end) : null;
  const linked = invoiced.length > 0;
  const delivery = linked ? 0 : r.hireDeliveryCost ?? 0;
  const collection = linked ? 0 : r.hireCollectionCost ?? 0;
  const started = r.onHireDate <= today;
  return {
    dayRate,
    daysToDate,
    daysTotal,
    daysInvoiced,
    costToDate: dayRate == null ? null : round(dayRate * (daysToDate - daysInvoiced) + (started ? delivery : 0) + (r.hireStatus === "RETURNED" ? collection : 0)),
    costTotal: dayRate == null || daysTotal == null ? null : round(dayRate * daysTotal + delivery + collection),
  };
}

export type OffHireAlert = "OVERDUE" | "TODAY" | "SOON";

// Coming off hire: overdue (still out past the expected finish), finishing
// today, or within the next 3 days. Nothing once it's been returned.
export function offHireAlert(r: HireLike, today: string): { level: OffHireAlert; daysLeft: number } | null {
  if (r.hireStatus === "RETURNED" || !r.offHireDate || !ISO.test(r.offHireDate)) return null;
  const daysLeft = Math.round((utc(r.offHireDate) - utc(today)) / 86_400_000);
  if (daysLeft < 0) return { level: "OVERDUE", daysLeft };
  if (daysLeft === 0) return { level: "TODAY", daysLeft };
  if (daysLeft <= OFF_HIRE_WARNING_DAYS) return { level: "SOON", daysLeft };
  return null;
}

export const HIRE_STATUS_LABEL: Record<string, string> = {
  BOOKED: "Booked",
  ON_HIRE: "On hire",
  OFF_HIRE_REQUESTED: "Off-hire requested",
  RETURNED: "Returned",
};
