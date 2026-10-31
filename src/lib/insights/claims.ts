// "Claimed" on the Directors screen (stages 1-3, Ilies 30 Oct 2026: "build stages 1-3"; plan in
// director-insights-plan/CLAIMED-PLAN.md). Plain functions over the Xero sales mirror: what each job has been invoiced
// (F14), the company by month (F15), claimed against cost to date (F16), left to claim (F17) and how far to trust it.
// The "what counts as a sale" rule is the revenue tile's own (xero/summary.ts signedSaleLines) - one rule. Never called
// margin or profit. No server imports; `npm test` (claims.test.ts).
import { countsAsSale, signedSaleLines } from "../xero/summary";
import { THRESHOLDS } from "./dictionary";

export type ClaimInvoice = {
  number: string; contact: string; date: string; type: string; status: string; totalExGst: number;
  matchMethod: string | null; matchNote?: string | null; xeroId?: string | null;
  lines: { amountExGst: number; projectId: string | null; matchMethod: string | null }[];
};
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// F14 per job, plus the company split. The company total is the sum of the counted lines, so per-job + not tied yet +
// not a job always adds up to it exactly.
export function claimsByJob(invoices: ClaimInvoice[], today: string) {
  const jobs = new Map<string, { claimed: number; invoices: Set<string>; lastDate: string | null }>();
  let tied = 0, notTied = 0, notAJob = 0;
  const notTiedInvoices = new Set<string>();
  for (const i of invoices) {
    if (i.date > today) continue;
    for (const l of signedSaleLines(i)) {
      if (l.projectId) {
        const j = jobs.get(l.projectId) ?? { claimed: 0, invoices: new Set<string>(), lastDate: null };
        j.claimed += l.amount;
        j.invoices.add(`${i.type}|${i.number}`);
        if (!j.lastDate || i.date > j.lastDate) j.lastDate = i.date;
        jobs.set(l.projectId, j);
        tied += l.amount;
      } else if (l.notAJob) notAJob += l.amount;
      else { notTied += l.amount; notTiedInvoices.add(`${i.type}|${i.number}`); }
    }
  }
  const byJob = new Map([...jobs].map(([id, j]) => [id, { claimed: r2(j.claimed), invoices: j.invoices.size, lastDate: j.lastDate }]));
  return {
    byJob,
    totals: { total: r2(tied + notTied + notAJob), tied: r2(tied), notTied: r2(notTied), notAJob: r2(notAJob) },
    notTiedInvoices: notTiedInvoices.size,
  };
}

// The reconciliation guard (CLM-001): a counted sales document whose lines don't add up to its total ex GST (more than
// 5 cents out) - its jobs drop to LOW confidence and the count goes on the data-quality list. Older uploads keep the
// lines they were read with; the next live read rewrites them.
export const LINES_OFF_TOLERANCE = 0.05;
export function linesOff(invoices: ClaimInvoice[], today: string) {
  const jobs = new Set<string>();
  let count = 0;
  for (const i of invoices) {
    if (i.date > today || !countsAsSale(i)) continue;
    const sum = i.lines.reduce((n, l) => n + l.amountExGst, 0);
    if (Math.abs(sum - i.totalExGst) > LINES_OFF_TOLERANCE) {
      count += 1;
      for (const l of i.lines) if (l.projectId) jobs.add(l.projectId);
    }
  }
  return { count, jobs };
}

// F15: the last N months (this month so far included), by invoice month, in three bands. A month before the Xero sales
// start is marked so the chart can say "not in Xero yet" rather than show nothing as if nothing was claimed.
export function claimedByMonth(invoices: ClaimInvoice[], today: string, from: string | null, months: number = THRESHOLDS.claimsMonths) {
  const ym = today.slice(0, 7);
  const list: string[] = [];
  let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  for (let k = 0; k < months; k++) {
    list.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  const rows = new Map(list.map((mo) => [mo, { tied: 0, notTied: 0, notAJob: 0 }]));
  for (const i of invoices) {
    if (i.date > today) continue;
    const row = rows.get(i.date.slice(0, 7));
    if (!row) continue;
    for (const l of signedSaleLines(i)) {
      if (l.projectId) row.tied += l.amount;
      else if (l.notAJob) row.notAJob += l.amount;
      else row.notTied += l.amount;
    }
  }
  const fromMonth = from ? from.slice(0, 7) : null;
  return list.map((mo) => {
    const r = rows.get(mo)!;
    return { month: mo, tied: r2(r.tied), notTied: r2(r.notTied), notAJob: r2(r.notAJob), partial: mo === ym, beforeMirror: !fromMonth || mo < fromMonth };
  });
}

// F16 and F17 for one job. "Left to claim" is against the Operations contract value only; above it the screen says so in
// words, never a negative amount. Low confidence when the job's first cost is well before the Xero sales start (claims
// from before then aren't in), or when the company's sales aren't mostly tied to jobs.
export function jobClaimPosition(j: {
  claimed: number; totalCost: number; contractValue: number | null; firstCostDate: string | null;
  from: string | null; companyConfidence: Confidence;
}) {
  const lessCost = r2(j.claimed - j.totalCost);
  const over = j.contractValue != null && j.claimed > j.contractValue;
  const leftToClaim = j.contractValue == null ? null : over ? null : r2(j.contractValue - j.claimed);
  const incomplete = !j.from || (j.firstCostDate != null && j.firstCostDate < addDays(j.from, -THRESHOLDS.claimCostGapDays));
  const confidence: Confidence = incomplete ? "LOW" : j.companyConfidence;
  const why = incomplete
    ? j.from ? `The job's costs start before the Xero sales do (${j.from}) - earlier claims aren't in` : "No Xero sales read yet"
    : j.companyConfidence === "HIGH" ? "All of the job's costs are inside the Xero sales period, and most sales are tied to a job"
      : j.companyConfidence === "MEDIUM" ? "Some sales aren't tied to a job yet - this job may read low" : "The Xero figures are a manual upload or haven't been read recently";
  return {
    claimed: r2(j.claimed), lessCost, leftToClaim, over, overBy: over ? r2(j.claimed - (j.contractValue as number)) : null,
    noContract: j.contractValue == null, confidence, why,
    overText: over ? "Claimed more than the contract value (variations aren't in Operations)" : null,
  };
}

// How far to trust the claims, company-wide (F14 / F15): live and fresh with most sales tied -> HIGH; live but too much
// not tied -> MEDIUM; a manual upload or a stale read -> LOW. Uses F9's own tied threshold (THRESHOLDS.revenueTiedHighAt).
export function claimsConfidence(c: { live: boolean; stale: boolean; tied: number; notTied: number }) {
  const base = c.tied + c.notTied;
  const share = base > 0 ? c.tied / base : null;
  const level: Confidence = !c.live || c.stale ? "LOW" : share != null && share >= THRESHOLDS.revenueTiedHighAt ? "HIGH" : "MEDIUM";
  const why = !c.live ? "From a manual Xero export - only as current as the last upload"
    : c.stale ? "Xero hasn't been read recently - check the connection on Accounts data"
      : share == null ? "No sales to tie to jobs yet"
        : `${Math.round(share * 100)}% of sales (excluding \"not a job\") are tied to a job`;
  return { level, why, tiedShare: share };
}

// The job table: active jobs, plus any with a board day in the last N days (THRESHOLDS.claimsRecentDays). Overhead
// buckets never.
export function claimsJobRows<P extends { id: string; status: string; health: string; lastDate: string | null }>(projects: P[], today: string) {
  const since = addDays(today, -THRESHOLDS.claimsRecentDays);
  return projects.filter((p) => p.health !== "OVERHEAD" && (p.status === "ACTIVE" || (p.lastDate != null && p.lastDate >= since)));
}

// The counted sales lines of some documents, signed and summed.
export const signedLinesFrom = (invoices: ClaimInvoice[]) => invoices.reduce((n, i) => n + signedSaleLines(i).reduce((m, l) => m + l.amount, 0), 0);

// The earliest sales date the mirror holds - shown as "Xero sales from <date>".
export const mirrorFrom = (invoices: ClaimInvoice[]) =>
  invoices.reduce<string | null>((m, i) => ((i.type === "SALE" || i.type === "SALE_CREDIT") && (m == null || i.date < m) ? i.date : m), null);

// Draft and awaiting-approval (SUBMITTED) sales invoices are never counted - shown as a data-quality count (CLM-006).
export const draftSales = (invoices: ClaimInvoice[]) =>
  invoices.filter((i) => (i.type === "SALE" || i.type === "SALE_CREDIT") && ["DRAFT", "SUBMITTED"].includes(i.status.toUpperCase())).length;
