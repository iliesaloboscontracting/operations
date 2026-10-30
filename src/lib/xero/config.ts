// Xero exports - the settings in one place (G2, 25 Oct 2026). The readers
// find columns by their header text, so a different Xero export layout only
// needs a name added here. Header matching ignores case, spaces and
// punctuation ("Invoice Number" = "InvoiceNumber" = "invoice_number").
// FINALISE when accounts' real sample exports arrive (lead, 25 Oct 2026) -
// the defaults below follow Xero's standard sales-invoice / bill export
// (one row per line item) and its Profit and Loss report.
// No server imports.

export const XERO_CONFIG = {
  // Option A: the tracking category accounts tag jobs with. Its option is
  // matched to a project's job number, quote number or name.
  jobTrackingCategory: "Job",
  // Option B: a job / quote number in the reference or line description.
  jobNumberPattern: /\b(\d{2}_\d{3,4}(?:-[A-Z])?)\b/g,
  // Statuses whose amounts don't count (kept in the mirror all the same).
  ignoredStatuses: ["VOIDED", "VOID", "DELETED", "DRAFT"],
  // Australian financial year starts 1 July.
  financialYearStartMonth: 7,
  // Where the live read starts (stage 4 of "Claimed", Ilies 30 Oct 2026): a fixed date, so history no longer drops
  // off every 1 July. The same read-only endpoints and scopes - only more pages as the years add up.
  mirrorFrom: "2025-07-01",
};

// field -> header names it may appear under (first match wins)
export const INVOICE_COLUMNS = {
  contact: ["ContactName", "Contact", "Customer", "Supplier", "To", "From", "Name"],
  number: ["InvoiceNumber", "Invoice Number", "Number", "Invoice No", "Invoice #", "Bill Number", "Credit Note Number"],
  reference: ["Reference", "Ref", "Your Reference"],
  date: ["InvoiceDate", "Invoice Date", "Date"],
  dueDate: ["DueDate", "Due Date"],
  total: ["Total", "Invoice Total", "Gross", "Total (inc GST)"],
  taxTotal: ["TaxTotal", "Tax Total", "Total GST", "GST"],
  paid: ["InvoiceAmountPaid", "Amount Paid", "Paid"],
  due: ["InvoiceAmountDue", "Amount Due", "Due", "Balance", "Outstanding"],
  type: ["Type", "Invoice Type", "Document Type"],
  status: ["Status", "Invoice Status"],
  description: ["Description", "Line Description", "Item Description"],
  lineAmount: ["LineAmount", "Line Amount", "Amount"],
  lineTax: ["TaxAmount", "Tax Amount", "Line Tax"],
  accountCode: ["AccountCode", "Account Code", "Account"],
  tracking1Name: ["TrackingName1", "Tracking Name 1", "Tracking Category 1"],
  tracking1Option: ["TrackingOption1", "Tracking Option 1"],
  tracking2Name: ["TrackingName2", "Tracking Name 2", "Tracking Category 2"],
  tracking2Option: ["TrackingOption2", "Tracking Option 2"],
} as const;
export type InvoiceField = keyof typeof INVOICE_COLUMNS;
// Without these a file isn't read as an invoice export.
export const INVOICE_REQUIRED: InvoiceField[] = ["contact", "number", "date", "total"];

// P&L summary rows (kept, but marked "Summary" so nothing re-adds them).
export const PNL_SUMMARY = /^(total\b|gross profit|net profit|operating profit|net loss|profit before|profit after)/i;
