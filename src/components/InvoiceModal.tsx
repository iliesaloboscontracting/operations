"use client";

// Add or correct a supplier invoice on Project Tracking (24 Oct 2026). A plant
// hire invoice can be linked to the project's hire-register item and the days
// it covers - Tracking then stops estimating those days, so the invoice
// replaces the estimate instead of being added on top of it. A tip invoice can list the docket
// numbers it bills (Receipts R3) - those dockets' estimates stop, the invoice replaces them.
import FormModal, { type FieldDef } from "./FormModal";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { HireItemCostDTO, InvoicedCostDTO } from "@/lib/types";

const CATEGORY_OPTIONS = [
  { value: "PLANT_HIRE", label: "Plant hire" },
  { value: "LABOUR_HIRE", label: "Labour hire" },
  { value: "TIP_FEES", label: "Tip fees" },
  { value: "MATERIALS", label: "Materials" },
];

export default function InvoiceModal({
  projectId,
  projectName,
  hireItems,
  invoice,
  canDelete,
  onClose,
  onSaved,
}: {
  projectId: string;
  projectName: string;
  hireItems: HireItemCostDTO[];
  invoice: InvoicedCostDTO | null; // null = adding a new one
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields: FieldDef[] = [
    { key: "category", label: "For", type: "select", options: CATEGORY_OPTIONS, required: true },
    { key: "vendor", label: "Supplier", required: true, placeholder: "e.g. Allcott Hire" },
    { key: "invoiceNo", label: "Invoice no." },
    { key: "weekEnding", label: "Invoice date", type: "date", required: true },
    { key: "amountExGst", label: "Amount ex GST", type: "number", required: true, placeholder: "minus for a credit note" },
    { key: "gst", label: "GST", type: "number", placeholder: "blank = 10%" },
    {
      key: "hireResourceId",
      label: "Bills this hire item",
      type: "select",
      section: "Plant hire - replaces the estimate",
      options: [{ value: "", label: hireItems.length ? "None" : "No hire items on this project" }, ...hireItems.map((h) => ({ value: h.id, label: `${h.name}${h.supplier ? ` · ${h.supplier}` : ""}` }))],
      full: true,
    },
    { key: "periodFrom", label: "Period from", type: "date", section: "Plant hire - replaces the estimate" },
    { key: "periodTo", label: "Period to", type: "date", section: "Plant hire - replaces the estimate" },
    { key: "docketNos", label: "Docket numbers on the invoice", section: "Tip fees - replaces the dockets' estimate", placeholder: "e.g. A123, A124 - blank matches by tip, job and dates", full: true },
    { key: "notes", label: "Notes", type: "textarea", placeholder: "What it's for, where the invoice is kept" },
  ];

  const initial = invoice
    ? {
        category: invoice.category, vendor: invoice.vendor, invoiceNo: invoice.invoiceNo ?? "", weekEnding: invoice.weekEnding,
        amountExGst: invoice.amountExGst, gst: invoice.gst, hireResourceId: invoice.hireResourceId ?? "",
        periodFrom: invoice.periodFrom ?? "", periodTo: invoice.periodTo ?? "", notes: invoice.notes ?? "", docketNos: (invoice.docketNos ?? []).join(", "),
      }
    : { category: "PLANT_HIRE", vendor: "", invoiceNo: "", weekEnding: "", amountExGst: "", gst: "", hireResourceId: "", periodFrom: "", periodTo: "", notes: "", docketNos: "" };

  async function save(values: Record<string, any>) {
    const res = await apiFetch(invoice ? `/api/invoiced-costs/${invoice.id}` : "/api/invoiced-costs", {
      method: invoice ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, projectId }),
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save the invoice"));
    onSaved();
  }

  async function remove() {
    const res = await apiFetch(`/api/invoiced-costs/${invoice!.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't delete the invoice"));
    onSaved();
  }

  return (
    <FormModal
      title={`${invoice ? "Invoice" : "Add invoice"} · ${projectName}`}
      fields={fields}
      initial={initial}
      onSave={save}
      onClose={onClose}
      onDelete={invoice && canDelete ? remove : undefined}
      deleteLabel="Delete"
      submitLabel={invoice ? "Save" : "Add invoice"}
    />
  );
}
