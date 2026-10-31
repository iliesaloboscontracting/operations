// Xero API answers -> the same rows the uploads produce (G3, 25 Oct 2026),
// so matching (match.ts), the mirror tables and the Directors tiles work the
// same whether the data came from accounts' upload or the live connection.
// Plain functions; `npm test` (live.test.ts).
import { readPnlGrid, type InvoiceType, type ReadInvoice } from "../readers";

type ApiLine = { Description?: string; LineAmount?: number; TaxAmount?: number; AccountCode?: string; Tracking?: { Name?: string; Option?: string }[] };
export type ApiInvoice = {
  InvoiceID?: string; CreditNoteID?: string; Type: string; InvoiceNumber?: string; CreditNoteNumber?: string; Reference?: string;
  Contact?: { Name?: string }; DateString?: string; DueDateString?: string; Status?: string; LineAmountTypes?: string;
  SubTotal?: number; TotalTax?: number; Total?: number; AmountDue?: number; AmountPaid?: number; RemainingCredit?: number;
  LineItems?: ApiLine[];
};

const TYPES: Record<string, InvoiceType> = { ACCREC: "SALE", ACCRECCREDIT: "SALE_CREDIT", ACCPAY: "BILL", ACCPAYCREDIT: "BILL_CREDIT" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

export function apiInvoiceToRead(i: ApiInvoice): (ReadInvoice & { xeroId: string | null }) | null {
  const type = TYPES[i.Type];
  const number = (i.InvoiceNumber ?? i.CreditNoteNumber ?? "").trim();
  const date = day(i.DateString);
  if (!type || !number || !date) return null;
  const tax = Math.abs(i.TotalTax ?? 0);
  const totalExGst = r2(Math.abs(i.SubTotal ?? (i.Total ?? 0) - tax));
  const inclusive = i.LineAmountTypes === "Inclusive";
  const lines = (i.LineItems ?? []).filter((l) => l.LineAmount != null).map((l) => {
    const t = (l.Tracking ?? []).map((x) => (x.Option ? (x.Name ? `${x.Name}: ${x.Option}` : x.Option) : null));
    return {
      description: l.Description?.trim() || null,
      // Signed (CLM-001): a retention or discount line is negative and must stay so - the lines then add up to the
      // SubTotal. API credit notes come with positive amounts; their type carries the sign.
      amountExGst: r2((l.LineAmount ?? 0) - (inclusive ? (l.TaxAmount ?? 0) : 0)),
      accountCode: l.AccountCode ?? null,
      tracking1: t[0] ?? null,
      tracking2: t[1] ?? null,
    };
  });
  const credit = type.endsWith("CREDIT");
  return {
    xeroId: i.InvoiceID ?? i.CreditNoteID ?? null,
    type, number, reference: i.Reference?.trim() || null, contact: i.Contact?.Name?.trim() || "Unknown contact",
    date, dueDate: day(i.DueDateString), status: (i.Status ?? "AUTHORISED").toUpperCase(),
    totalExGst, gst: tax, amountPaid: i.AmountPaid ?? null, amountDue: credit ? (i.RemainingCredit ?? null) : (i.AmountDue ?? null),
    lines: lines.length ? lines : [{ description: null, amountExGst: totalExGst, accountCode: null, tracking1: null, tracking2: null }],
  };
}

// Xero's Profit and Loss report (Reports/ProfitAndLoss) -> a grid like the
// exported spreadsheet, then the same reader the uploads use.
type ReportRow = { RowType: string; Title?: string; Cells?: { Value?: string }[]; Rows?: ReportRow[] };
export type ApiReport = { Reports?: { Rows?: ReportRow[] }[] };

export function reportToGrid(r: ApiReport): string[][] {
  const grid: string[][] = [];
  const walk = (rows: ReportRow[]) => {
    for (const row of rows) {
      if (row.RowType === "Section") {
        if (row.Title) grid.push([row.Title]);
        walk(row.Rows ?? []);
      } else grid.push((row.Cells ?? []).map((c) => (c.Value ?? "").trim()));
    }
  };
  walk(r.Reports?.[0]?.Rows ?? []);
  return grid;
}

export const readApiPnl = (r: ApiReport) => readPnlGrid(reportToGrid(r));
