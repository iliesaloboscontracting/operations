// Reading tool photos with Claude (19 Oct 2026). Two narrow jobs only:
//  1. readToolPhotos - from a rating-plate photo and a condition photo,
//     pull out brand / model / serial etc. and describe visible damage.
//  2. readToolboxPhotos - list the tools visible in a toolbox photo, with
//     any LOB tag or serial number that can actually be read.
// Claude only reports what it sees. It is never given the register, never
// matches tools to records and never saves anything: matching happens in
// plain code (lib/toolboxCheck.ts) and every reading is confirmed by a
// person before it is written. Photos sent here are tool photos only - no
// money, no personal details.
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { mediaTypeOf, readPhoto } from "./toolPhotos";

const MODEL = "claude-opus-5-5";

export class VisionNotConfigured extends Error {}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new VisionNotConfigured("Photo reading isn't set up - ANTHROPIC_API_KEY is missing from the server's environment.");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function imageBlock(fileName: string): Promise<Anthropic.Beta.BetaImageBlockParam> {
  const data = (await readPhoto(fileName)).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mediaTypeOf(fileName), data } };
}

// ---- 1. Registering a tool --------------------------------------------------

const PLATE_SCHEMA = {
  type: "object",
  properties: {
    toolType: { type: "string", description: "What the tool is in plain words, e.g. 'Cordless hammer drill driver'. Empty if unsure." },
    brand: { type: "string", description: "Brand as printed, e.g. 'Hilti'. Empty if not visible." },
    model: { type: "string", description: "Model as printed, e.g. 'SF 6H-22'. Empty if not visible." },
    serialNumber: { type: "string", description: "Serial number exactly as printed. Empty if not clearly readable - never guess digits." },
    itemNo: { type: "string", description: "Manufacturer item / part number (Hilti calls it FFE or Item no.). Empty if none." },
    manufactured: { type: "string", description: "Manufacture date as printed, e.g. '06/2026'. Empty if none." },
    specs: { type: "string", description: "Key ratings from the plate in one short line (voltage, speed, capacity). Empty if none." },
    uncertainFields: {
      type: "array",
      items: { type: "string", enum: ["toolType", "brand", "model", "serialNumber", "itemNo", "manufactured"] },
      description: "Fields you filled in but could not read with full confidence (blur, glare, partly hidden).",
    },
    conditionSuggestion: {
      type: "string",
      enum: ["New", "Good", "Needs repair", "Unclear"],
      description: "From the condition photo only. 'Needs repair' only for visible damage that affects use or safety.",
    },
    damage: { type: "string", description: "Visible damage or wear on the condition photo, briefly (cracked housing, frayed lead, missing guard...). Empty if none seen." },
  },
  required: ["toolType", "brand", "model", "serialNumber", "itemNo", "manufactured", "specs", "uncertainFields", "conditionSuggestion", "damage"],
  additionalProperties: false,
} as const;

const PLATE_SYSTEM = `You read photos of power tools for a demolition company's tool register.
You get up to two photos: first the tool's rating plate (label with brand, model, serial number), then the whole tool showing its condition.
Copy text exactly as printed on the plate. Never invent or complete a serial number: if any character is unreadable, leave serialNumber empty and say so in uncertainFields.
For condition, describe only what is visible in the photo. Do not assume hidden damage.`;

export type PlateReading = {
  toolType: string;
  brand: string;
  model: string;
  serialNumber: string;
  itemNo: string;
  manufactured: string;
  specs: string;
  uncertainFields: string[];
  conditionSuggestion: "New" | "Good" | "Needs repair" | "Unclear";
  damage: string;
};

export async function readToolPhotos(plateFile: string | null, conditionFile: string | null): Promise<PlateReading> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (plateFile) content.push({ type: "text", text: "Photo 1 - rating plate:" }, await imageBlock(plateFile));
  if (conditionFile) content.push({ type: "text", text: "Photo 2 - whole tool / condition:" }, await imageBlock(conditionFile));
  content.push({ type: "text", text: "Read these photos for the tool register." });

  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: PLATE_SYSTEM,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(PLATE_SCHEMA) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("The photos couldn't be read - fill the details in by hand.");
  }
  return response.parsed_output as PlateReading;
}

// ---- 2. Checking a toolbox --------------------------------------------------

const TOOLBOX_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "One entry per physical tool visible across all photos (count a tool once even if it appears in two photos).",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "What the tool is, e.g. 'Hilti cordless hammer drill'" },
          brand: { type: "string", description: "Empty if not visible." },
          model: { type: "string", description: "Empty if not visible." },
          lobTag: { type: "string", description: "A Lobos asset tag read off a sticker/label, formatted like 'LOB-0012'. Empty if no tag is readable." },
          serialNumber: { type: "string", description: "Serial number only if a plate is visible and every character is readable. Otherwise empty." },
        },
        required: ["description", "brand", "model", "lobTag", "serialNumber"],
        additionalProperties: false,
      },
    },
    notes: { type: "string", description: "Anything that limits the check (tools stacked, labels facing away, blurry). Empty if none." },
  },
  required: ["items", "notes"],
  additionalProperties: false,
} as const;

const TOOLBOX_SYSTEM = `You list the power tools visible in photos of a demolition supervisor's toolbox, laid out for a check.
Report only what you can see. Read Lobos asset tags (LOB-####) and serial numbers only when every character is clear - never guess or complete them.
Do not list consumables (bits, blades, screws), cases, chargers or batteries unless they carry a LOB tag.`;

export type ToolboxReading = {
  items: { description: string; brand: string; model: string; lobTag: string; serialNumber: string }[];
  notes: string;
};

export async function readToolboxPhotos(files: string[]): Promise<ToolboxReading> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [i, f] of files.entries()) content.push({ type: "text", text: `Photo ${i + 1}:` }, await imageBlock(f));
  content.push({ type: "text", text: "List the tools in this toolbox." });

  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: TOOLBOX_SYSTEM,
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(TOOLBOX_SCHEMA) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("The toolbox photos couldn't be read - try clearer photos with the tools spread out.");
  }
  return response.parsed_output as ToolboxReading;
}
