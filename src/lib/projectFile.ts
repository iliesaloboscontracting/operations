import { assertNoMoney } from "./moneyGuard";

// Project File (Operations Analyst brief 11, Phase 1, 2026-10-14): the fields
// a project carries beyond the basics, which tab each one sits on, and the
// rules shared by the project page, the Projects list and the API routes -
// kept in one place so the page and the server can't drift apart.
//
// Blank always means "not known yet". Nothing here ever fills in a default,
// and nothing here ever marks a project READY - completeness is a count of
// what's been filled in, for a person to judge.

export type ProjectFileTab = "overview" | "site" | "scope";

export interface ProjectFileField {
  key: string;
  label: string;
  tab: ProjectFileTab;
  hint?: string;
  multiline?: boolean;
}

// Fields added by the Project File. The existing project fields (name,
// client, job no, address, shift hours, scope of works...) are not repeated
// here - the Overview tab reuses the existing project form for those.
export const PROJECT_FILE_FIELDS: ProjectFileField[] = [
  { key: "expectedCompletion", label: "Expected completion", tab: "overview" },
  { key: "officeContactId", label: "Lobos office contact", tab: "overview" },
  { key: "siteEntry", label: "Entry point / gate", tab: "site", hint: "Where the crew go in" },
  { key: "siteParking", label: "Parking", tab: "site", multiline: true },
  { key: "inductionBy", label: "Induction - who runs it", tab: "site" },
  { key: "inductionBooking", label: "Induction - how to book", tab: "site", multiline: true },
  { key: "siteLoadingAccess", label: "Loading and truck access", tab: "site", multiline: true },
  { key: "siteRestrictions", label: "Noise / dust restrictions", tab: "site", multiline: true },
  { key: "siteAmenities", label: "Amenities", tab: "site", hint: "Toilets, lunch room, water, power" },
  { key: "emergencyAssembly", label: "Emergency assembly point", tab: "site" },
  { key: "nearestHospital", label: "Nearest hospital", tab: "site" },
  { key: "sitePpe", label: "Task-specific PPE", tab: "site", hint: "Beyond the standard kit", multiline: true },
  { key: "scopeExclusions", label: "Exclusions", tab: "scope", multiline: true },
];

export const PROJECT_FILE_KEYS = PROJECT_FILE_FIELDS.map((f) => f.key);

// Expected completion is a YYYY-MM-DD date, or "TBC" when the project has no
// end date yet (Ilies, 14 Oct 2026). TBC is a deliberate answer, so it counts
// as filled in; blank still means nobody has looked.
export const COMPLETION_TBC = "TBC";
export const isCompletionValue = (v: string) => v === COMPLETION_TBC || /^\d{4}-\d{2}-\d{2}$/.test(v);

// Text that can go out to crew or clients, so it must never carry a dollar
// figure (the brief's part D). scopeOfWorks is an existing field but goes
// out the same way, so it's checked here too.
export const MONEY_GUARDED_KEYS = [
  ...PROJECT_FILE_FIELDS.filter((f) => f.tab === "site" || f.tab === "scope").map((f) => f.key),
  "scopeOfWorks",
];

export const CONTACT_TEXT_KEYS = ["name", "company", "role", "phone", "email", "source"] as const;

export const VISIBLE_TO = ["INTERNAL", "CREW", "CLIENT"] as const;
export type VisibleTo = (typeof VISIBLE_TO)[number];
export const VISIBLE_TO_LABEL: Record<VisibleTo, string> = {
  INTERNAL: "Internal only",
  CREW: "Crew",
  CLIENT: "Client",
};

const FIELD_LABEL: Record<string, string> = Object.fromEntries([
  ...PROJECT_FILE_FIELDS.map((f) => [f.key, f.label]),
  ["scopeOfWorks", "Scope of works"],
  ["name", "Name"],
  ["company", "Company"],
  ["role", "Role"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["source", "Source"],
]);

// Labels of any guarded field in `values` that contains a dollar figure.
export function moneyProblems(values: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys
    .filter((k) => typeof values[k] === "string" && !assertNoMoney(values[k] as string))
    .map((k) => FIELD_LABEL[k] ?? k);
}

export function moneyError(labels: string[]) {
  return `${labels.join(", ")} ${labels.length > 1 ? "look" : "looks"} like ${
    labels.length > 1 ? "they contain" : "it contains"
  } a dollar figure. This information can go out to crew and clients, so remove it before saving.`;
}

// fieldSources is stored as JSON text: {"siteParking": "Induction pack Rev B"}.
export function parseSources(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Accepts an object (or JSON text) of source notes, keeps only known fields
// with non-blank text, and returns JSON text - or null when there are none.
export function normaliseSources(input: unknown): string | null {
  const obj = typeof input === "string" ? parseSources(input) : (input as Record<string, unknown>) ?? {};
  const allowed = new Set([...PROJECT_FILE_KEYS, "scopeOfWorks"]);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (allowed.has(k) && typeof v === "string" && v.trim()) clean[k] = v.trim();
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

// What counts toward completeness: every Project File field, plus at least
// one external contact the crew can be given. It's a count for a person to
// judge - never a READY flag.
export const COMPLETENESS_TOTAL = PROJECT_FILE_FIELDS.length + 1;

export interface Completeness {
  filled: number;
  total: number;
  missing: string[];
}

export function completeness(
  project: Record<string, unknown>,
  crewContactCount: number
): Completeness {
  const missing: string[] = [];
  for (const f of PROJECT_FILE_FIELDS) {
    const v = project[f.key];
    if (v === null || v === undefined || (typeof v === "string" && !v.trim())) missing.push(f.label);
  }
  if (crewContactCount < 1) missing.push("A contact the crew can call");
  return { filled: COMPLETENESS_TOTAL - missing.length, total: COMPLETENESS_TOTAL, missing };
}

// The same rule the day sheet uses for who's in charge on a job.
export function isSupervisorRole(role: string | null | undefined) {
  return role === "Supervisor" || role === "Lead";
}
