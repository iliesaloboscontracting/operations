// Reading Xero exports into plain rows (G2, 25 Oct 2026): the sales-invoice
// / bill export (one row per line item, or one per invoice) and the Profit
// and Loss report. Input is the raw sheet grid (lib/invoiceSheet.ts
// readSheetGrids); columns are found by header text (config.ts). A file
// that doesn't look like the export is refused with a plain reason, never
// half-read. Plain functions, no server imports; `npm test` (xero.test.ts).
import { INVOICE_COLUMNS, INVOICE_REQUIRED, PNL_SUMMARY, type InvoiceField } from "./config";

export type InvoiceType = "SALE" | "SALE_CREDIT" | "BILL" | "BILL_CREDIT";

export interface ReadLine {
  description: string | null;
  amountExGst: number;
  accountCode: string | null;
  tracking1: string | null; // "Job: 26_168"
  tracking2: string | null;
}
export interface ReadInvoice {
  type: InvoiceType;
  number: string;
  reference: string | null;
  contact: string;
  date: string;
  dueDate: string | null;
  status: string;
  totalExGst: number;
  gst: number | null;
  amountPaid: number | null;
  amountDue: number | null;
  lines: ReadLine[];
}
export interface ReadPnlLine { month: string; section: string; account: string; amount: number }

// ---------- small parsers (Xero writes "25 Oct 2026", "25/10/2026", "(1,234.00)") ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function num(v: string | null | undefined): number | null {
  const t = (v ?? "").replace(/[$,\s]/g, "");
  if (!t || t === "-") return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[()-]/g, ""));
  return Number.isFinite(n) ? Math.round((neg ? -n : n) * 100) / 100 : null;
}

export function day(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})$/.exec(t);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    if (mo >= 0) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

// "Sep 2026", "Sep-26", "September 2026", "30 Sep 2026", "2026-09" -> "2026-09"
export function month(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  let m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(?:\d{1,2}\s+)?([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(mo + 1).padStart(2, "0")}`;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, "");

// ---------- invoice / bill export ----------

export function findHeader(grid: string[][], required = INVOICE_REQUIRED) {
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const cols = columnMap(grid[i]);
    if (required.every((f) => cols[f] != null)) return { at: i, cols };
  }
  return null;
}

export function columnMap(header: string[]): Partial<Record<InvoiceField, number>> {
  const at = header.map((h) => key(h ?? ""));
  const out: Partial<Record<InvoiceField, number>> = {};
  for (const [field, names] of Object.entries(INVOICE_COLUMNS) as [InvoiceField, readonly string[]][]) {
    for (const n of names) {
      const i = at.indexOf(key(n));
      if (i >= 0 && !Object.values(out).includes(i)) { out[field] = i; break; }
    }
  }
  return out;
}

const typeOf = (kind: "INVOICES" | "BILLS", text: string): InvoiceType => {
  const credit = /credit/i.test(text);
  return kind === "BILLS" ? (credit ? "BILL_CREDIT" : "BILL") : credit ? "SALE_CREDIT" : "SALE";
};

export function readInvoiceGrid(grid: string[][], kind: "INVOICES" | "BILLS"): { invoices: ReadInvoice[] } | { error: string } {
  const h = findHeader(grid);
  if (!h) {
    const missing = INVOICE_REQUIRED.filter((f) => !grid.slice(0, 20).some((r) => columnMap(r)[f] != null));
    return { error: `This doesn't look like a Xero ${kind === "BILLS" ? "bills" : "invoices"} export - no ${missing.join(", ")} column found.` };
  }
  const c = h.cols;
  const cell = (r: string[], f: InvoiceField) => (c[f] != null ? (r[c[f]!] ?? "").trim() : "");
  const groups = new Map<string, { rows: string[][] }>();
  for (const r of grid.slice(h.at + 1)) {
    const number = cell(r, "number");
    if (!number || !cell(r, "contact")) continue; // blank, notes or totals rows
    const k = `${cell(r, "type")}|${number}`;
    const g = groups.get(k) ?? { rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const out: ReadInvoice[] = [];
  for (const { rows } of groups.values()) {
    const r0 = rows[0];
    const date = day(cell(r0, "date"));
    const total = num(cell(r0, "total"));
    if (!date || total == null) continue;
    const tax = num(cell(r0, "taxTotal"));
    const totalExGst = Math.round((Math.abs(total) - Math.abs(tax ?? 0)) * 100) / 100;
    // Line amounts are inclusive or exclusive of GST depending on how the
    // invoice was raised: whichever way they add up to the total decides.
    // Signed (CLM-001): each line keeps its sign (a retention line is negative), times the sign of the document total -
    // a credit note exported with negative amounts comes out positive, and its type carries the sign (once).
    const sgn = total < 0 ? -1 : 1;
    const raw = rows.map((r) => ({ amount: num(cell(r, "lineAmount")), tax: num(cell(r, "lineTax")) ?? 0, r }));
    const sum = raw.reduce((n, x) => n + sgn * (x.amount ?? 0), 0);
    const inclusive = Math.abs(sum - Math.abs(total)) < Math.abs(sum - totalExGst);
    const track = (r: string[], n: "tracking1" | "tracking2") => {
      const name = cell(r, `${n}Name` as InvoiceField), opt = cell(r, `${n}Option` as InvoiceField);
      return opt ? (name ? `${name}: ${opt}` : opt) : null;
    };
    const lines: ReadLine[] = raw.some((x) => x.amount != null)
      ? raw.filter((x) => x.amount != null).map((x) => ({
          description: cell(x.r, "description") || null,
          amountExGst: Math.round(sgn * (x.amount! - (inclusive ? x.tax : 0)) * 100) / 100,
          accountCode: cell(x.r, "accountCode") || null,
          tracking1: track(x.r, "tracking1"), tracking2: track(x.r, "tracking2"),
        }))
      : [{ description: cell(r0, "description") || null, amountExGst: totalExGst, accountCode: null, tracking1: track(r0, "tracking1"), tracking2: track(r0, "tracking2") }];
    out.push({
      type: typeOf(kind, cell(r0, "type")),
      number: cell(r0, "number"),
      reference: cell(r0, "reference") || null,
      contact: cell(r0, "contact"),
      date,
      dueDate: day(cell(r0, "dueDate")),
      status: (cell(r0, "status") || "AUTHORISED").toUpperCase(),
      totalExGst,
      gst: tax == null ? null : Math.abs(tax),
      amountPaid: num(cell(r0, "paid")),
      amountDue: num(cell(r0, "due")),
      lines,
    });
  }
  if (!out.length) return { error: "No invoices found under the header row - is this the right export?" };
  return { invoices: out };
}

// ---------- Profit and Loss report ----------

// Header row = the first row with two or more month columns. Below it: a row
// with only a label is a section heading (Xero's own, e.g. "Less Cost of
// Sales"); a labelled row with amounts is an account, or a Summary row
// (Total ..., Gross Profit, Net Profit) kept as reported, never recomputed.
export function readPnlGrid(grid: string[][]): { lines: ReadPnlLine[]; months: string[] } | { error: string } {
  let at = -1;
  let cols: { i: number; month: string }[] = [];
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const found = grid[r].map((v, i) => ({ i, month: month(v) })).filter((x): x is { i: number; month: string } => x.month != null);
    // Two or more months, or a single month under a blank label column - so a
    // title row such as "30 September 2026" is never taken for the header.
    const isHeader = (found.length >= 2 || (found.length === 1 && !grid[r][0]?.trim() && found[0].i > 0)) && grid[r].filter(Boolean).length - found.length <= 1;
    if (isHeader) { at = r; cols = found; break; }
  }
  if (at < 0) return { error: "This doesn't look like a Xero Profit and Loss report - no row of month columns found." };
  const label = (row: string[]) => (row.find((v, i) => v && !cols.some((c) => c.i === i)) ?? "").trim();
  const lines: ReadPnlLine[] = [];
  let section = "";
  for (const row of grid.slice(at + 1)) {
    const name = label(row);
    if (!name) continue;
    const amounts = cols.map((c) => ({ month: c.month, amount: num(row[c.i]) }));
    if (amounts.every((a) => a.amount == null)) { section = name; continue; }
    const sec = PNL_SUMMARY.test(name) ? "Summary" : section || "Other";
    for (const a of amounts) if (a.amount != null) lines.push({ month: a.month, section: sec, account: name, amount: a.amount });
  }
  if (!lines.length) return { error: "No account lines found in the Profit and Loss report." };
  return { lines, months: [...new Set(cols.map((c) => c.month))].sort() };
}
