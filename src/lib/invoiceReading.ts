// Reading supplier invoices with Claude (24 Oct 2026) - three narrow jobs:
//  1. readInvoiceDocument - pull the invoice details out of a PDF or photo.
//  2. mapSheetColumns - say which spreadsheet column holds which detail.
//  3. matchInvoiceRows - suggest the Operations job and cost type per invoice.
// Claude only reads and suggests. Whether an invoice goes onto a job is
// decided in plain code (lib/invoiceInbox.ts), and anything unclear waits for
// a person. What's sent: the invoice file or rows, and the job list (names,
// job numbers, clients, addresses) - no pay rates, no other costs.
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";

const MODEL = "claude-opus-5-5";

export class ReadingNotConfigured extends Error {}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ReadingNotConfigured("Invoice reading isn't set up - ANTHROPIC_API_KEY is missing from the server's environment.");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export type JobForMatching = { id: string; name: string; jobNo: string | null; quoteNo: string | null; client: string | null; address: string | null; status: string };
export const CATEGORIES = ["PLANT_HIRE", "LABOUR_HIRE", "TIP_FEES", "MATERIALS", "OTHER"] as const;

const jobList = (jobs: JobForMatching[]) =>
  jobs.map((j) => `${j.id} | ${j.name}${j.jobNo ? ` | job no ${j.jobNo}` : ""}${j.quoteNo ? ` | quote no ${j.quoteNo}` : ""}${j.client ? ` | client ${j.client}` : ""}${j.address ? ` | ${j.address}` : ""} | ${j.status}`).join("\n");

const CATEGORY_HELP = `Cost types:
- PLANT_HIRE: hired machines, equipment, tools, lifts, scaffold, hire trucks with or without operator, and their delivery/pick-up/damage charges.
- LABOUR_HIRE: workers supplied by a labour agency.
- TIP_FEES: tipping, waste disposal, bins, recycling-centre dockets.
- MATERIALS: things bought (Bunnings, tool shops, consumables, fuel bought for a job).
- OTHER: anything else (subcontractors, services, fees) - a person will decide.`;

const MATCH_HELP = `Matching to a job: the site may be written as an address, suburb, building or client name (e.g. "Myer 436 George" is the job "Myers"; "Mascot - Airgate" is "Airgate"). Use the job list only - never invent an id.
confidence "high" only when the site clearly names one job in the list. "low" when it might be a job but you're unsure (e.g. only a suburb shared by two jobs). "none" when no job fits (a site that isn't in the list) - leave projectId empty.`;

async function parse<T>(system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: object): Promise<T> {
  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000, // above this the SDK insists on streaming
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(schema as never) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("The file couldn't be read.");
  return response.parsed_output as T;
}

// ---- 1. An invoice PDF or photo ---------------------------------------------

const S = (description: string) => ({ type: "string", description });
const DOC_SCHEMA = {
  type: "object",
  properties: {
    invoices: {
      type: "array",
      description: "One entry per invoice / credit note in the file (usually one).",
      items: {
        type: "object",
        properties: {
          documentType: { type: "string", enum: ["invoice", "credit_note", "statement", "quote", "receipt", "other"] },
          supplier: S("Supplier / company that issued it, e.g. 'Allcott Hire'."),
          entityBilled: S("Who it's billed to, e.g. 'Lobos Contracting Pty Ltd' or 'Lobos Civil'. Empty if not shown."),
          invoiceNo: S("Invoice or credit note number exactly as printed. Empty if none."),
          invoiceDate: S("Invoice date as YYYY-MM-DD. Empty if not shown."),
          periodFrom: S("Hire / service period start as YYYY-MM-DD. Empty if none."),
          periodTo: S("Hire / service period end as YYYY-MM-DD. Empty if none."),
          description: S("What was supplied, one short line (machine, items, loads)."),
          siteText: S("The site / delivery address / job reference / PO as written. Empty if none."),
          hireRef: S("Supplier's hire contract / rental agreement number. Empty if none."),
          amountExGst: S("Total excluding GST as plain digits, e.g. '1234.50'. Negative for a credit note. Empty if not shown."),
          gst: S("GST amount as plain digits. Empty if not shown."),
          totalIncGst: S("Total including GST as plain digits. Empty if not shown."),
          category: { type: "string", enum: [...CATEGORIES] },
          docketNos: { type: "array", items: { type: "string" }, description: "Tip / weighbridge docket numbers listed on a tip-fees invoice, exactly as printed. Empty for anything else." },
          // Accounts stage 4: ABN workers' hours, and line prices for the agreed-rate check.
          supplierAbn: S("The supplier's ABN as printed (11 digits). Empty if none."),
          workDays: { type: "array", description: "Only for an invoice from a person billing their own hours: each date worked (YYYY-MM-DD) and the hours that day, as printed. Empty for anything else.", items: { type: "object", properties: { date: S("YYYY-MM-DD"), hours: S("Hours as plain digits, e.g. '7.5'.") }, required: ["date", "hours"], additionalProperties: false } },
          hoursTotal: S("Total hours billed as plain digits, if the invoice bills hours. Empty if not."),
          lines: { type: "array", description: "Each priced line on the invoice, as printed. Empty if it has no line items.", items: { type: "object", properties: { description: S("The line's description."), quantity: S("Quantity as plain digits, or empty."), unit: S("Unit as printed, e.g. 'day', 'week', 'hr', 'tonne', 'each'. Empty if none."), unitPriceExGst: S("Unit price excluding GST as plain digits, or empty.") }, required: ["description", "quantity", "unit", "unitPriceExGst"], additionalProperties: false } },
          projectId: S("Id of the matching job from the list, or empty."),
          confidence: { type: "string", enum: ["high", "low", "none"] },
          reason: S("One short line: why this job (or why none)."),
        },
        required: ["documentType", "supplier", "entityBilled", "invoiceNo", "invoiceDate", "periodFrom", "periodTo", "description", "siteText", "hireRef", "amountExGst", "gst", "totalIncGst", "category", "docketNos", "supplierAbn", "workDays", "hoursTotal", "lines", "projectId", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["invoices"],
  additionalProperties: false,
} as const;

export type ReadInvoice = {
  documentType: "invoice" | "credit_note" | "statement" | "quote" | "receipt" | "other";
  supplier: string; entityBilled: string; invoiceNo: string; invoiceDate: string; periodFrom: string; periodTo: string;
  description: string; siteText: string; hireRef: string; amountExGst: string; gst: string; totalIncGst: string;
  category: (typeof CATEGORIES)[number]; projectId: string; confidence: "high" | "low" | "none"; reason: string;
  docketNos?: string[]; // tip fees: the dockets it bills (Receipts R3)
  // Accounts stage 4 (empty when not printed)
  supplierAbn?: string; workDays?: { date: string; hours: string }[]; hoursTotal?: string;
  lines?: { description: string; quantity: string; unit: string; unitPriceExGst: string }[];
};

export async function readInvoiceDocument(file: Buffer, mime: string, jobs: JobForMatching[]): Promise<ReadInvoice[]> {
  const data = file.toString("base64");
  const doc: Anthropic.Beta.BetaContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp", data } };
  const out = await parse<{ invoices: ReadInvoice[] }>(
    `You read supplier invoices for Lobos Contracting, a Sydney demolition contractor, so their cost can be put against the right job.
Copy numbers and dates exactly as printed; never guess a figure - leave it empty if it isn't readable.
${CATEGORY_HELP}
${MATCH_HELP}`,
    [doc, { type: "text", text: `The jobs in Operations (id | name | details | status):\n${jobList(jobs)}\n\nRead the invoice(s) in this file.` }],
    DOC_SCHEMA,
  );
  return out.invoices;
}

// ---- 2. Which spreadsheet column is which -----------------------------------

export const SHEET_FIELDS = ["supplier", "entityBilled", "invoiceNo", "invoiceDate", "siteText", "description", "periodFrom", "periodTo", "amountExGst", "gst", "totalIncGst", "hireRef", "notes"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

export async function mapSheetColumns(headers: string[], samples: Record<string, string>[]): Promise<Record<SheetField, string>> {
  const schema = {
    type: "object",
    properties: Object.fromEntries(SHEET_FIELDS.map((f) => [f, { type: "string", enum: ["", ...headers] }])),
    required: [...SHEET_FIELDS],
    additionalProperties: false,
  };
  return parse<Record<SheetField, string>>(
    `You map the columns of a supplier-invoice register spreadsheet to invoice details. For each detail pick the one column that holds it, or "" if no column does.
siteText = the site / job / delivery address column (prefer a site or folder name over a long address if both exist). amountExGst = the amount excluding GST. notes = a free-text notes column.`,
    [{ type: "text", text: `Columns: ${JSON.stringify(headers)}\nFirst rows: ${JSON.stringify(samples)}` }],
    schema,
  );
}

// ---- 3. Job and cost type for each invoice row ------------------------------

export type RowToMatch = { id: string; supplier: string; siteText: string; description: string; knownJob?: string };
export type RowMatch = { id: string; projectId: string; confidence: "high" | "low" | "none"; category: (typeof CATEGORIES)[number]; reason: string };

export async function matchInvoiceRows(rows: RowToMatch[], jobs: JobForMatching[]): Promise<RowMatch[]> {
  const schema = {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: S("The row id given."),
            projectId: S("Id of the matching job from the list, or empty."),
            confidence: { type: "string", enum: ["high", "low", "none"] },
            category: { type: "string", enum: [...CATEGORIES] },
            reason: S("One short line."),
          },
          required: ["id", "projectId", "confidence", "category", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["matches"],
    additionalProperties: false,
  };
  const out = await parse<{ matches: RowMatch[] }>(
    `You match supplier-invoice rows from Lobos Contracting's accounts register to jobs in their Operations app, and give each a cost type. Answer for every row id given.
A row with knownJob was already matched by a person - use that job id with confidence "high" unless the row clearly contradicts it.
${CATEGORY_HELP}
${MATCH_HELP}`,
    [{ type: "text", text: `Jobs (id | name | details | status):\n${jobList(jobs)}\n\nRows:\n${JSON.stringify(rows)}` }],
    schema,
  );
  return out.matches;
}
