// Agreed rates (Accounts stage 4, docs/accounts/STAGE4-DESIGN.md) - pure rules for comparing invoice lines with
// Estimating's rate sheet (contract rate-sheet.v1). Rates are read from Estimating, never stored here.

export const OVER_RATE_TOLERANCE = 0.02; // Draft - for Ilies / Victoria: 2% above the agreed rate
export const MATCH_BAR = 0.5;

export type SheetRate = { id: string; supplier: string; item: string; category: string; unit: string; rateExGst: number; validFrom: string | null; validTo: string | null; source?: string; confidence?: string };
export type RateSheet = { schema_version: "rate-sheet.v1"; version: string; rates: SheetRate[] };
export type InvoiceLine = { description: string; quantity: number | null; unit: string | null; unitPriceExGst: number | null };

const UNITS: [RegExp, string][] = [
  [/^(d|day|days|per day|\/day|daily)$/, "day"], [/^(w|wk|wks|week|weeks|per week|\/wk|\/week|weekly)$/, "wk"],
  [/^(h|hr|hrs|hour|hours|per hour|\/hr|hourly)$/, "hr"], [/^(t|tn|tonne|tonnes|ton|tons|per tonne|\/t)$/, "t"],
  [/^(ea|each|unit|units|no|item|items|pc|pcs)$/, "each"], [/^(load|loads)$/, "load"], [/^(trip|trips)$/, "trip"],
  [/^(m3|m³|cubic metre|cubic metres|cu m)$/, "m³"], [/^(m|lm|metre|metres|meter|meters|lin m)$/, "m"], [/^(bag|bags)$/, "bag"],
];
export function normUnit(u: string | null | undefined): string | null {
  const s = (u ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!s) return null;
  for (const [re, unit] of UNITS) if (re.test(s)) return unit;
  return s;
}

const STOP = new Set(["pty", "ltd", "limited", "co", "the", "and", "inc"]);
const toks = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
// "L.H. Hire Pty Ltd" and "LH Hire" -> "lh hire" (dots joining initials are dropped first).
export const supplierKey = (s: string | null | undefined) => toks((s ?? "").replace(/\b([a-z])\.(?=[a-z]\.?)/gi, "$1").replace(/\./g, "")).join(" ");
export const lineKey = (s: string) => toks(s).join(" ");
const sameSupplier = (a: string, b: string) => !!a && !!b && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `));

const words = (s: string) => new Set(toks(s).filter((w) => w.length >= 2 || /\d/.test(w)));
function overlap(a: string, b: string) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export type LineMatch =
  | { how: "LINKED" | "SUGGESTED"; rate: SheetRate; score: number }
  | { how: "NONE"; reason: string; candidates: SheetRate[] };

// A remembered link wins; else the same supplier and unit with the best word overlap (clear winner above the bar).
export function matchLine(line: InvoiceLine, supplier: string | null, rates: SheetRate[], links: Map<string, string>): LineMatch {
  const sk = supplierKey(supplier);
  const linked = links.get(`${sk}|${lineKey(line.description)}`);
  if (linked) {
    const r = rates.find((x) => x.id === linked);
    if (r) return { how: "LINKED", rate: r, score: 1 };
  }
  const fromSupplier = rates.filter((r) => sameSupplier(supplierKey(r.supplier), sk));
  if (!fromSupplier.length) return { how: "NONE", reason: "No rates for this supplier in Estimating", candidates: [] };
  const unit = normUnit(line.unit);
  const sameUnit = unit ? fromSupplier.filter((r) => normUnit(r.unit) === unit) : fromSupplier;
  const scored = sameUnit.map((r) => ({ r, s: overlap(line.description, r.item) })).sort((a, b) => b.s - a.s);
  const candidates = (scored.length ? scored.map((x) => x.r) : fromSupplier).slice(0, 5);
  if (!scored.length) return { how: "NONE", reason: unit ? `No ${unit} rate for this supplier` : "No unit on the line", candidates };
  const [best, next] = scored;
  if (best.s < MATCH_BAR || (next && next.s === best.s)) return { how: "NONE", reason: "Pick the rate", candidates };
  return { how: "SUGGESTED", rate: best.r, score: Math.round(best.s * 100) / 100 };
}

export const validOn = (r: SheetRate, date: string | null) => !date || ((!r.validFrom || r.validFrom <= date) && (!r.validTo || r.validTo >= date));

export type RateCheck = { over: boolean; diffPerUnit: number; diffTotal: number | null; outsideValidity: boolean };
// Over when the unit price is more than the tolerance above the agreed rate (both ex GST).
export function checkRate(line: InvoiceLine, rate: SheetRate, invoiceDate: string | null, tol = OVER_RATE_TOLERANCE): RateCheck | null {
  if (line.unitPriceExGst == null || !Number.isFinite(rate.rateExGst) || rate.rateExGst <= 0) return null;
  const diff = Math.round((line.unitPriceExGst - rate.rateExGst) * 100) / 100;
  return {
    over: line.unitPriceExGst > rate.rateExGst * (1 + tol) + 0.005,
    diffPerUnit: diff,
    diffTotal: line.quantity != null ? Math.round(diff * line.quantity * 100) / 100 : null,
    outsideValidity: !validOn(rate, invoiceDate),
  };
}

// Reads the stored JSON lines, dropping anything malformed.
export function parseLines(json: string | null): InvoiceLine[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((l) => l && typeof l.description === "string" && l.description.trim()).map((l) => ({
          description: String(l.description), quantity: Number.isFinite(Number(l.quantity)) && l.quantity !== null ? Number(l.quantity) : null,
          unit: typeof l.unit === "string" ? l.unit : null, unitPriceExGst: Number.isFinite(Number(l.unitPriceExGst)) && l.unitPriceExGst !== null ? Number(l.unitPriceExGst) : null,
        }))
      : [];
  } catch { return []; }
}

// A reply from Estimating is used only if it's the contract we expect.
export function isRateSheet(v: unknown): v is RateSheet {
  const s = v as RateSheet;
  return !!s && s.schema_version === "rate-sheet.v1" && Array.isArray(s.rates) && s.rates.every((r) => typeof r?.id === "string" && typeof r.supplier === "string" && typeof r.item === "string" && typeof r.unit === "string" && typeof r.rateExGst === "number");
}
