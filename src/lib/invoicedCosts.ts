// Supplier invoices entered on Project Tracking (24 Oct 2026) - one set of
// rules for adding and correcting an InvoicedCost row, so Tracking never gets
// a duplicate, a hire invoice pointing at another project's item, or a
// period that ends before it starts.
import { prisma } from "./prisma";
import { isISODate } from "./dateRules";
import { docketNosOf, parseDocketNos } from "./receipts/tipCosts";
import { syncTipMatchesSoon } from "./receipts/tipStore";

export const INVOICE_CATEGORIES = ["PLANT_HIRE", "LABOUR_HIRE", "TIP_FEES", "MATERIALS"] as const;

export type InvoiceInput = {
  projectId: string;
  category: string;
  vendor: string;
  invoiceNo: string | null;
  weekEnding: string;
  amountExGst: number;
  gst: number;
  totalIncGst: number;
  notes: string | null;
  hireResourceId: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  docketNos: string | null; // tip fees (Receipts R3): JSON list of the docket numbers it bills
};

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
const round = (n: number) => Math.round(n * 100) / 100;

// Checks and normalises a submitted invoice. `existingId` is the row being
// corrected (left out of the duplicate check).
export async function readInvoice(body: Record<string, unknown>, existingId?: string): Promise<{ error: string } | { data: InvoiceInput }> {
  const projectId = text(body.projectId, 40);
  if (!projectId || !(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) return { error: "Pick the project." };
  const category = String(body.category ?? "");
  if (!(INVOICE_CATEGORIES as readonly string[]).includes(category)) return { error: "Pick what the invoice is for." };
  const vendor = text(body.vendor, 120);
  if (!vendor) return { error: "Enter the supplier." };
  const invoiceNo = text(body.invoiceNo, 60);
  const weekEnding = text(body.weekEnding, 10);
  if (!weekEnding || !isISODate(weekEnding)) return { error: "Enter the invoice date." };

  const ex = num(body.amountExGst);
  if (ex == null || !Number.isFinite(ex) || ex === 0 || Math.abs(ex) > 1_000_000) return { error: "Enter the amount ex GST (a credit note is a minus amount)." };
  const gstIn = num(body.gst);
  if (gstIn != null && (!Number.isFinite(gstIn) || Math.abs(gstIn) > Math.abs(ex))) return { error: "GST doesn't look right - leave it blank for 10%." };
  const gst = round(gstIn ?? ex * 0.1);

  let hireResourceId = text(body.hireResourceId, 40);
  const periodFrom = text(body.periodFrom, 10);
  const periodTo = text(body.periodTo, 10);
  if (category !== "PLANT_HIRE") hireResourceId = null;
  if (hireResourceId) {
    const item = await prisma.resource.findUnique({ where: { id: hireResourceId }, select: { type: true, category: true, hireProjectId: true } });
    if (!item || item.type !== "HIRE" || item.category === "LABOUR" || item.hireProjectId !== projectId) {
      return { error: "That hire item isn't on this project's hire register." };
    }
    if (!periodFrom || !periodTo) return { error: "Enter the hire period the invoice covers, so its estimate stops for those days." };
  }
  if (!periodFrom !== !periodTo) return { error: "Enter both dates of the period, or neither." };
  if (periodFrom && !isISODate(periodFrom)) return { error: "Period from must be a real date." };
  if (periodTo && !isISODate(periodTo)) return { error: "Period to must be a real date." };
  if (periodFrom && periodTo && periodTo < periodFrom) return { error: "The period ends before it starts." };

  // Tip invoices: the docket numbers printed on it, so it replaces exactly those dockets' estimates
  // (a typed list "A123, A124", or the stored JSON when a correction doesn't touch it).
  const raw = typeof body.docketNos === "string" && body.docketNos.trim().startsWith("[") ? docketNosOf(body.docketNos) : body.docketNos;
  const nos = category === "TIP_FEES" ? parseDocketNos(raw) : [];

  if (invoiceNo) {
    const dup = await prisma.invoicedCost.findFirst({
      where: { projectId, invoiceNo, vendor, ...(existingId ? { id: { not: existingId } } : {}) },
      select: { id: true },
    });
    if (dup) return { error: `${vendor} invoice ${invoiceNo} is already entered on this project.` };
  }

  return {
    data: {
      projectId, category, vendor, invoiceNo, weekEnding,
      amountExGst: round(ex), gst, totalIncGst: round(ex + gst),
      notes: text(body.notes, 1000), hireResourceId, periodFrom, periodTo, docketNos: nos.length ? JSON.stringify(nos) : null,
    },
  };
}

// Remove an invoice entered by mistake (Admin only - it takes real cost off a project): DELETE
// /api/invoiced-costs/:id and an approved "Remove supplier invoice" change (lib/changes) both come here.
// A hire invoice's days go back to the hire estimate by themselves (hireEstimate reads the invoices that
// are there); a tip invoice's dockets are re-matched, so they count as estimates again.
export async function removeInvoicedCost(id: string): Promise<{ ok: true } | { error: string; status: number }> {
  const existing = await prisma.invoicedCost.findUnique({ where: { id }, select: { id: true, category: true } });
  if (!existing) return { error: "not found", status: 404 };
  await prisma.invoicedCost.delete({ where: { id: existing.id } });
  if (existing.category === "TIP_FEES") syncTipMatchesSoon();
  return { ok: true };
}
