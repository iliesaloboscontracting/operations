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
  offHiredOn?: string | null;
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
  costTotal: number | null; // to the off-hire day (else the expected finish), incl. delivery + pick-up
  offHireMissing: boolean; // marked Returned with no date - no estimate until the off-hired date is filled in
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

// The day the hire cost stops (Ilies, 5 Nov 2026: the day the office calls the supplier off): the
// off-hired date, or - for an item marked Returned before that date existed - its finish date. Null
// while it's still out, or when it was marked Returned with no date at all (offHireMissing).
export function offHireStop(r: HireLike): string | null {
  if (r.offHiredOn && ISO.test(r.offHiredOn)) return r.offHiredOn;
  if (r.hireStatus === "RETURNED" && r.offHireDate && ISO.test(r.offHireDate)) return r.offHireDate;
  return null;
}
// Returned, but nobody recorded when - its cost can't be worked out (it used to grow every day).
export const offHireMissing = (r: HireLike) => r.hireStatus === "RETURNED" && offHireStop(r) == null;
// Called off (or returned): finished, nothing more to forecast.
export const isOffHired = (r: HireLike) => r.hireStatus === "RETURNED" || offHireStop(r) != null;
// Off the board from the day after its off-hire day (and at once when the date is missing).
export const offHiredBefore = (r: HireLike, day: string) => {
  const stop = offHireStop(r);
  return stop ? stop < day : offHireMissing(r);
};

// Last day charged so far: the off-hire day once it's passed, otherwise today.
// An item still out past its expected finish keeps costing - the supplier
// charges until it's called off - and is flagged "overdue".
function hireUntil(r: HireLike, today: string) {
  const stop = offHireStop(r);
  return stop && stop < today ? stop : today;
}

// The same estimate day by day, for Tracking's spend-over-time: each weekday
// on hire that no invoice covers at the day rate, plus delivery on the first
// day and pick-up on the off-hire day. Sums to hireEstimate's costToDate.
export function hireEstimateDays(r: HireLike, today: string, invoiced: { from: string; to: string }[] = []): { date: string; amount: number }[] {
  const e = hireEstimate(r, today, invoiced);
  if (!e || e.dayRate == null || e.costToDate == null || !r.onHireDate || r.onHireDate > today) return [];
  const out: { date: string; amount: number }[] = [];
  const until = hireUntil(r, today);
  for (let t = utc(r.onHireDate); t <= utc(until); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (!invoiced.some((p) => p.from <= iso && iso <= p.to)) out.push({ date: iso, amount: e.dayRate });
  }
  const stop = offHireStop(r);
  if (!invoiced.length && r.hireDeliveryCost) out.push({ date: r.onHireDate, amount: r.hireDeliveryCost });
  if (!invoiced.length && stop && stop <= today && r.hireCollectionCost) out.push({ date: stop, amount: r.hireCollectionCost });
  return out;
}

// What's still to come on an item (working days after today, plus pick-up):
// to its off-hire day once it's been called off, else to its expected finish.
// "Finished" on site (Off-hire requested) stops the forecast at today - only
// the pick-up is left. Null when there's no rate, or no date to count to.
export function hireStillToCome(r: HireLike, today: string): number | null {
  if (offHireMissing(r)) return 0;
  const stop = offHireStop(r);
  if (stop && stop <= today) return 0; // over - the pick-up is in the cost to date
  const dayRate = hireDayRate(r);
  if (dayRate == null) return null;
  const pickUp = round(r.hireCollectionCost ?? 0);
  if (!stop && r.hireStatus === "OFF_HIRE_REQUESTED") return pickUp;
  const end = stop ?? (r.offHireDate && ISO.test(r.offHireDate) ? r.offHireDate : null);
  if (!end) return null;
  if (end <= today) return pickUp;
  const next = new Date(utc(today) + 86_400_000).toISOString().slice(0, 10);
  return round(dayRate * weekdaysBetween(next, end) + pickUp);
}

// `invoiced`: periods a supplier invoice already bills for this item (24 Oct
// 2026). Those days drop out of the estimate - the invoice is the real cost -
// and so do delivery / pick-up once any invoice is linked (suppliers bill them
// on the invoice).
export function hireEstimate(r: HireLike, today: string, invoiced: { from: string; to: string }[] = []): HireEstimate | null {
  if (!r.onHireDate || !ISO.test(r.onHireDate)) return null;
  const dayRate = hireDayRate(r);
  const missing = offHireMissing(r);
  const stop = offHireStop(r);
  const end = r.offHireDate && ISO.test(r.offHireDate) ? r.offHireDate : null;
  const until = hireUntil(r, today);
  const started = r.onHireDate <= today;
  const daysToDate = started && !missing ? weekdaysBetween(r.onHireDate, until) : 0;
  const daysInvoiced = started && !missing ? invoicedWeekdays(r.onHireDate, until, invoiced) : 0;
  // The whole hire: to the off-hire day; finished on site = up to today; else the expected
  // finish, or today if it's still out past that.
  const totalTo = stop ?? (r.hireStatus === "OFF_HIRE_REQUESTED" ? until : end && end < until ? until : end);
  const daysTotal = missing || !totalTo ? null : weekdaysBetween(r.onHireDate, totalTo);
  const linked = invoiced.length > 0;
  const delivery = linked ? 0 : r.hireDeliveryCost ?? 0;
  const collection = linked ? 0 : r.hireCollectionCost ?? 0;
  const pickedUp = !!stop && stop <= today;
  return {
    dayRate,
    daysToDate,
    daysTotal,
    daysInvoiced,
    costToDate: dayRate == null || missing ? null : round(dayRate * (daysToDate - daysInvoiced) + (started ? delivery : 0) + (pickedUp ? collection : 0)),
    costTotal: dayRate == null || daysTotal == null ? null : round(dayRate * daysTotal + delivery + collection),
    offHireMissing: missing,
  };
}

export type OffHireAlert = "OVERDUE" | "TODAY" | "SOON";

// Coming off hire: overdue (still out past the expected finish), finishing
// today, or within the next 3 days. Nothing once it's been called off.
export function offHireAlert(r: HireLike, today: string): { level: OffHireAlert; daysLeft: number } | null {
  if (isOffHired(r) || !r.offHireDate || !ISO.test(r.offHireDate)) return null;
  const daysLeft = Math.round((utc(r.offHireDate) - utc(today)) / 86_400_000);
  if (daysLeft < 0) return { level: "OVERDUE", daysLeft };
  if (daysLeft === 0) return { level: "TODAY", daysLeft };
  if (daysLeft <= OFF_HIRE_WARNING_DAYS) return { level: "SOON", daysLeft };
  return null;
}

export const HIRE_STATUS_LABEL: Record<string, string> = {
  BOOKED: "Booked",
  ON_HIRE: "On hire",
  OFF_HIRE_REQUESTED: "Finished - to call off",
  RETURNED: "Off-hired",
};
