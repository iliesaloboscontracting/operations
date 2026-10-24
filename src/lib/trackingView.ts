// Project Tracking page maths (redesign, 24 Oct 2026) - plain functions over
// the API's day-by-day costs, so periods, weekly bars and category totals are
// all worked out the same way. No server imports - used by the pages.
import type { CostCatKey, DayCostDTO, ProjectCostDTO } from "./types";
import { addDays, startOfMonth, startOfWeek, endOfMonth } from "./dates";

// Cost categories as people say them, in a fixed order.
export const CAT_LABELS: { key: CostCatKey; label: string }[] = [
  { key: "ownCrew", label: "Own crew" },
  { key: "labourHire", label: "Labour hire" },
  { key: "hire", label: "Hired plant" },
  { key: "plant", label: "Our plant" },
  { key: "attach", label: "Attachments" },
  { key: "trucks", label: "Trucks" },
  { key: "tipFees", label: "Tip fees" },
  { key: "materials", label: "Materials" },
];
export function categoryRows(cat: Partial<Record<CostCatKey, number>>) {
  return CAT_LABELS.map((c) => ({ key: c.key, label: c.label, amount: cat[c.key] ?? 0 }))
    .filter((r) => Math.abs(r.amount) >= 0.5)
    .sort((a, b) => b.amount - a.amount);
}

export type PeriodKey = "todate" | "thisweek" | "lastweek" | "thismonth" | "lastmonth";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "todate", label: "Job to date" },
  { key: "thisweek", label: "This week" },
  { key: "lastweek", label: "Last week" },
  { key: "thismonth", label: "This month" },
  { key: "lastmonth", label: "Last month" },
];

export type Range = { from: string | null; to: string; label: string; partial: boolean };

// Weeks run Monday-Sunday (the business week). "This week/month" are marked
// partial - they're not compared like-for-like with a finished one.
export function periodRange(key: PeriodKey, today: string): Range {
  const mon = startOfWeek(today);
  if (key === "thisweek") return { from: mon, to: today, label: "This week so far", partial: true };
  if (key === "lastweek") return { from: addDays(mon, -7), to: addDays(mon, -1), label: "Last week", partial: false };
  if (key === "thismonth") return { from: startOfMonth(today), to: today, label: "This month so far", partial: true };
  if (key === "lastmonth") {
    const lastDay = addDays(startOfMonth(today), -1);
    return { from: startOfMonth(lastDay), to: endOfMonth(lastDay), label: "Last month", partial: false };
  }
  return { from: null, to: today, label: "Job to date", partial: false };
}

// The same length of time just before (for "vs previous").
export function previousRange(r: Range): Range | null {
  if (!r.from) return null;
  const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1), label: "previous", partial: false };
}

export type Split = { total: number; locked: number; estimated: number; invoiced: number; cat: Partial<Record<CostCatKey, number>> };
const empty = (): Split => ({ total: 0, locked: 0, estimated: 0, invoiced: 0, cat: {} });

export function sumDays(days: DayCostDTO[], r: { from: string | null; to: string } | null): Split {
  const s = empty();
  for (const d of days) {
    if (r && ((r.from && d.date < r.from) || d.date > r.to)) continue;
    s.locked += d.locked; s.estimated += d.estimated; s.invoiced += d.invoiced;
    for (const [k, v] of Object.entries(d.cat)) s.cat[k as CostCatKey] = (s.cat[k as CostCatKey] ?? 0) + (v ?? 0);
  }
  s.total = s.locked + s.estimated + s.invoiced;
  return s;
}

export function sumProjects(projects: ProjectCostDTO[], r: Range | null): Split {
  const s = empty();
  for (const p of projects) {
    const x = sumDays(p.daily, r);
    s.total += x.total; s.locked += x.locked; s.estimated += x.estimated; s.invoiced += x.invoiced;
    for (const [k, v] of Object.entries(x.cat)) s.cat[k as CostCatKey] = (s.cat[k as CostCatKey] ?? 0) + (v ?? 0);
  }
  return s;
}

// The last `n` Monday-weeks up to today, each with its spend split.
export type WeekBar = { week: string; confirmed: number; estimated: number; total: number; partial: boolean };
export function weeklyBars(days: DayCostDTO[], today: string, n: number): WeekBar[] {
  const thisMon = startOfWeek(today);
  const out: WeekBar[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const week = addDays(thisMon, -7 * i);
    const s = sumDays(days, { from: week, to: addDays(week, 6) });
    out.push({ week, confirmed: s.locked + s.invoiced, estimated: s.estimated, total: s.total, partial: i === 0 });
  }
  return out;
}

// The last `n` Monday-weeks up to today, spend split by category (Director
// Insights cost trend, 24 Oct 2026). Same week rule and day sums as weeklyBars.
export type WeekCats = { week: string; total: number; partial: boolean; cat: Partial<Record<CostCatKey, number>> };
export function weeklyByCategory(days: DayCostDTO[], today: string, n: number): WeekCats[] {
  const thisMon = startOfWeek(today);
  const out: WeekCats[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const week = addDays(thisMon, -7 * i);
    const s = sumDays(days, { from: week, to: addDays(week, 6) });
    out.push({ week, total: s.total, partial: i === 0, cat: s.cat });
  }
  return out;
}

// Short money for tiles and bars: $840, $12.3k, $1.24M. Tables use full money().
export function short(n: number | null | undefined) {
  if (n == null) return "—";
  const a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1000).toFixed(0)}k`;
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

// A change against the previous period, signed: "+12%" / "-8%"; null when
// there's nothing to compare against.
export function change(now: number, before: number) {
  if (before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, text: `${pct > 0 ? "+" : ""}${pct}%` };
}
