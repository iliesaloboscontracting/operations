// Reading receipt photos with Claude (Receipts R2, 26 Oct 2026; Ilies approved Claude reading every
// photo) - the sixth outbound connection, built like lib/invoiceReading.ts. Claude only reads what's
// printed; whether a reading goes in (READ) or waits for a person (CHECK) is decided in plain code
// (./checks.ts). What's sent: the photo(s), plus only our truck regos and the tip-site names already
// seen on dockets. No rates, no costs, no other data. Kill switch: RECEIPT_READING=off (./runner.ts).
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { ReadingNotConfigured } from "../invoiceReading";

const MODEL = "claude-opus-5-5";

export type Photo = { data: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" };
export type ReadContext = { regos: string[]; tipSites: string[] };

// Every value comes back as printed text ("" when not shown); ./checks.ts turns it into numbers and dates.
export type TipReading = {
  documentType: "tip_docket" | "weighbridge_ticket" | "fuel_receipt" | "other";
  docketNo: string; dateTime: string; tipSite: string; wasteType: string; tonnesNet: string; rego: string;
  priceExGst: string; priceIncGst: string; unclear: string[]; note: string;
};
export type FuelReading = {
  documentType: "fuel_receipt" | "tip_docket" | "other";
  litres: string; pricePerLitre: string; total: string; station: string; dateTime: string; rego: string; unclear: string[]; note: string;
};
// An own-money purchase (tools, materials, parking...) - reimbursements from the phone.
export type PurchaseReading = {
  documentType: "receipt" | "tax_invoice" | "fuel_receipt" | "tip_docket" | "other";
  supplier: string; receiptNo: string; dateTime: string; total: string; gst: string; unclear: string[]; note: string;
};
export type OdometerReadingResult = { km: string; unclear: boolean; note: string };

// The reader the runner uses; a test passes its own.
export type Reader = {
  tip: (photos: Photo[], ctx: ReadContext) => Promise<TipReading>;
  fuel: (photos: Photo[], ctx: ReadContext) => Promise<FuelReading>;
  purchase: (photos: Photo[]) => Promise<PurchaseReading>;
  odometer: (photo: Photo) => Promise<OdometerReadingResult>;
};

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new ReadingNotConfigured("Receipt reading isn't set up - ANTHROPIC_API_KEY is missing from the server's environment.");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function parse<T>(system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: object): Promise<T> {
  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(schema as never) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("The photo couldn't be read.");
  return response.parsed_output as T;
}

const S = (description: string) => ({ type: "string", description });
const images = (photos: Photo[]): Anthropic.Beta.BetaContentBlockParam[] =>
  photos.map((p) => ({ type: "image", source: { type: "base64", media_type: p.mime, data: p.data.toString("base64") } }));
const COMMON = `Copy what is printed exactly; never guess. Leave a field "" when it isn't on the photo, and list in "unclear" any field you could only partly read.`;
const known = (ctx: ReadContext) =>
  `Lobos truck regos: ${ctx.regos.join(", ") || "(none)"}.\nTip sites seen before: ${ctx.tipSites.join("; ") || "(none yet)"} - use the same spelling when it's clearly the same site.`;

const TIP_FIELDS = ["docketNo", "dateTime", "tipSite", "wasteType", "tonnesNet", "rego", "priceExGst", "priceIncGst"];
const TIP_SCHEMA = {
  type: "object",
  properties: {
    documentType: { type: "string", enum: ["tip_docket", "weighbridge_ticket", "fuel_receipt", "other"] },
    docketNo: S("Docket / ticket number exactly as printed."),
    dateTime: S("Date and time on the docket as YYYY-MM-DDTHH:MM (date only as YYYY-MM-DD if no time). Australian dates are day/month."),
    tipSite: S("The tip / transfer station / recycling facility name."),
    wasteType: S("Waste type or material as printed, e.g. 'Mixed C&D', 'Asbestos - bonded', 'VENM'."),
    tonnesNet: S("Net weight in tonnes as plain digits, e.g. '6.24' (convert kg to tonnes). If only gross and tare are shown, gross minus tare."),
    rego: S("Truck registration as printed, letters and digits only."),
    priceExGst: S("Charge excluding GST as plain digits, if printed."),
    priceIncGst: S("Charge including GST as plain digits, if printed."),
    unclear: { type: "array", items: { type: "string", enum: TIP_FIELDS } },
    note: S("One short line if something is odd (e.g. two dockets in one photo, not a docket). Otherwise empty."),
  },
  required: ["documentType", ...TIP_FIELDS, "unclear", "note"],
  additionalProperties: false,
} as const;

const FUEL_FIELDS = ["litres", "pricePerLitre", "total", "station", "dateTime", "rego"];
const FUEL_SCHEMA = {
  type: "object",
  properties: {
    documentType: { type: "string", enum: ["fuel_receipt", "tip_docket", "other"] },
    litres: S("Litres of fuel as plain digits, e.g. '182.40'."),
    pricePerLitre: S("Price per litre in dollars as plain digits, e.g. '2.159' (convert cents to dollars)."),
    total: S("Total paid for the fuel including GST as plain digits."),
    station: S("Service station name and suburb."),
    dateTime: S("Date and time as YYYY-MM-DDTHH:MM. Australian dates are day/month."),
    rego: S("Vehicle registration if printed (some fleet cards print it), letters and digits only."),
    unclear: { type: "array", items: { type: "string", enum: FUEL_FIELDS } },
    note: S("One short line if something is odd. Otherwise empty."),
  },
  required: ["documentType", ...FUEL_FIELDS, "unclear", "note"],
  additionalProperties: false,
} as const;

const PURCHASE_FIELDS = ["supplier", "receiptNo", "dateTime", "total", "gst"];
const PURCHASE_SCHEMA = {
  type: "object",
  properties: {
    documentType: { type: "string", enum: ["receipt", "tax_invoice", "fuel_receipt", "tip_docket", "other"] },
    supplier: S("The shop / business that issued it."),
    receiptNo: S("Receipt, invoice or transaction number as printed."),
    dateTime: S("Date (and time if shown) as YYYY-MM-DD or YYYY-MM-DDTHH:MM."),
    total: S("The total paid, including GST, as plain digits, e.g. '84.50'."),
    gst: S("The GST amount as plain digits, if shown."),
    unclear: { type: "array", items: { type: "string", enum: PURCHASE_FIELDS } },
    note: S("One short line if something is odd (e.g. cut off, two receipts in one photo). Otherwise empty."),
  },
  required: ["documentType", ...PURCHASE_FIELDS, "unclear", "note"],
  additionalProperties: false,
} as const;

const ODO_SCHEMA = {
  type: "object",
  properties: {
    km: S("The odometer reading in whole kilometres as plain digits (not the trip meter)."),
    unclear: { type: "boolean", description: "True if the digits can't all be read clearly." },
    note: S("One short line if something is odd (e.g. trip meter only, glare). Otherwise empty."),
  },
  required: ["km", "unclear", "note"],
  additionalProperties: false,
} as const;

export const claudeReader: Reader = {
  tip: (photos, ctx) =>
    parse<TipReading>(
      `You read tip dockets and weighbridge tickets for Lobos Contracting, a Sydney demolition contractor, so the loads can be tracked against the job. ${COMMON}`,
      [...images(photos), { type: "text", text: `${known(ctx)}\n\nRead this tip docket${photos.length > 1 ? " (the photos are parts of the same docket)" : ""}.` }],
      TIP_SCHEMA,
    ),
  fuel: (photos, ctx) =>
    parse<FuelReading>(
      `You read fuel receipts for Lobos Contracting's trucks so fuel use can be tracked per truck. ${COMMON}`,
      [...images(photos), { type: "text", text: `${known(ctx)}\n\nRead this fuel receipt.` }],
      FUEL_SCHEMA,
    ),
  purchase: (photos) =>
    parse<PurchaseReading>(
      `You read shop receipts that Lobos Contracting's workers paid for themselves, so accounts can pay them back. ${COMMON}`,
      [...images(photos), { type: "text", text: "Read this receipt." }],
      PURCHASE_SCHEMA,
    ),
  odometer: (photo) =>
    parse<OdometerReadingResult>(
      `You read truck odometers from a photo of the dashboard. Give the total odometer, not a trip meter. Never guess a digit.`,
      [...images([photo]), { type: "text", text: "Read the odometer." }],
      ODO_SCHEMA,
    ),
};
