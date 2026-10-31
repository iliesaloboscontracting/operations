// Xero figures for the Directors health band (G2, 25 Oct 2026), from the
// latest upload of each kind. Manual exports, so always "Manual upload, as
// at <date>" and LOW confidence. Revenue = sales invoices less credit notes,
// ex GST, this financial year (from 1 July), voided, draft and awaiting-approval
// left out. Owed and overdue (F10) use Xero's own amount-due (inc GST), with the
// same invoices left out - awaiting approval (SUBMITTED) too. The P&L lines are
// shown as Xero reports them - never re-added or re-categorised.
// Plain functions; `npm test` (xero.test.ts).
import { XERO_CONFIG } from "./config";
import type { HealthTile } from "../insights/health";
import { THRESHOLDS } from "../insights/dictionary";

export type SummaryInvoice = {
  type: string; status: string; date: string; dueDate: string | null; totalExGst: number; amountDue: number | null;
  matchMethod: string | null; lines: { amountExGst: number; projectId: string | null; matchMethod: string | null }[];
};
export type SummaryPnl = { month: string; section: string; account: string; amount: number };
export type XeroImportInfo = { asAt: string | null; uploadedBy: string | null; createdAt: string; source?: string };

export function fyStart(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const s = XERO_CONFIG.financialYearStartMonth;
  return `${m >= s ? y : y - 1}-${String(s).padStart(2, "0")}-01`;
}

const counts = (status: string) => !XERO_CONFIG.ignoredStatuses.includes(status.toUpperCase());
const isSale = (t: string) => t === "SALE" || t === "SALE_CREDIT";
const sign = (t: string) => (t.endsWith("CREDIT") ? -1 : 1);
const r2 = (n: number) => Math.round(n * 100) / 100;

// What counts as a sale, line by line, with the right sign - the one rule the revenue tile and the Directors' claims
// (lib/insights/claims.ts) both use (30 Oct 2026). A sales invoice counts +, a credit note -, ex GST; bills and
// voided / deleted / draft invoices don't count at all. Each line says where it went: a job (projectId), "not a job"
// (a person said so), or not tied yet.
export const countsAsSale = (i: { type: string; status: string }) => isSale(i.type) && counts(i.status);
export type SignedSaleLine = { amount: number; projectId: string | null; notAJob: boolean };
export function signedSaleLines(i: { type: string; status: string; lines: { amountExGst: number; projectId: string | null; matchMethod: string | null }[] }): SignedSaleLine[] {
  if (!countsAsSale(i)) return [];
  return i.lines.map((l) => ({ amount: sign(i.type) * l.amountExGst, projectId: l.projectId, notAJob: !l.projectId && l.matchMethod === "PERSON" }));
}

export const needsReview = (i: Pick<SummaryInvoice, "type" | "status" | "matchMethod">) =>
  isSale(i.type) && counts(i.status) && (i.matchMethod === "NONE" || i.matchMethod === "SITE_TEXT" || i.matchMethod === "MIXED");

export function revenueSummary(invoices: SummaryInvoice[], today: string) {
  const from = fyStart(today);
  const sales = invoices.filter(countsAsSale);
  const fy = sales.filter((i) => i.date >= from && i.date <= today);
  let invoiced = 0, matched = 0, notAJob = 0;
  for (const i of fy) {
    invoiced += sign(i.type) * i.totalExGst;
    for (const l of signedSaleLines(i)) {
      if (l.projectId) matched += l.amount;
      else if (l.notAJob) notAJob += l.amount;
    }
  }
  const review = sales.filter(needsReview);
  const owedRows = invoices.filter((i) => i.type === "SALE" && counts(i.status) && (i.amountDue ?? 0) > 0);
  const overdueRows = owedRows.filter((i) => i.dueDate && i.dueDate < today);
  return {
    from,
    invoiced: r2(invoiced),
    invoiceCount: fy.length,
    matched: r2(matched),
    notAJob: r2(notAJob),
    unmatched: r2(invoiced - matched - notAJob),
    matchedShare: invoiced - notAJob > 0 ? matched / (invoiced - notAJob) : null,
    reviewCount: review.length,
    reviewValue: r2(review.reduce((n, i) => n + sign(i.type) * i.totalExGst, 0)),
    owed: r2(owedRows.reduce((n, i) => n + (i.amountDue ?? 0), 0)),
    overdue: r2(overdueRows.reduce((n, i) => n + (i.amountDue ?? 0), 0)),
    overdueCount: overdueRows.length,
  };
}

export function pnlSummary(lines: SummaryPnl[]) {
  const months = [...new Set(lines.map((l) => l.month))].sort();
  const latest = months[months.length - 1] ?? null;
  const pick = (re: RegExp) => lines.find((l) => l.month === latest && l.section === "Summary" && re.test(l.account)) ?? null;
  return { latest, months: months.length, netProfit: pick(/^net (profit|loss)/i), totalIncome: pick(/^total (trading )?income/i) };
}

const money = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${s}$${Math.round(a / 1000)}k`;
  return `${s}$${Math.round(a).toLocaleString("en-AU")}`;
};
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
const dayName = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }) : "unknown date");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// asAt on a tile is a moment: the export date at midnight Sydney-ish (UTC is fine for display of a day).
const asAtIso = (i: XeroImportInfo) => (i.asAt ? `${i.asAt}T00:00:00.000Z` : i.createdAt);

// Where the figures came from (G3): accounts' upload (manual, LOW) or the live
// read-only connection (read at a time; Stale and LOW after 36 hours without
// a fresh read, so old data never passes for current).
export const STALE_AFTER_HOURS = 36;
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function provenance(info: XeroImportInfo, now: Date) {
  if (info.source !== "API") {
    return { live: false, stale: false, source: `Xero export uploaded by ${info.uploadedBy ?? "accounts"}`, asAt: asAtIso(info), asAtLabel: dayName(info.asAt), word: "Manual upload" };
  }
  const stale = now.getTime() - new Date(info.createdAt).getTime() > STALE_AFTER_HOURS * 3_600_000;
  return { live: true, stale, source: "Xero, read-only connection", asAt: info.createdAt, asAtLabel: when(info.createdAt), word: stale ? "Stale" : "Live from Xero" };
}

export function revenueTile(inv: { info: XeroImportInfo; s: ReturnType<typeof revenueSummary> } | null, pnl: { info: XeroImportInfo; s: ReturnType<typeof pnlSummary> } | null, now = new Date()): HealthTile | undefined {
  if (!inv && !pnl) return undefined;
  const info = inv?.info ?? pnl!.info;
  const p = provenance(info, now);
  const lines: string[] = [];
  if (inv) {
    lines.push(`Invoiced since ${dayName(inv.s.from)} (ex GST), ${plural(inv.s.invoiceCount, "invoice")}`);
    lines.push(inv.s.matchedShare != null ? `${Math.round(inv.s.matchedShare * 100)}% tied to a job${inv.s.reviewCount ? ` · ${inv.s.reviewCount} to sort out` : ""}` : "Nothing to tie to jobs yet");
  } else lines.push("No invoice export uploaded yet");
  if (pnl?.s.latest) {
    lines.push(pnl.s.netProfit ? `P&L ${monthName(pnl.s.latest)}: ${pnl.s.netProfit.account.toLowerCase()} ${money(pnl.s.netProfit.amount)}, as Xero reports it` : `P&L uploaded to ${monthName(pnl.s.latest)}`);
  } else lines.push("No Profit and Loss uploaded yet");
  const share = inv?.s.matchedShare ?? null;
  return {
    id: "revenue", title: "Revenue & P&L", status: p.stale || (inv && inv.s.reviewCount) ? "WATCH" : "INFO",
    statusWord: p.stale ? `Stale - last read ${p.asAtLabel}` : inv && inv.s.reviewCount ? `${inv.s.reviewCount} not tied to a job` : p.word,
    headline: inv ? money(inv.s.invoiced) : pnl?.s.totalIncome ? money(pnl.s.totalIncome.amount) : null,
    lines, source: p.source, asAt: p.asAt, asAtLabel: p.asAtLabel,
    confidence: !p.live || p.stale ? "LOW" : share != null && share >= THRESHOLDS.revenueTiedHighAt ? "HIGH" : "MEDIUM",
    confidenceWhy: !p.live
      ? `A manual export as at ${dayName(info.asAt)} - only as current as the last upload`
      : p.stale ? `Xero hasn't been read for over ${STALE_AFTER_HOURS} hours - check the connection on Accounts data`
        : `Read from Xero ${p.asAtLabel}; ${share != null ? `${Math.round(share * 100)}% of it tied to a job` : "nothing to tie to jobs yet"}`,
    missing: !p.live ? "The live Xero connection" : p.stale ? "A fresh read from Xero" : null, kpi: "F9", href: "/directors/accounts",
  };
}

export function cashTile(inv: { info: XeroImportInfo; s: ReturnType<typeof revenueSummary> } | null, now = new Date()): HealthTile | undefined {
  if (!inv) return undefined;
  const s = inv.s;
  const p = provenance(inv.info, now);
  return {
    id: "cash", title: "Cash & receivables", status: p.stale || s.overdueCount ? "WATCH" : "INFO",
    statusWord: p.stale ? `Stale - last read ${p.asAtLabel}` : s.overdueCount ? `${plural(s.overdueCount, "invoice")} overdue` : p.word,
    headline: money(s.owed),
    lines: [
      "Owed to us (inc GST)",
      s.overdueCount ? `Overdue: ${money(s.overdue)} on ${plural(s.overdueCount, "invoice")}` : "Nothing overdue",
    ],
    source: p.source, asAt: p.asAt, asAtLabel: p.asAtLabel,
    confidence: !p.live || p.stale ? "LOW" : "HIGH",
    confidenceWhy: !p.live ? `A manual export as at ${dayName(inv.info.asAt)} - payments since then aren't in`
      : p.stale ? `Xero hasn't been read for over ${STALE_AFTER_HOURS} hours` : `Amounts due as Xero had them ${p.asAtLabel}`,
    missing: !p.live ? "The live Xero connection" : p.stale ? "A fresh read from Xero" : null, kpi: "F10", href: "/directors/accounts",
  };
}
