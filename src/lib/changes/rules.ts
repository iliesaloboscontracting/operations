// Controlled changes (LCI phase 4, A3) - the plain rules: what each kind's
// value looks like, who may propose / see / approve, the person check
// (requester != approver, the source person can't approve, by PERSON not
// login), expiry, the "before still true" re-check and undo. No server
// imports; `npm test` (changes.test.ts). Design: docs/lci/PHASE4-5-DESIGN.md §1.
import { isOwner } from "../owner";
import { sameUser } from "../samePerson";
import { isOperationsAi } from "../infoRequests/rules";
import { A3_RULES, CHANGE_KINDS, NEVER_APPROVE, isAdminKind, type ChangeKind } from "./config";
import { parseAdminAfter } from "./adminRules";

export type ChangeUser = { id: string; name: string; email: string; role: string; directorAccess: boolean };
export type ChangeValue = Record<string, string | number | boolean | null>;
export type SourceRef = { type: "SiteRequest" | "Finding" | "Query" | "Phone" | "Email" | "Document" | "Other"; id?: string; label: string };

export const isKind = (k: unknown): k is ChangeKind => typeof k === "string" && (CHANGE_KINDS as string[]).includes(k);

// ---------- kill switches ----------

export function kindEnabled(kind: ChangeKind, env: { all?: string; off?: string } = { all: process.env.CONTROLLED_CHANGES, off: process.env.CONTROLLED_CHANGES_OFF }): boolean {
  if ((env.all ?? "").trim().toLowerCase() === "off") return false;
  const off = (env.off ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return A3_RULES[kind].enabled && !off.includes(kind);
}
export const SWITCHED_OFF = "Controlled changes are switched off for this kind - make the change by hand, or ask the lead to switch them on.";

// ---------- people ----------

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const samePerson = (a: string | null | undefined, b: string | null | undefined) => !!norm(a) && norm(a) === norm(b);
const staff = (u: ChangeUser) => u.role === "ADMIN" || u.role === "MANAGER";

// Seeing a proposal: Managers and Admins see every kind (Managers already see
// contract values on Tracking); other director-access logins (Nick's and
// Yoel's DIRECTOR logins) see the COMMERCIAL kinds only - the contract values
// they approve - never an operational change (the lead, 25 Oct 2026). Nobody else.
// The admin kinds (28 Oct 2026: rates, amounts, HR records) are Admins only, plus Operations AI (the
// Building Agent's email on a MANAGER login) for its own proposals - never another Manager or a director login.
export const canViewKind = (u: ChangeUser, kind: ChangeKind) =>
  isAdminKind(kind) ? u.role === "ADMIN" || isOperationsAi(u.email, u.role) : staff(u) || (u.directorAccess && A3_RULES[kind].audience === "COMMERCIAL");
// One proposal: Operations AI sees the admin-kind proposals it raised (their values too), and no others.
export const canViewProposal = (u: ChangeUser, p: { kind: ChangeKind; requestedByUserId?: string | null }) =>
  canViewKind(u, p.kind) && (!isAdminKind(p.kind) || u.role === "ADMIN" || (!!u.id && u.id === p.requestedByUserId));

// SEC-001 (security review of 6e6f2c0, Ilies approved 28 Oct 2026): a person's pay / engagement and HR records
// (tickets, documents) are read on the card by Admins only. Anyone else who can see the proposal - Operations AI,
// its own - sees what it proposed, never what the record says now: the "before", the applied / not-applied notes,
// and no "that's already the value" answer (which would tell them the value). The first four kinds are unchanged
// (Managers still see the job number or off-hire date before).
export const MASKED_KINDS: ChangeKind[] = ["RESOURCE_RATE", "RESOURCE_ENGAGEMENT", "WORKER_TICKET", "COMPLIANCE_DOC"];
export const MASKED_BEFORE = "Current value: Admins only";
export const masksBefore = (u: { role: string }, kind: ChangeKind) => u.role !== "ADMIN" && MASKED_KINDS.includes(kind);
// The applied / not-applied note as such a viewer reads it (the stored note names the old values).
export const maskedNote = (action: string, note: string | null) =>
  action === "EXECUTED" ? "Applied as approved. (Current values: Admins only.)" : action === "STALE" ? "Not applied - the record had changed or couldn't be updated. (Current values: Admins only.)" : note;

// Which of these logins are Operations AI now (SEC-004: an active login only - a switched-off agent login isn't
// the AI, so the owner exception stops for its waiting proposals).
export const aiProposerIds = (users: { id: string; email: string; role: string; active: boolean }[]) =>
  new Set(users.filter((u) => u.active && isOperationsAi(u.email, u.role)).map((u) => u.id));

// Proposing: Managers and Admins, any kind but the admin ones; director logins, the commercial
// kinds; the admin kinds, an Admin or Operations AI; the system only off-hire dates, from a supervisor's hire check (4e).
export const SYSTEM_ACTOR: ChangeUser = { id: "", name: "System", email: "system@lci", role: "SYSTEM", directorAccess: false };
export const canProposeKind = (u: ChangeUser, kind: ChangeKind) => (u.role === "SYSTEM" ? kind === "HIRE_OFF_HIRE_DATE" : canViewKind(u, kind));

// Why this person can't approve this proposal, or null when they can.
// proposedByAi: the proposer is Operations AI now (the server reads the proposer's login at the time of the decision).
export function cannotApprove(u: ChangeUser, p: { kind: ChangeKind; requestedBy: string; requestedByUserId?: string | null; sourcePerson: string | null; proposedByAi?: boolean }): string | null {
  const rule = A3_RULES[p.kind];
  if (NEVER_APPROVE.includes(u.email.toLowerCase())) return "This login proposes changes; it never approves them.";
  const byRole = rule.approvers.roles.includes(u.role);
  const byOwner = rule.approvers.ownerMayApprove && isOwner(u.email);
  if (!byRole && !byOwner) return `${rule.label} changes are approved by ${approverWords(p.kind)}.`;
  // SEC-002 (c): by login id too (another login of the same person counts), not only by name.
  if (samePerson(u.name, p.requestedBy) || sameUser(u.id, p.requestedByUserId)) {
    // The one exception (admin kinds only, the lead 28 Oct 2026): SAME_PERSON pairs the owner with the Building
    // Agent, but the owner may approve what Operations AI proposed. Never his own proposal (same login or name).
    const aiException = !!rule.approvers.aiOwnerMayApprove && !!p.proposedByAi && isOwner(u.email)
      && !!p.requestedByUserId && u.id !== p.requestedByUserId && !samePerson(u.name, p.requestedBy);
    if (!aiException) return "You proposed this change, so someone else has to approve it.";
  }
  if (samePerson(u.name, p.sourcePerson)) return "The information came from you, so someone else has to approve putting it in.";
  return null;
}
export function approverWords(kind: ChangeKind) {
  const a = A3_RULES[kind].approvers;
  const roles = a.roles.map((r) => (r === "DIRECTOR" ? "a director login" : r === "ADMIN" ? "an Admin" : r.toLowerCase()));
  return [...roles, ...(a.ownerMayApprove && !a.roles.includes("ADMIN") ? ["the owner"] : [])].join(" or ");
}

// ---------- values ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_TEXT = /^[A-Za-z0-9][A-Za-z0-9 _./-]{0,23}$/;

// The proposed value for a kind, checked and in the exact shape the record
// edit (applyResourcePatch / applyProjectPatch) takes - or what's wrong.
// Admin kinds: ./adminRules.ts (a new record's key comes back as recordId).
export function parseAfter(kind: ChangeKind, b: Record<string, unknown>): { value: ChangeValue; recordId?: string } | { error: string } {
  if (isAdminKind(kind)) return parseAdminAfter(kind, b);
  if (kind === "HIRE_OFF_HIRE_DATE") {
    const d = typeof b.offHireDate === "string" ? b.offHireDate.trim() : "";
    if (!ISO.test(d) || Number.isNaN(Date.parse(d))) return { error: "Give the new off-hire date." };
    return { value: { offHireDate: d } };
  }
  if (kind === "PROJECT_CONTRACT_VALUE") {
    const raw = typeof b.contractValue === "string" ? b.contractValue.replace(/[$,\s]/g, "") : b.contractValue;
    const v = typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(v) || v <= 0 || v > 1e9) return { error: "Give the contract value in dollars, ex GST." };
    const notes = typeof b.contractValueNotes === "string" ? b.contractValueNotes.trim().slice(0, 200) : "";
    return { value: { contractValue: Math.round(v * 100) / 100, contractValueNotes: notes || null } };
  }
  const key = kind === "PROJECT_JOB_NO" ? "jobNo" : "quoteNo";
  const t = typeof b[key] === "string" ? (b[key] as string).trim() : "";
  if (!NUMBER_TEXT.test(t)) return { error: `Give the ${A3_RULES[kind].label.toLowerCase()} (letters, digits, - _ . / only).` };
  return { value: { [key]: t } };
}

// The fields each kind reads and writes (contract value carries its notes with it).
export const fieldsOf = (kind: ChangeKind) => (kind === "PROJECT_CONTRACT_VALUE" ? ["contractValue", "contractValueNotes"] : [A3_RULES[kind].field]);
export const pickValue = (kind: ChangeKind, record: Record<string, unknown>): ChangeValue =>
  Object.fromEntries(fieldsOf(kind).map((f) => [f, (record[f] ?? null) as string | number | null]));

// Canonical JSON: keys sorted at every level, no whitespace - so the same
// payload always gives the same fingerprint.
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as Record<string, unknown>).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const noChange = (before: ChangeValue, after: ChangeValue) => sameValue(before, after);

// What the fingerprint covers (§1.4).
export const fingerprintPayload = (p: {
  kind: string; recordType: string; recordId: string; field: string; before: ChangeValue | null; after: ChangeValue;
  sourceRefs: SourceRef[]; requestedBy: string; expiresAt: Date;
}) => canonical({ ...p, expiresAt: p.expiresAt.toISOString() });

// ---------- time ----------

export const expiryFor = (kind: ChangeKind, from: Date) => new Date(from.getTime() + A3_RULES[kind].expiryDays * 86_400_000);
export const isExpired = (p: { expiresAt: Date }, now: Date) => now.getTime() >= p.expiresAt.getTime();

// ---------- sources ----------

export function parseSources(v: unknown): SourceRef[] | { error: string } {
  const list = Array.isArray(v) ? v : [];
  const types = ["SiteRequest", "Finding", "Query", "Phone", "Email", "Document", "Other"];
  const out: SourceRef[] = [];
  for (const raw of list.slice(0, 6)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const type = String(r.type ?? "");
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 200) : "";
    if (!types.includes(type) || !label) continue;
    out.push({ type: type as SourceRef["type"], ...(typeof r.id === "string" && r.id ? { id: r.id.slice(0, 40) } : {}), label });
  }
  if (!out.length) return { error: "Say where the new value came from (the request, the answer, a phone call...)." };
  return out;
}

export const openKeyOf = (recordType: string, recordId: string, field: string) => `${recordType}:${recordId}:${field}`;
export const proposalRef = (n: number) => `P-${String(n).padStart(4, "0")}`;
