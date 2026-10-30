// The Directors' "Claimed (Xero)" payloads (30 Oct 2026, stages 2-3): the overview section and one job's claims, built
// from the Xero sales mirror (xero/imports.ts loadXeroClaims) and Project Tracking's costs (never recomputed). Director
// access only - the two routes that call this are behind guardDirector; Tracking never carries any of it. Never
// called margin or profit. No server imports.
import { STALE_AFTER_HOURS, countsAsSale } from "../xero/summary";
import { suggestionOf } from "../xero/match";
import { claimedByMonth, claimsByJob, claimsConfidence, claimsJobRows, draftSales, jobClaimPosition, mirrorFrom, type ClaimInvoice } from "./claims";
import { XERO_CONFIG } from "../xero/config";

type XeroClaims = { info: { source: string; asAt: string | null; uploadedBy: string | null; createdAt: string }; invoices: ClaimInvoice[] } | null;
type CostProject = { id: string; name: string; jobNo: string | null; status: string; health: string; contractValue: number | null; totalCost: number; firstDate: string | null; lastDate: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function provenance(x: NonNullable<XeroClaims>, now: Date) {
  const live = x.info.source === "API";
  const stale = live && now.getTime() - new Date(x.info.createdAt).getTime() > STALE_AFTER_HOURS * 3_600_000;
  return {
    live, stale,
    sourceLabel: live ? (stale ? "Xero, read-only connection - stale" : "Live from Xero") : `Xero export uploaded by ${x.info.uploadedBy ?? "accounts"}`,
    readAtLabel: live ? when(x.info.createdAt) : x.info.asAt ?? when(x.info.createdAt),
  };
}

export function claimsOverview(x: XeroClaims, projects: CostProject[], today: string, now: Date) {
  if (!x) return null;
  const p = provenance(x, now);
  // The live read starts at the fixed mirror start (stage 4); an upload covers what the export held.
  const from = p.live ? XERO_CONFIG.mirrorFrom : mirrorFrom(x.invoices);
  const c = claimsByJob(x.invoices, today);
  const conf = claimsConfidence({ live: p.live, stale: p.stale, tied: c.totals.tied, notTied: c.totals.notTied });
  const rows = claimsJobRows(projects, today).map((pr) => {
    const j = c.byJob.get(pr.id) ?? { claimed: 0, invoices: 0, lastDate: null };
    return {
      id: pr.id, name: pr.name, jobNo: pr.jobNo, status: pr.status, contractValue: pr.contractValue, invoices: j.invoices, lastClaim: j.lastDate,
      ...jobClaimPosition({ claimed: j.claimed, totalCost: pr.totalCost, contractValue: pr.contractValue, firstCostDate: pr.firstDate, from, companyConfidence: conf.level }),
    };
  }).sort((a, b) => b.claimed - a.claimed || a.name.localeCompare(b.name));
  const inTable = new Set(rows.map((r) => r.id));
  // Claimed on jobs not in the table (completed or older) - so the table, these, "not tied" and "not a job" add up to
  // the company total.
  const otherJobs = r2([...c.byJob].filter(([id]) => !inTable.has(id)).reduce((n, [, j]) => n + j.claimed, 0));
  return {
    source: p.live ? "API" : "UPLOAD", sourceLabel: p.sourceLabel, readAtLabel: p.readAtLabel, live: p.live, stale: p.stale,
    from, confidence: conf.level, confidenceWhy: conf.why, tiedShare: conf.tiedShare,
    totals: c.totals, otherJobs,
    months: claimedByMonth(x.invoices, today, from),
    jobs: rows,
    notTiedInvoices: c.notTiedInvoices,
    drafts: draftSales(x.invoices),
  };
}
export type ClaimsOverviewDTO = NonNullable<ReturnType<typeof claimsOverview>>;

// One job's claims for the director job page (stage 3): the position, the invoices tied to it (newest first, this job's
// share of each), and how many untied invoices the matcher thinks may be this job - waiting for accounts to decide.
export function jobClaims(x: XeroClaims, project: CostProject, projects: CostProject[], today: string, now: Date) {
  if (!x) return null;
  const all = claimsOverview(x, projects, today, now)!;
  const c = claimsByJob(x.invoices, today);
  const j = c.byJob.get(project.id) ?? { claimed: 0, invoices: 0, lastDate: null };
  const invoices = x.invoices
    .filter((i) => i.date <= today && (i.type === "SALE" || i.type === "SALE_CREDIT"))
    .map((i) => {
      const counted = countsAsSale(i); // the same rule as every other sales figure
      const sign = i.type === "SALE_CREDIT" ? -1 : 1;
      const share = i.lines.filter((l) => l.projectId === project.id).reduce((n, l) => n + sign * l.amountExGst, 0);
      return { number: i.number, date: i.date, contact: i.contact, credit: i.type === "SALE_CREDIT", amount: r2(share), counted, has: i.lines.some((l) => l.projectId === project.id) };
    })
    .filter((i) => i.has && i.counted)
    .map(({ has: _h, counted: _c, ...rest }) => rest);
  const maybe = x.invoices.filter((i) => (i.matchMethod === "NONE" || i.matchMethod === "SITE_TEXT" || i.matchMethod === "MIXED") && suggestionOf(i.matchNote ?? null) === project.id).length;
  return {
    sourceLabel: all.sourceLabel, readAtLabel: all.readAtLabel, from: all.from, companyConfidence: all.confidence,
    invoiceCount: j.invoices, lastClaim: j.lastDate,
    ...jobClaimPosition({ claimed: j.claimed, totalCost: project.totalCost, contractValue: project.contractValue, firstCostDate: project.firstDate, from: all.from, companyConfidence: all.confidence }),
    invoices, maybe,
  };
}
export type JobClaimsDTO = NonNullable<ReturnType<typeof jobClaims>>;
