// Admin change kinds (28 Oct 2026; design docs/lci/ADMIN-CHANGE-KINDS-DESIGN.md) - the plain rules:
// what each kind's proposed value looks like, when it's "no change", which part of the "before" the
// approval re-checks, and how before / after read on the card. Rates and amounts here are only ever
// shown to Admins (and Operations AI, its own proposals) - ./rules.ts decides who sees a proposal.
// No server imports; `npm test` (adminKinds.test.ts). The server half (read, apply) is ./adminStore.ts.
import { normName } from "../receipts/tipCosts";
import { documentKindLabel, isDocumentKind, isIsoDate, isTicketKind, looksLikeTfnOrBank, ticketKindLabel } from "../compliance/rules";
import { assetKindLabel, isAssetKind } from "../assets/rules";
import type { ChangeKind } from "./config";

export type AdminValue = Record<string, string | number | boolean | null>;
type Parsed = { value: AdminValue; recordId?: string } | { error: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const has = (b: Record<string, unknown>, k: string) => k in b && b[k] !== undefined;
const money = (n: unknown) => (typeof n === "number" ? `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "not set");
// A card / licence / policy number never goes through a proposal (accounts enter it on Compliance).
const NUMBER_RUN = /\d{5,}/;
const NO_NUMBERS = "Card, licence and policy numbers aren't taken in a proposal - accounts enter them on Compliance.";

// ---------- tip rates ----------

export const tipRateKey = (tipSite: string, wasteType: string, validFrom: string) => `new:${normName(tipSite)}|${normName(wasteType)}|${validFrom}`;

function parseTipRateAdd(b: Record<string, unknown>): Parsed {
  const tipSite = text(b.tipSite, 100), wasteType = text(b.wasteType, 80), note = text(b.note, 300) || null, rateSource = text(b.rateSource, 200) || null;
  const raw = typeof b.ratePerTonneExGst === "string" ? b.ratePerTonneExGst.replace(/[$,\s]/g, "") : b.ratePerTonneExGst;
  const rate = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  const validFrom = text(b.validFrom, 10);
  if (tipSite.length < 2) return { error: "Give the tip site." };
  if (!Number.isFinite(rate) || rate <= 0 || rate > 2000) return { error: "Give the rate per tonne ex GST." };
  if (!isIsoDate(validFrom)) return { error: "Give the date the rate starts." };
  return {
    value: { tipSite, wasteType, ratePerTonneExGst: Math.round(rate * 100) / 100, validFrom, note, rateSource },
    recordId: tipRateKey(tipSite, wasteType, validFrom),
  };
}

// ---------- resource rates ----------

// The pay fields (a person) and the day rate (plant / vehicles) - lib/resourceFields.ts PAY_RATE_FIELDS
// less engagement and GST-registered (their own kinds / screens), plus dailyRateExGst.
export const PERSON_RATE_FIELDS = ["payRateBasis", "annualSalary", "ordinaryRate", "nightRate", "travelRate", "regionalDayRate", "regionalNightRate", "saturdayRate", "sundayRate", "payRateConfirmed", "payRateNotes"] as const;
export const RATE_FIELDS = [...PERSON_RATE_FIELDS, "dailyRateExGst"] as const;
const RATE_LABEL: Record<string, string> = {
  payRateBasis: "Basis", annualSalary: "Salary", ordinaryRate: "Ordinary rate", nightRate: "Night rate", travelRate: "Travel / tools rate",
  regionalDayRate: "Regional day rate", regionalNightRate: "Regional night rate", saturdayRate: "Saturday rate", sundayRate: "Sunday rate",
  payRateConfirmed: "Confirmed", payRateNotes: "Pay notes", dailyRateExGst: "Day rate ex GST",
};
const BASES = ["HOURLY", "SALARY", "DAY_RATE"];

function parseResourceRate(b: Record<string, unknown>): Parsed {
  const value: AdminValue = {};
  for (const f of RATE_FIELDS) {
    if (!has(b, f)) continue;
    const v = b[f];
    if (f === "payRateBasis") {
      if (v !== null && v !== "" && !BASES.includes(String(v))) return { error: "The basis is HOURLY, SALARY or DAY_RATE." };
      value[f] = v === null || v === "" ? null : String(v);
    } else if (f === "payRateConfirmed") {
      if (typeof v !== "boolean") return { error: "Confirmed is yes or no." };
      value[f] = v;
    } else if (f === "payRateNotes") {
      const t = text(v, 300);
      if (looksLikeTfnOrBank(t, { freeText: true })) return { error: "TFN and bank details stay in Xero only." };
      value[f] = t || null;
    } else {
      const n = v === null || v === "" ? null : Number(typeof v === "string" ? v.replace(/[$,\s]/g, "") : v);
      const max = f === "annualSalary" ? 1_000_000 : f === "dailyRateExGst" ? 100_000 : 10_000;
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > max)) return { error: `${RATE_LABEL[f]} isn't a sensible amount.` };
      value[f] = n === null ? null : Math.round(n * 100) / 100;
    }
  }
  if (!Object.keys(value).length) return { error: "Say which rate changes, and to what." };
  return { value };
}

// ---------- tickets and documents ----------

function cleanLabel(v: unknown, max: number): { value: string | null } | { error: string } {
  const t = text(v, max);
  if (NUMBER_RUN.test(t)) return { error: NO_NUMBERS };
  if (looksLikeTfnOrBank(t)) return { error: "TFN and bank details stay in Xero only." };
  return { value: t || null };
}
function expiry(b: Record<string, unknown>): { value: string | null } | { error: string } {
  const v = b.expiryDate;
  if (v === undefined || v === null || v === "") return { value: null }; // none = doesn't expire
  return isIsoDate(v) ? { value: v } : { error: "The expiry date isn't a valid date." };
}
const opOf = (b: Record<string, unknown>) => (String(b.op ?? "").toUpperCase() === "CREATE" ? "CREATE" : String(b.op ?? "").toUpperCase() === "UPDATE" ? "UPDATE" : null);

// The ticket / document type comes in as ticketKind / docKind (the body's "kind" is the change kind) and is
// stored as the record's own field, kind.
function parseTicket(body: Record<string, unknown>): Parsed {
  const b: Record<string, unknown> = { ...body, kind: body.ticketKind };
  if (!("ticketKind" in body)) delete b.kind;
  if (text(b.number, 60) || text(b.notes, 10)) return { error: NO_NUMBERS };
  const op = opOf(b);
  if (!op) return { error: "Say whether it's a new ticket (CREATE) or a change to one (UPDATE)." };
  const value: AdminValue = { op };
  if (op === "CREATE" || has(b, "kind")) {
    if (!isTicketKind(b.kind)) return { error: "Pick what kind of ticket it is." };
    value.kind = b.kind;
  }
  if (op === "CREATE" || has(b, "label")) {
    const l = cleanLabel(b.label, 80);
    if ("error" in l) return l;
    value.label = l.value;
  }
  if (op === "CREATE" || has(b, "expiryDate")) {
    const e = expiry(b);
    if ("error" in e) return e;
    value.expiryDate = e.value;
  }
  if (op === "CREATE") {
    const resourceId = text(b.resourceId, 40);
    if (!resourceId) return { error: "Pick the worker from the Labour register." };
    if (value.kind === "OTHER" && !value.label) return { error: "Say what the ticket is." };
    value.resourceId = resourceId;
    return { value, recordId: `new:${resourceId}:${value.kind}:${normName(value.label as string | null)}` };
  }
  if (Object.keys(value).length === 1) return { error: "Say what changes: the type or the expiry." };
  return { value };
}

function parseDocument(body: Record<string, unknown>): Parsed {
  const b: Record<string, unknown> = { ...body, kind: body.docKind };
  if (!("docKind" in body)) delete b.kind;
  if (text(b.reference, 80) || text(b.notes, 10)) return { error: NO_NUMBERS };
  const op = opOf(b);
  if (!op) return { error: "Say whether it's a new document (CREATE) or a change to one (UPDATE)." };
  const value: AdminValue = { op };
  let holderKey = "";
  if (op === "CREATE") {
    const holderType = String(b.holderType ?? "");
    if (!["COMPANY", "SUBCONTRACTOR", "ASSET"].includes(holderType)) return { error: "Is it a company, subcontractor or asset document?" };
    value.holderType = holderType;
    if (holderType === "ASSET") {
      const resourceId = text(b.resourceId, 40), toolId = text(b.toolId, 40);
      if (!!resourceId === !!toolId) return { error: "Pick the vehicle, plant item or tool it belongs to." };
      value.resourceId = resourceId || null;
      value.toolId = toolId || null;
      holderKey = resourceId || toolId;
    } else {
      const h = cleanLabel(b.holderName, 120);
      if ("error" in h) return h;
      if (!h.value) return { error: "Whose document is it?" };
      value.holderName = h.value;
      holderKey = normName(h.value);
    }
    const t = cleanLabel(b.title, 120);
    if ("error" in t) return t;
    value.title = t.value;
  }
  if (op === "CREATE" || has(b, "kind")) {
    // An asset's kinds are the asset list (rego, insurance, service...); on UPDATE the server checks against the record.
    const asset = value.holderType === "ASSET" || (op === "UPDATE" && isAssetKind(b.kind));
    if (asset ? !isAssetKind(b.kind) : !isDocumentKind(b.kind)) return { error: "Pick what kind of document it is." };
    value.kind = b.kind as string;
  }
  if (op === "CREATE" || has(b, "issuer")) {
    const i = cleanLabel(b.issuer, 120);
    if ("error" in i) return i;
    value.issuer = i.value;
  }
  if (op === "CREATE" || has(b, "expiryDate")) {
    const e = expiry(b);
    if ("error" in e) return e;
    value.expiryDate = e.value;
  }
  if (op === "CREATE") return { value, recordId: `new:${value.holderType}:${holderKey}:${value.kind}` };
  if (Object.keys(value).length === 1) return { error: "Say what changes: the type, the insurer / issuer or the expiry." };
  return { value };
}

// ---------- per kind ----------

export function parseAdminAfter(kind: ChangeKind, b: Record<string, unknown>): Parsed {
  switch (kind) {
    case "TIP_RATE_ADD": return parseTipRateAdd(b);
    case "TIP_RATE_RETIRE": return { value: { retired: true } };
    case "INVOICED_COST_REMOVE": return { value: { removed: true } };
    case "RESOURCE_RATE": return parseResourceRate(b);
    case "RESOURCE_ENGAGEMENT": {
      const e = String(b.engagement ?? "").toUpperCase();
      return e === "EMPLOYEE" || e === "ABN" ? { value: { engagement: e } } : { error: "Employee or ABN?" };
    }
    case "WORKER_TICKET": return parseTicket(b);
    case "COMPLIANCE_DOC": return parseDocument(b);
    default: return { error: "Not an admin change." };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// Nothing to propose: every proposed field (bar op) is already on the record. A new record is always a change.
export function adminUnchanged(before: AdminValue, after: AdminValue): boolean {
  if (after.op === "CREATE") return false;
  const keys = Object.keys(after).filter((k) => k !== "op");
  return keys.length > 0 && keys.every((k) => k in before && same(before[k], after[k]));
}

// The part of the "before" the approval re-checks. A new tip rate: only that no rate for the site + waste
// starts on the same date - the rate in force is context, so retiring it first doesn't make this stale.
export function checkedPart(kind: ChangeKind, v: AdminValue | null): AdminValue | null {
  if (!v) return v;
  if (kind === "TIP_RATE_ADD") return { sameDateRate: v.sameDateRate ?? null };
  return v;
}

const rateText = (v: AdminValue, k: string) => {
  const x = v[k];
  if (k === "payRateBasis") return `${RATE_LABEL[k]}: ${x ?? "not set"}`;
  if (k === "payRateConfirmed") return `${RATE_LABEL[k]}: ${x ? "yes" : "no (TBC)"}`;
  if (k === "payRateNotes") return `${RATE_LABEL[k]}: ${x ?? "none"}`;
  return `${RATE_LABEL[k]} ${money(x)}`;
};
const ticketText = (v: AdminValue) =>
  `${ticketKindLabel(String(v.kind ?? ""))}${v.label ? ` - ${v.label}` : ""}: ${v.expiryDate ? `expires ${v.expiryDate}` : "doesn't expire"}`;
const docKindLabel = (k: unknown) => (isAssetKind(k) ? assetKindLabel(String(k)) : documentKindLabel(String(k ?? "")));
const docText = (v: AdminValue) =>
  `${docKindLabel(v.kind)}${v.issuer ? ` (${v.issuer})` : ""}: ${v.expiryDate ? `${isAssetKind(v.kind) ? "due" : "expires"} ${v.expiryDate}` : "no expiry"}`;
const changedOnly = (v: AdminValue, after: AdminValue, label: (k: string, v: AdminValue) => string) =>
  Object.keys(after).filter((k) => k !== "op").map((k) => label(k, v)).join(" · ");
const TICKET_FIELD: Record<string, string> = { kind: "Type", label: "Class / detail", expiryDate: "Expiry" };
const DOC_FIELD: Record<string, string> = { kind: "Type", issuer: "Insurer / issuer", expiryDate: "Expiry" };
const fieldText = (names: Record<string, string>, k: string, v: AdminValue) =>
  `${names[k] ?? k}: ${k === "kind" ? (names === TICKET_FIELD ? ticketKindLabel(String(v.kind ?? "")) : docKindLabel(v.kind)) : v[k] ?? "none"}`;

// Before and after, in words, for the card.
export function describeAdmin(kind: ChangeKind, before: AdminValue | null, after: AdminValue): { before: string; after: string } {
  const b = before ?? {};
  switch (kind) {
    case "TIP_RATE_ADD":
      return {
        before: b.inForceRate != null ? `In force on that date: ${money(b.inForceRate)}/t from ${b.inForceFrom}` : "No rate for this site and waste type on that date",
        after: `${money(after.ratePerTonneExGst)}/t ex GST from ${after.validFrom}${after.note ? ` (${after.note})` : ""}`,
      };
    case "TIP_RATE_RETIRE":
      return { before: `${money(b.ratePerTonneExGst)}/t ex GST from ${b.validFrom} - in use`, after: "Retired (kept as history)" };
    case "INVOICED_COST_REMOVE":
      return {
        before: `${b.vendor} ${b.invoiceNo ?? "(no number)"} · ${money(b.amountExGst)} ex GST (${money(b.totalIncGst)} inc GST) · week ending ${b.weekEnding} · ${b.job}`,
        after: b.hireResourceId ? "Removed - the hire estimate covers those days again" : "Removed from the job's cost",
      };
    case "RESOURCE_RATE":
      return { before: changedOnly(b, after, (k, v) => rateText(v, k)), after: changedOnly(after, after, (k, v) => rateText(v, k)) };
    case "RESOURCE_ENGAGEMENT": {
      const w = (x: unknown) => (x === "ABN" ? "ABN" : x === "EMPLOYEE" ? "Employee" : "Not set");
      return { before: w(b.engagement), after: w(after.engagement) };
    }
    case "WORKER_TICKET":
      return after.op === "CREATE"
        ? { before: "No active ticket of this type", after: `New: ${ticketText(after)}` }
        : { before: changedOnly(b, after, (k, v) => fieldText(TICKET_FIELD, k, v)), after: changedOnly(after, after, (k, v) => fieldText(TICKET_FIELD, k, v)) };
    case "COMPLIANCE_DOC":
      return after.op === "CREATE"
        ? { before: "No active document of this type for this holder", after: `New: ${docText(after)}` }
        : { before: changedOnly(b, after, (k, v) => fieldText(DOC_FIELD, k, v)), after: changedOnly(after, after, (k, v) => fieldText(DOC_FIELD, k, v)) };
    default:
      return { before: "", after: "" };
  }
}

// SEC-003: a removed invoice is kept whole on the change - every field of the row, as it was - so it can be entered
// again exactly if the removal was wrong (the "before" when proposed, and the EXECUTED event when it goes).
export function invoiceSnapshot(c: Record<string, unknown>): AdminValue {
  const out: AdminValue = {};
  for (const [k, v] of Object.entries(c)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v as AdminValue[string];
  }
  return out;
}

// "Propose undo" for the undoable admin kinds: the old values of the fields the change set.
export const undoBody = (before: AdminValue, after: AdminValue): AdminValue =>
  Object.fromEntries(Object.keys(after).filter((k) => k !== "op").map((k) => [k, before[k] ?? null]));
