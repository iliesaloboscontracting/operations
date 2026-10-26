// Tax estimates (Accounts stage 7, docs/accounts/STAGE7-DESIGN.md): payroll tax per month and FY to date, and
// BAS GST per period, from the Xero mirror (current import of each kind) and stage 3's PAYROLL_TAX rate. Due
// dates go onto Victoria's existing calendar (AccountsItem) - never a second calendar. Estimates only.
import { prisma } from "@/lib/prisma";
import { todaySydney } from "@/lib/today";
import { currentImport } from "@/lib/xero/imports";
import { labourLines } from "@/lib/oncosts/store";
import type { RateRow } from "@/lib/oncosts/rules";
import {
  accountClasses, basDueDate, fyOfDate, fyLabel, gstForPeriod, matchCalendarItem, monthsOfFy, payrollTaxDueDate, payrollTaxYear, periodsOfFy, wagesByMonth,
  type AccountClass, type CalendarItem,
} from "./rules";

type Problem = { error: string; status: number };
type Who = { id: string; name: string };

export const ESTIMATE_NOTE = "Estimate - Xero and the accountant are the record.";
export const PAYG_NOTE = "PAYG withholding isn't in the data Operations reads (it needs Xero payroll access, which Lobos hasn't granted). Put your own figure on the calendar item if you like.";

// ---------- Victoria's settings ----------
const DEFAULTS = { PAYROLL_ACCOUNTS: {} as Record<string, AccountClass>, GST_BASIS: "ACCRUAL", BAS_FREQUENCY: "QUARTERLY" as "QUARTERLY" | "MONTHLY", LODGEMENT: "SELF" as "SELF" | "AGENT" };
type Settings = typeof DEFAULTS;

export async function taxSettings(): Promise<Settings & { changedBy: Record<string, string> }> {
  const rows = await prisma.taxSetting.findMany({ orderBy: { at: "asc" } });
  const s = { ...DEFAULTS, changedBy: {} as Record<string, string> } as Settings & { changedBy: Record<string, string> };
  for (const r of rows) {
    try { (s as Record<string, unknown>)[r.key] = JSON.parse(r.value); s.changedBy[r.key] = `${r.by}, ${r.at.toISOString().slice(0, 10)}`; } catch { /* a bad row is ignored */ }
  }
  return s;
}

export async function saveTaxSetting(who: Who, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const key = String(b.key ?? "");
  let value: unknown;
  if (key === "BAS_FREQUENCY") value = b.value === "MONTHLY" ? "MONTHLY" : b.value === "QUARTERLY" ? "QUARTERLY" : null;
  else if (key === "LODGEMENT") value = b.value === "AGENT" ? "AGENT" : b.value === "SELF" ? "SELF" : null;
  else if (key === "GST_BASIS") value = b.value === "ACCRUAL" ? "ACCRUAL" : null; // cash basis needs payment dates in the mirror (a question for Victoria)
  else if (key === "PAYROLL_ACCOUNTS") {
    const v = b.value && typeof b.value === "object" ? (b.value as Record<string, unknown>) : null;
    if (v && Object.values(v).every((c) => c === "WAGES" || c === "SUPER" || c === "NONE") && Object.keys(v).length <= 500) {
      value = Object.fromEntries(Object.entries(v).map(([k, c]) => [k.slice(0, 120), c]));
    }
  } else return { error: "Unknown setting.", status: 400 };
  if (value == null) return { error: "That setting can't be saved.", status: 400 };
  if (key === "PAYROLL_ACCOUNTS") value = { ...(await taxSettings()).PAYROLL_ACCOUNTS, ...(value as object) };
  await prisma.taxSetting.create({ data: { key, value: JSON.stringify(value), by: who.name, byId: who.id } });
  return { ok: true };
}

// ---------- the view ----------
async function mirror() {
  const [inv, bills, pnl] = await Promise.all([currentImport("INVOICES"), currentImport("BILLS"), currentImport("PNL")]);
  const rows = async (id: string | undefined) => (id ? prisma.xeroInvoice.findMany({ where: { importId: id }, select: { type: true, status: true, date: true, gst: true } }) : []);
  const [invRows, billRows, pnlRows] = await Promise.all([
    rows(inv?.id), rows(bills?.id),
    pnl ? prisma.xeroPnlLine.findMany({ where: { importId: pnl.id }, select: { month: true, section: true, account: true, amount: true } }) : [],
  ]);
  const info = (i: { asAt: string | null; source: string; createdAt: Date } | null) => (i ? { asAt: i.asAt, source: i.source, at: i.createdAt.toISOString() } : null);
  return { invoices: [...invRows, ...billRows], pnl: pnlRows, sources: { invoices: info(inv), bills: info(bills), pnl: info(pnl), pnlMonths: [...new Set(pnlRows.map((p) => p.month))].sort() } };
}

const calendarItems = () => prisma.accountsItem.findMany({
  where: { category: { in: ["BAS", "IAS", "PAYROLL_TAX"] }, status: { not: "CANCELLED" } },
  select: { id: true, category: true, dueDate: true, status: true, amount: true, sourceType: true, sourceId: true, title: true },
});

export async function taxView(fyQ?: string | null, opts: { withComparison?: boolean } = {}) {
  const today = todaySydney();
  const fy = fyQ && /^\d{4}$/.test(fyQ) ? Number(fyQ) : fyOfDate(today);
  const [m, settings, rates, items] = await Promise.all([mirror(), taxSettings(), prisma.onCostRate.findMany(), calendarItems()]);
  const cal = (category: string, sourceId: string, due: string) => {
    const c = matchCalendarItem(items as CalendarItem[], category, sourceId, due);
    return c ? { id: c.id, dueDate: c.dueDate, amount: c.amount, status: c.status, linked: c.sourceType === "TAX_ESTIMATE" } : null;
  };

  // Payroll tax
  const accounts = accountClasses(m.pnl, settings.PAYROLL_ACCOUNTS);
  const classes = new Map(accounts.map((a) => [a.account, a.class]));
  const year = payrollTaxYear(fy, wagesByMonth(m.pnl, classes), rates as RateRow[], today);
  let ownCrew: Record<string, number> | null = null;
  if (opts.withComparison) {
    ownCrew = {};
    const months = new Set(monthsOfFy(fy));
    for (const l of await labourLines()) if (l.paid != null && months.has(l.date.slice(0, 7))) ownCrew[l.date.slice(0, 7)] = Math.round(((ownCrew[l.date.slice(0, 7)] ?? 0) + l.paid) * 100) / 100;
  }
  const payroll = {
    ...year,
    rows: year.rows.map((r) => { const d = payrollTaxDueDate(r.month); return { ...r, due: d.due, dueWhat: d.what, calendar: cal("PAYROLL_TAX", `PAYROLL_TAX:${r.month}`, d.due), ownCrew: ownCrew?.[r.month] ?? null }; }),
  };

  // BAS
  const bas = periodsOfFy(fy, settings.BAS_FREQUENCY).filter((p) => p.from <= today).map((p) => {
    const due = basDueDate(p, settings.BAS_FREQUENCY, settings.LODGEMENT);
    return { ...p, gst: gstForPeriod(m.invoices, p.from, p.to), due, open: p.to >= today, calendar: cal("BAS", `BAS:${p.key}`, due) };
  });

  return {
    fy, fyLabel: fyLabel(fy), today, note: ESTIMATE_NOTE, paygNote: PAYG_NOTE,
    sources: m.sources, settings, accounts, payroll, bas,
    rateSet: !year.notSet,
  };
}

// ---------- the calendar ----------
export async function addToCalendar(who: Who, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const kind = b.kind === "BAS" ? "BAS" : b.kind === "PAYROLL_TAX" ? "PAYROLL_TAX" : null;
  const key = String(b.periodKey ?? "");
  if (!kind) return { error: "BAS or payroll tax?", status: 400 };
  const fy = kind === "BAS" ? Number(key.slice(0, 4)) - (/^\d{4}-\d{2}$/.test(key) && Number(key.slice(5, 7)) < 7 ? 1 : 0) : fyOfDate(`${key}-01`);
  const v = await taxView(String(fy));
  const sourceId = `${kind}:${key}`;
  const row = kind === "BAS" ? v.bas.find((p) => p.key === key) : v.payroll.rows.find((r) => r.month === key);
  if (!row) return { error: "That period isn't in the estimates.", status: 404 };
  if (row.calendar) return { error: "It's already on the calendar.", status: 409 };
  const due = "due" in row ? row.due : "";
  const amount = kind === "BAS" ? (row as (typeof v.bas)[number]).gst.net : (row as (typeof v.payroll.rows)[number]).tax;
  const title = kind === "BAS" ? `BAS ${(row as (typeof v.bas)[number]).label} (estimate)` : `Payroll tax ${(row as (typeof v.payroll.rows)[number]).dueWhat} - ${key} (estimate)`;
  const item = await prisma.accountsItem.create({
    data: { kind: "DUE", category: kind, title, dueDate: due, amount: amount != null && amount > 0 ? amount : null, notes: ESTIMATE_NOTE, alertDays: 7, sourceType: "TAX_ESTIMATE", sourceId, createdBy: who.name },
  });
  return { id: item.id };
}

// Only when Victoria asks: put the current estimate into her item's expected amount.
export async function useEstimateAsAmount(b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const kind = b.kind === "BAS" ? "BAS" : b.kind === "PAYROLL_TAX" ? "PAYROLL_TAX" : null;
  const item = await prisma.accountsItem.findUnique({ where: { id: String(b.itemId ?? "") } });
  if (!kind || !item || item.category !== kind) return { error: "That calendar item isn't for this estimate.", status: 400 };
  const key = String(b.periodKey ?? "");
  const fy = kind === "BAS" ? Number(key.slice(0, 4)) - (/^\d{4}-\d{2}$/.test(key) && Number(key.slice(5, 7)) < 7 ? 1 : 0) : fyOfDate(`${key}-01`);
  const v = await taxView(String(fy));
  const amount = kind === "BAS" ? v.bas.find((p) => p.key === key)?.gst.net : v.payroll.rows.find((r) => r.month === key)?.tax;
  if (amount == null) return { error: "There's no estimate for that period yet.", status: 409 };
  await prisma.accountsItem.update({ where: { id: item.id }, data: { amount: amount > 0 ? amount : null } });
  return { ok: true };
}

// One line for the Directors' Cash tile (director access): the next BAS and this month's payroll tax, as estimates.
export async function directorsTaxLine(): Promise<string | null> {
  const v = await taxView();
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
  const nextBas = v.bas.find((p) => p.due >= v.today && (p.gst.sales + p.gst.bills) > 0);
  const lastPayroll = v.payroll.rows[v.payroll.rows.length - 1];
  const parts = [
    nextBas && `next BAS ${nextBas.label} ${nextBas.gst.net < 0 ? `refund ${money(-nextBas.gst.net)}` : money(nextBas.gst.net)} due ${nextBas.due}`,
    lastPayroll?.tax != null && `payroll tax ${lastPayroll.month} ${money(lastPayroll.tax)}`,
  ].filter(Boolean);
  return parts.length ? `Tax (estimate): ${parts.join(" · ")}` : null;
}
