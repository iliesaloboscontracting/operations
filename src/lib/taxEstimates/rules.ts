// Tax estimates (Accounts stage 7, docs/accounts/STAGE7-DESIGN.md) - the pure maths. ESTIMATES: Xero and the
// accountant are the record. Payroll tax from the Xero P&L wages and stage 3's PAYROLL_TAX on-cost rate (one
// source of the rate); BAS GST from the Xero invoice / bill mirror; due dates for Victoria's calendar.
import { XERO_CONFIG } from "@/lib/xero/config";
import { rateOn, type RateRow } from "@/lib/oncosts/rules";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- financial years, quarters, months ----------
export const fyOfDate = (d: string) => Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 7 ? 1 : 0); // FY 2026 = Jul 2026 - Jun 2027
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
export const fyStartOf = (fy: number) => `${fy}-07-01`;
export const fyEndOf = (fy: number) => `${fy + 1}-06-30`;
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInFy = (fy: number) => (isLeap(fy + 1) ? 366 : 365);
export const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const lastDay = (ym: string) => `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
const addMonths = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const monthsOfFy = (fy: number) => Array.from({ length: 12 }, (_, i) => addMonths(`${fy}-07`, i));

export type Period = { key: string; label: string; from: string; to: string; months: string[] };
// FY quarters: Q1 Jul-Sep ... Q4 Apr-Jun. Monthly periods for a monthly lodger.
export function periodsOfFy(fy: number, frequency: "QUARTERLY" | "MONTHLY"): Period[] {
  const months = monthsOfFy(fy);
  if (frequency === "MONTHLY") return months.map((m) => ({ key: m, label: new Date(`${m}-01T00:00:00Z`).toLocaleString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" }), from: `${m}-01`, to: lastDay(m), months: [m] }));
  return [0, 1, 2, 3].map((q) => {
    const ms = months.slice(q * 3, q * 3 + 3);
    return { key: `${fy}-Q${q + 1}`, label: `Q${q + 1} ${fyLabel(fy)}`, from: `${ms[0]}-01`, to: lastDay(ms[2]), months: ms };
  });
}

// ---------- BAS: GST collected less GST paid ----------
export type MirrorInvoice = { type: string; status: string; date: string; gst: number | null };
const counts = (status: string) => !XERO_CONFIG.ignoredStatuses.includes(status.toUpperCase());
const sign = (t: string) => (t.endsWith("CREDIT") ? -1 : 1);

export function gstForPeriod(invoices: MirrorInvoice[], from: string, to: string) {
  let collected = 0, paid = 0, sales = 0, bills = 0, noGst = 0;
  for (const i of invoices) {
    if (!counts(i.status) || i.date < from || i.date > to) continue;
    if (i.gst == null) { noGst++; continue; }
    if (i.type === "SALE" || i.type === "SALE_CREDIT") { collected += sign(i.type) * i.gst; sales++; }
    else if (i.type === "BILL" || i.type === "BILL_CREDIT") { paid += sign(i.type) * i.gst; bills++; }
  }
  return { collected: r2(collected), paid: r2(paid), net: r2(collected - paid), sales, bills, noGst };
}

// ---------- payroll tax: wages from the P&L ----------
export type AccountClass = "WAGES" | "SUPER" | "NONE";
export type PnlLine = { month: string; section: string; account: string; amount: number };

// A first guess from the account's name; Victoria's saved choice always wins.
export function classifyAccount(name: string, section: string): AccountClass {
  const n = name.toLowerCase(), s = section.toLowerCase();
  if (/income|revenue|sales|summary/.test(s) || /^total|gross profit|net (profit|loss)/.test(n)) return "NONE";
  if (/payroll tax|workers.?comp|insurance|icare|fringe benefit/.test(n)) return "NONE";
  if (/superannuation|\bsuper\b/.test(n)) return "SUPER";
  if (/wage|salar|allowance|overtime|bonus|leave|termination|director.?s? fee/.test(n)) return "WAGES";
  return "NONE";
}

export function accountClasses(lines: PnlLine[], saved: Record<string, AccountClass>) {
  const seen = new Map<string, { account: string; section: string; class: AccountClass; suggested: AccountClass; saved: boolean }>();
  for (const l of lines) {
    if (seen.has(l.account)) continue;
    const suggested = classifyAccount(l.account, l.section);
    seen.set(l.account, { account: l.account, section: l.section, suggested, class: saved[l.account] ?? suggested, saved: l.account in saved });
  }
  return [...seen.values()].sort((a, b) => a.section.localeCompare(b.section) || a.account.localeCompare(b.account));
}

export function wagesByMonth(lines: PnlLine[], classes: Map<string, AccountClass>) {
  const out = new Map<string, { wages: number; super: number }>();
  for (const l of lines) {
    const c = classes.get(l.account);
    if (c !== "WAGES" && c !== "SUPER") continue;
    const m = out.get(l.month) ?? { wages: 0, super: 0 };
    if (c === "WAGES") m.wages += l.amount; else m.super += l.amount;
    out.set(l.month, m);
  }
  return out;
}

export type PayrollMonth = { month: string; wages: number; super: number; base: number; tax: number | null; rule: string | null; percent: number | null; monthlyThreshold: number | null };

// One month: base = wages (+ super when the rate's base is PAID_PLUS_SUPER); FLAT = % of base; ABOVE_THRESHOLD =
// % of (base - the annual threshold's share for the month: days in month / days in the FY). No rate = not set.
export function payrollTaxMonth(month: string, wages: number, superAmt: number, rates: RateRow[]): PayrollMonth {
  const rate = rateOn(rates, "PAYROLL_TAX", `${month}-01`);
  if (!rate) return { month, wages: r2(wages), super: r2(superAmt), base: r2(wages + superAmt), tax: null, rule: null, percent: null, monthlyThreshold: null };
  const base = rate.base === "PAID_PLUS_SUPER" ? wages + superAmt : wages;
  let taxable = base, monthlyThreshold: number | null = null;
  if (rate.thresholdRule === "ABOVE_THRESHOLD" && rate.thresholdAnnual != null) {
    monthlyThreshold = r2((rate.thresholdAnnual * daysInMonth(month)) / daysInFy(fyOfDate(`${month}-01`)));
    taxable = Math.max(0, base - monthlyThreshold);
  }
  return { month, wages: r2(wages), super: r2(superAmt), base: r2(base), tax: r2((taxable * rate.percent) / 100), rule: rate.thresholdRule ?? "FLAT", percent: rate.percent, monthlyThreshold };
}

// The year to date, plus (above a threshold) the annual reconciliation check: % of (YTD base - threshold x days
// elapsed / days in the FY), using the rate in force at the last month.
export function payrollTaxYear(fy: number, byMonth: Map<string, { wages: number; super: number }>, rates: RateRow[], today: string) {
  const months = monthsOfFy(fy).filter((m) => m <= today.slice(0, 7) && byMonth.has(m));
  const rows = months.map((m) => payrollTaxMonth(m, byMonth.get(m)!.wages, byMonth.get(m)!.super, rates));
  const notSet = rows.some((r) => r.tax == null) || !rows.length && !rateOn(rates, "PAYROLL_TAX", today);
  const ytdTax = notSet ? null : r2(rows.reduce((n, r) => n + (r.tax ?? 0), 0));
  const ytdBase = r2(rows.reduce((n, r) => n + r.base, 0));
  let reconciliation: number | null = null;
  const last = rows[rows.length - 1];
  const rate = last ? rateOn(rates, "PAYROLL_TAX", `${last.month}-01`) : null;
  if (rate?.thresholdRule === "ABOVE_THRESHOLD" && rate.thresholdAnnual != null && last) {
    const elapsed = Math.round((Date.UTC(Number(last.month.slice(0, 4)), Number(last.month.slice(5, 7)), 0) - Date.UTC(fy, 6, 1)) / 86_400_000) + 1;
    reconciliation = r2((Math.max(0, ytdBase - (rate.thresholdAnnual * elapsed) / daysInFy(fy)) * rate.percent) / 100);
  }
  return { fy, label: fyLabel(fy), rows, ytdBase, ytdTax, reconciliation, notSet };
}

// ---------- due dates (Draft - for Victoria) ----------
// BAS quarterly, lodging itself: Q1 28 Oct, Q2 28 Feb, Q3 28 Apr, Q4 28 Jul. Through a tax agent (dates vary
// by year - "check with the accountant"): Q1 25 Nov, Q2 28 Feb, Q3 26 May, Q4 25 Aug. Monthly BAS / IAS: the
// 21st of the next month. Payroll tax (NSW): the 7th of the next month; June -> the annual reconciliation 28 Jul.
export function basDueDate(p: Period, frequency: "QUARTERLY" | "MONTHLY", lodgement: "SELF" | "AGENT"): string {
  const endYm = p.to.slice(0, 7), next = addMonths(endYm, 1);
  if (frequency === "MONTHLY") return `${next}-21`;
  const q = Number(p.key.slice(-1)), fy = Number(p.key.slice(0, 4));
  const self = [`${fy}-10-28`, `${fy + 1}-02-28`, `${fy + 1}-04-28`, `${fy + 1}-07-28`];
  const agent = [`${fy}-11-25`, `${fy + 1}-02-28`, `${fy + 1}-05-26`, `${fy + 1}-08-25`];
  return (lodgement === "AGENT" ? agent : self)[q - 1];
}
export function payrollTaxDueDate(month: string): { due: string; what: string } {
  if (month.slice(5, 7) === "06") return { due: `${month.slice(0, 4)}-07-28`, what: "annual reconciliation" };
  return { due: `${addMonths(month, 1)}-07`, what: "monthly return" };
}

// Victoria's own calendar item for this period, if she has one: same category, still open, due within 45 days
// of the expected date (or already linked to this estimate).
export type CalendarItem = { id: string; category: string; dueDate: string; status: string; amount: number | null; sourceType: string | null; sourceId: string | null };
export function matchCalendarItem(items: CalendarItem[], category: string, sourceId: string, due: string): CalendarItem | null {
  const linked = items.find((i) => i.sourceType === "TAX_ESTIMATE" && i.sourceId === sourceId && i.status !== "CANCELLED");
  if (linked) return linked;
  const near = items.filter((i) => i.category === category && i.status === "OPEN" && !i.sourceType && Math.abs(Date.parse(`${i.dueDate}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) <= 45 * 86_400_000);
  near.sort((a, b) => Math.abs(Date.parse(a.dueDate) - Date.parse(due)) - Math.abs(Date.parse(b.dueDate) - Date.parse(due)));
  return near[0] ?? null;
}
