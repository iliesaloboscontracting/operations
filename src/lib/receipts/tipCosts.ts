// Receipts R3 - tip costs, the plain maths (design §Costs). No database here: ./tipStore.ts loads and
// saves. A READ / CONFIRMED tip docket is an estimated tip cost on its job until the tip invoice
// arrives: its printed price ex GST, else tonnes × the tip rate in force on its date, else unpriced
// ("Add a tip rate"). A tip invoice replaces the dockets it bills - matched by the docket numbers on
// it, or else supplier + job + date range - so nothing is counted twice, the same idea as hireEstimate.
import { normDocket } from "./checks";

export const UNINVOICED_AFTER_DAYS = 35;
// Dockets have been photographed from site since Receipts went live (26 Oct 2026). A tip invoice for
// loads before then has no docket to find - it's never flagged as "no docket from site".
export const RECEIPTS_FROM = "2026-10-26";

// "Bingo  Eastern-Creek " -> "bingo eastern creek": how names are compared.
export const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A docket's date as a Sydney calendar day.
export const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

// ---------- rates ----------

export type Rate = { id: string; tipSite: string; wasteType: string; ratePerTonneExGst: number; validFrom: string; retiredAt: Date | string | null };

// The rate in force on `day` for a site and waste type: the latest validFrom on or before the day,
// for that exact waste type, else the site's "any waste" rate ("").
export function rateFor(rates: Rate[], tipSite: string | null, wasteType: string | null, day: string): Rate | null {
  const site = normName(tipSite), waste = normName(wasteType);
  if (!site) return null;
  const live = rates.filter((r) => !r.retiredAt && normName(r.tipSite) === site && r.validFrom <= day);
  const latest = (xs: Rate[]) => xs.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
  return (waste && latest(live.filter((r) => normName(r.wasteType) === waste))) || latest(live.filter((r) => !normName(r.wasteType)));
}

export type DocketForCost = { priceExGst: number | null; tonnes: number | null; tipSite: string | null; wasteType: string | null; day: string };
export type DocketCost = { amount: number | null; basis: "PRICE" | "RATE" | "UNPRICED"; rateId: string | null };

export function docketCost(d: DocketForCost, rates: Rate[]): DocketCost {
  if (d.priceExGst != null && d.priceExGst > 0) return { amount: Math.round(d.priceExGst * 100) / 100, basis: "PRICE", rateId: null };
  const r = d.tonnes != null && d.tonnes > 0 ? rateFor(rates, d.tipSite, d.wasteType, d.day) : null;
  if (r && d.tonnes) return { amount: Math.round(d.tonnes * r.ratePerTonneExGst * 100) / 100, basis: "RATE", rateId: r.id };
  return { amount: null, basis: "UNPRICED", rateId: null };
}

// ---------- invoices <-> dockets ----------

// Words that don't tell one tip from another.
const COMMON = new Set(["pty", "ltd", "limited", "the", "and", "group", "services", "service", "waste", "recycling", "recycle", "resource", "resources", "recovery", "centre", "center", "facility", "transfer", "station", "landfill", "tip", "co", "australia", "aust", "nsw", "sydney", "management", "environmental", "solutions"]);
const words = (s: string | null | undefined) => normName(s).split(" ").filter((w) => w.length >= 3 && !COMMON.has(w));

// Does an invoice's supplier name plausibly name this docket's tip? ("Bingo Industries" ~ "Bingo
// Eastern Creek"; "Cleanaway" ~ "Cleanaway Erskine Park"; not "Veolia" ~ "Bingo".)
export function supplierMatches(vendor: string | null | undefined, tipSite: string | null | undefined): boolean {
  const v = words(vendor), t = new Set(words(tipSite));
  return v.length > 0 && v.some((w) => t.has(w));
}

export type InvoiceForMatch = { id: string; projectId: string; vendor: string; weekEnding: string; periodFrom: string | null; periodTo: string | null; docketNos: string[] };
export type DocketForMatch = { id: string; projectId: string | null; docketNo: string | null; tipSite: string | null; day: string; invoicedCostId: string | null };

// The dockets one tip invoice bills. With docket numbers: those dockets on the same job (numbers
// are the strongest evidence). Without: same job, supplier ~ tip site, dated inside the invoice's
// period - or the 35 days up to the invoice date when it has none. Dockets already matched to
// another invoice are never taken.
export function matchInvoice(inv: InvoiceForMatch, dockets: DocketForMatch[]): string[] {
  const free = dockets.filter((d) => d.projectId === inv.projectId && (d.invoicedCostId == null || d.invoicedCostId === inv.id));
  const nos = new Set(inv.docketNos.map(normDocket).filter(Boolean));
  if (nos.size) return free.filter((d) => nos.has(normDocket(d.docketNo))).map((d) => d.id);
  const from = inv.periodFrom ?? addDays(inv.weekEnding, -UNINVOICED_AFTER_DAYS);
  const to = inv.periodTo ?? inv.weekEnding;
  return free.filter((d) => d.day >= from && d.day <= to && supplierMatches(inv.vendor, d.tipSite)).map((d) => d.id);
}

// All tip invoices against all dockets: which invoice each docket goes to. Invoices with docket
// numbers go first (they're exact), then the rest oldest first, so a docket goes to one invoice only.
export function matchAll(invoices: InvoiceForMatch[], dockets: DocketForMatch[]): Map<string, string> {
  const out = new Map<string, string>();
  const order = [...invoices].sort((a, b) => Number(b.docketNos.length > 0) - Number(a.docketNos.length > 0) || a.weekEnding.localeCompare(b.weekEnding) || a.id.localeCompare(b.id));
  for (const inv of order) {
    const pool = dockets.filter((d) => !out.has(d.id)).map((d) => ({ ...d, invoicedCostId: null }));
    for (const id of matchInvoice(inv, pool)) out.set(id, inv.id);
  }
  return out;
}

// ---------- the two mismatch flags ----------

// Should this tip invoice have dockets from site? Only when the loads it bills are all after
// Receipts went live: its period starts then or later, or - with no period - the 35 days up to its date do.
export const expectsDockets = (inv: { weekEnding: string; periodFrom: string | null }) =>
  (inv.periodFrom ?? addDays(inv.weekEnding, -UNINVOICED_AFTER_DAYS)) >= RECEIPTS_FROM;

// A docket still not on any invoice 35 days after its date.
export const isUninvoiced = (d: { day: string; invoicedCostId: string | null }, today: string) =>
  d.invoicedCostId == null && d.day <= addDays(today, -UNINVOICED_AFTER_DAYS);

// Parse the docket numbers typed on Add invoice ("A123, A124 A125") or read from the invoice.
export function parseDocketNos(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  return [...new Set(list.map((x) => x.trim().slice(0, 40)).filter((x) => normDocket(x).length >= 2))].slice(0, 300);
}
export const docketNosOf = (s: string | null | undefined): string[] => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
