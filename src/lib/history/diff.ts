// One change history for edits to business records (keep forever, Ilies 10 Nov 2026) - the plain part: which fields
// changed between the row before and the row after, as text, and which fields / values are never recorded. No server
// imports; `npm test` (history.test.ts). The database side is store.ts, who may read it is access.ts.
import { looksLikeTfnOrBank } from "../compliance/rules";

export type FieldChange = { field: string; before: string | null; after: string | null };

// The models whose edits are recorded. User (logins, passwords, sessions) is never one of them.
export const HISTORY_MODELS = [
  "Resource", "Project", "Job", "Tool", "Toolbox", "ToolIssue", "InvoicedCost", "InvoiceDraft", "ServiceRecord",
  "ProjectContact", "SiteAlias", "BugReport", "AccountsItem", "JobActual", "DayClose", "TimesheetWeek",
  "LabourHireCompanyAlias", // the labour hire timesheet's company-name mappings (11 Nov 2026)
] as const;
export type HistoryModel = (typeof HISTORY_MODELS)[number];
export const isHistoryModel = (m: unknown): m is HistoryModel => typeof m === "string" && (HISTORY_MODELS as readonly string[]).includes(m);

// Bookkeeping columns that change on every write and say nothing about the record.
const ALWAYS_SKIPPED = new Set(["id", "createdAt", "updatedAt"]);
// Never recorded, whatever the model: passwords, sessions, tokens, secrets, push keys.
const SECRET_FIELD = /(password|passwordhash|sessionversion|token|secret|p256dh|^auth$|apikey|hash$)/i;
export const isNeverRecorded = (field: string) => ALWAYS_SKIPPED.has(field) || SECRET_FIELD.test(field);

// Large JSON blobs kept in their own tables (a timesheet's approved snapshot) - recorded as "changed", never copied.
const BLOB_FIELDS = new Set(["snapshot"]);
export const BLOB_NOTE = "(changed - kept on the record)";
// What's written instead of a value that looks like a TFN or bank detail (those stay in Xero only).
export const WITHHELD = "(not recorded - TFN or bank details stay in Xero)";
const MAX_TEXT = 2000;

// A value as stored text: dates as ISO, booleans and numbers as written, objects as JSON, null stays null.
export function valueText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string") return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
  } catch {
    return String(v);
  }
}

const safeText = (v: string | null) => (v != null && looksLikeTfnOrBank(v, { freeText: true }) ? WITHHELD : v);

// Only the fields that actually changed. `fields` limits it to those named (the ones the edit may touch); the row
// before and after are the whole records read in the same transaction. A field missing from `after` didn't change.
export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown>, fields?: readonly string[]): FieldChange[] {
  const keys = fields ?? Object.keys(after);
  const out: FieldChange[] = [];
  for (const field of keys) {
    if (isNeverRecorded(field) || !(field in after)) continue;
    const b = valueText(before ? before[field] : null);
    const a = valueText(after[field]);
    if (b === a) continue;
    if (BLOB_FIELDS.has(field)) {
      out.push({ field, before: b == null ? null : BLOB_NOTE, after: a == null ? null : BLOB_NOTE });
      continue;
    }
    out.push({ field, before: safeText(b), after: safeText(a) });
  }
  return out;
}
