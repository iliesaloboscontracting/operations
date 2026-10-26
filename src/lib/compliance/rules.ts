// Accounts stage 5 (Compliance & HR, 26 Oct 2026): the plain rules - ticket and document kinds, expiry states,
// and the check that keeps TFN and bank details out (they stay in Xero only). No server imports; `npm test`
// (rules.test.ts). Design: docs/accounts/STAGE5-DESIGN.md.

export const TICKET_KINDS = [
  ["WHITE_CARD", "White card (general construction induction)"],
  ["DRIVER_LICENCE", "Driver licence"],
  ["HRWL_FORKLIFT", "HRWL - forklift (LF / LO)"],
  ["HRWL_EWP", "HRWL - EWP boom 11 m+ (WP)"],
  ["HRWL_DOGGING", "HRWL - dogging (DG)"],
  ["HRWL_RIGGING", "HRWL - rigging (RB / RI / RA)"],
  ["HRWL_SCAFFOLD", "HRWL - scaffolding (SB / SI / SA)"],
  ["HRWL_OTHER", "HRWL - other class"],
  ["PLANT_VOC", "Plant operator (VOC / RII)"],
  ["ASBESTOS_A", "Asbestos removal - Class A"],
  ["ASBESTOS_B", "Asbestos removal - Class B"],
  ["ASBESTOS_SUPERVISOR", "Asbestos removal supervisor"],
  ["ASBESTOS_AWARENESS", "Asbestos awareness"],
  ["FIRST_AID", "First aid"],
  ["CPR", "CPR"],
  ["CONFINED_SPACE", "Confined space"],
  ["HEIGHTS", "Working at heights"],
  ["TRAFFIC_CONTROL", "Traffic control / TMP"],
  ["GAS_TEST", "Gas test atmospheres"],
  ["SILICA", "Silica awareness"],
  ["SITE_INDUCTION", "Site / client induction"],
  ["OTHER", "Other"],
] as const;
export type TicketKind = (typeof TICKET_KINDS)[number][0];
export const isTicketKind = (k: unknown): k is TicketKind => typeof k === "string" && TICKET_KINDS.some(([x]) => x === k);
export const ticketKindLabel = (k: string) => TICKET_KINDS.find(([x]) => x === k)?.[1] ?? "Other";
// What a person reads: the kind, plus its class / detail where there is one.
export const ticketLabel = (t: { kind: string; label?: string | null }) =>
  t.kind === "OTHER" || t.kind === "SITE_INDUCTION" ? (t.label?.trim() || ticketKindLabel(t.kind)) : t.label?.trim() ? `${ticketKindLabel(t.kind)} - ${t.label.trim()}` : ticketKindLabel(t.kind);

export const DOCUMENT_KINDS = [
  ["PUBLIC_LIABILITY", "Public liability insurance"],
  ["WORKERS_COMP", "Workers compensation"],
  ["CONTRACT_WORKS", "Contract works insurance"],
  ["PROFESSIONAL_INDEMNITY", "Professional indemnity"],
  ["MOTOR_VEHICLE", "Motor vehicle insurance"],
  ["PLANT_INSURANCE", "Plant / equipment insurance"],
  ["DEMOLITION_LICENCE", "Demolition licence"],
  ["ASBESTOS_LICENCE", "Asbestos removal licence (Class A / B)"],
  ["SWMS_TEMPLATE", "SWMS template"],
  ["CERTIFICATION", "WHS / quality certification"],
  ["OTHER", "Other"],
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number][0];
export const isDocumentKind = (k: unknown): k is DocumentKind => typeof k === "string" && DOCUMENT_KINDS.some(([x]) => x === k);
export const documentKindLabel = (k: string) => DOCUMENT_KINDS.find(([x]) => x === k)?.[1] ?? "Other";

export const EMPLOYMENT_TYPES = [
  ["EMPLOYEE_FULL_TIME", "Employee - full time"],
  ["EMPLOYEE_PART_TIME", "Employee - part time"],
  ["CASUAL", "Casual"],
  ["ABN_CONTRACTOR", "ABN contractor"],
  ["LABOUR_HIRE", "Labour hire"],
] as const;
export const isEmploymentType = (k: unknown) => typeof k === "string" && EMPLOYMENT_TYPES.some(([x]) => x === k);

// Reminders go out this many days before an expiry (D2) - the AccountsItem alertDays maximum.
export const SOON_DAYS = 30;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type ExpiryState = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED";
// A ticket or document against today (Sydney): still good on its expiry date, expired the day after.
export function expiryState(expiryDate: string | null | undefined, today: string, soonDays = SOON_DAYS): ExpiryState {
  if (!expiryDate) return "NO_EXPIRY";
  const days = daysBetween(today, expiryDate);
  if (days < 0) return "EXPIRED";
  return days <= soonDays ? "EXPIRING" : "VALID";
}
export const daysLeft = (expiryDate: string, today: string) => daysBetween(today, expiryDate);

const RANK: Record<ExpiryState | "NONE", number> = { EXPIRED: 3, EXPIRING: 2, VALID: 1, NO_EXPIRY: 1, NONE: 0 };
// The state that matters most for a worker: any active expired ticket, else any expiring, else OK.
// "NONE" = no active tickets at all. Archived tickets are ignored.
export function worstState(tickets: { status: string; expiryDate: string | null }[], today: string): ExpiryState | "NONE" {
  let worst: ExpiryState | "NONE" = "NONE";
  for (const t of tickets) {
    if (t.status !== "ACTIVE") continue;
    const s = expiryState(t.expiryDate, today);
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

// TFN and bank details stay in Xero only, never in Operations.
// - The words (TFN, tax file, BSB, account number, bank details) are refused in every text field.
// - Free text (notes, address) also refuses the shapes: a TFN-like 9-digit number ("123 456 789" or
//   "123456789") and a BSB + account ("062-000 12345678"). A number labelled ACN / ABN / licence is allowed, and
//   licence, card or policy number fields never get the shape check (a licence number can be 9 digits).
const BANK_WORDS = /\b(tfn|tax\s*file|bsb|account\s*(no|num|number|#)|acct\s*(no|#)|bank\s*(details|account))\b/i;
// A digit one space before or after means it's part of a longer number (a phone, an ABN), not a TFN.
const TFN_SHAPE = /(?<!\d\s?)\d{3}\s?\d{3}\s?\d{3}(?!\s?\d)/g;
const BSB_ACCOUNT = /(?<!\d)\d{3}-\d{3}(?!\d)[\s,;/]+\d{6,10}(?!\d)/;
export function looksLikeTfnOrBank(text: string | null | undefined, opts: { freeText?: boolean } = {}): boolean {
  if (!text) return false;
  const t = String(text);
  if (BANK_WORDS.test(t)) return true;
  if (!opts.freeText) return false;
  if (BSB_ACCOUNT.test(t)) return true;
  for (const m of t.matchAll(TFN_SHAPE)) {
    const before = t.slice(Math.max(0, m.index! - 12), m.index!);
    if (!/\b(acn|abn|lic(ence|ense)?)\s*(no\.?|number)?\s*[:#]?\s*$/i.test(before)) return true;
  }
  return false;
}

// Onboarding progress: how many of the checklist items are done (shown as "x of 6").
export function onboardingProgress(o: { startDate?: string | null; employmentType?: string | null; emergencyName?: string | null; emergencyPhone?: string | null; xeroSetUp?: boolean | null; contractSigned?: string | null; inductionDate?: string | null } | null) {
  if (!o) return { done: 0, of: 6 };
  const steps = [!!o.startDate, !!o.employmentType, !!(o.emergencyName && o.emergencyPhone), !!o.xeroSetUp, !!o.contractSigned, !!o.inductionDate];
  return { done: steps.filter(Boolean).length, of: steps.length };
}
