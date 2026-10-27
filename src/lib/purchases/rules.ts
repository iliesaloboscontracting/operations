// Accounts stage 6 (27 Oct 2026): purchase requests - the plain rules. Who may do what at which status, the
// money rules, and the narrow shapes a link / Manager may see. No server imports; `npm test` (rules.test.ts).
// Design: docs/accounts/STAGE6-DESIGN.md §3.
import { assertNoMoney } from "../moneyGuard";

export const STATUSES = ["REQUESTED", "NEEDS_INFO", "CHECKED", "APPROVED", "DECLINED", "ORDERED", "CLOSED", "CANCELLED"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN: Status[] = ["REQUESTED", "NEEDS_INFO", "CHECKED", "APPROVED"];

// How a status reads to the person who asked (link or app) - words only, never an amount.
export const STATUS_FOR_REQUESTER: Record<Status, string> = {
  REQUESTED: "With accounts",
  NEEDS_INFO: "Accounts need more info",
  CHECKED: "Checked - with a director to approve",
  APPROVED: "Approved - accounts will order it",
  DECLINED: "Declined",
  ORDERED: "Ordered",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export type Actor =
  | { kind: "REQUESTER" } // the person who asked: same link, or same login
  | { kind: "ACCOUNTS" } // the ACCOUNTS login or an Admin
  | { kind: "DIRECTOR"; role: string; name: string; owner?: boolean }; // anyone with director access; the owner or a DIRECTOR login decides

export type Action = "CHECK" | "ASK_INFO" | "ANSWER" | "CLOSE" | "CANCEL" | "APPROVE" | "DECLINE" | "ORDERED";

// Purchases (Ilies, 27 Oct 2026: "this approval should be to myself and directors"): the owner or a DIRECTOR login
// decides, never the person who asked.
export const PURCHASE_APPROVERS_NOTE = "Ilies, Nick or Yoel approve purchases (Nick and Yoel from their director logins).";
const person = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const samePerson = (a: string | null | undefined, b: string | null | undefined) => !!person(a) && person(a) === person(b);

const RULES: Record<Action, { from: Status[]; by: Actor["kind"]; to: Status }> = {
  CHECK: { from: ["REQUESTED"], by: "ACCOUNTS", to: "CHECKED" },
  ASK_INFO: { from: ["REQUESTED"], by: "ACCOUNTS", to: "NEEDS_INFO" },
  ANSWER: { from: ["NEEDS_INFO"], by: "REQUESTER", to: "REQUESTED" },
  CLOSE: { from: ["REQUESTED", "NEEDS_INFO"], by: "ACCOUNTS", to: "CLOSED" },
  CANCEL: { from: ["REQUESTED", "NEEDS_INFO"], by: "REQUESTER", to: "CANCELLED" },
  APPROVE: { from: ["CHECKED"], by: "DIRECTOR", to: "APPROVED" },
  DECLINE: { from: ["CHECKED"], by: "DIRECTOR", to: "DECLINED" },
  ORDERED: { from: ["APPROVED"], by: "ACCOUNTS", to: "ORDERED" },
};
export const isAction = (a: unknown): a is Action => typeof a === "string" && a in RULES;

// Why this actor can't do this action now (null = allowed), and the status it leads to.
export function check(action: Action, r: { status: string; requestedBy: string }, actor: Actor): { error: string } | { to: Status } {
  const rule = RULES[action];
  if (actor.kind !== rule.by) return { error: "You can't do that on this request." };
  if (actor.kind === "DIRECTOR") {
    if (actor.role !== "DIRECTOR" && !actor.owner) return { error: PURCHASE_APPROVERS_NOTE };
    if (samePerson(actor.name, r.requestedBy)) return { error: "You asked for this, so someone else has to approve or decline it." };
  }
  if (!rule.from.includes(r.status as Status)) return { error: `It's ${STATUS_FOR_REQUESTER[r.status as Status]?.toLowerCase() ?? r.status} - that can't be done now.` };
  return { to: rule.to };
}

// Text that can reach the requester's link (what they asked, accounts' question, their answer, a decision reason)
// must carry no dollar figure.
export const linkSafeText = (t: string | null | undefined) => !t || assertNoMoney(t);

// The amount, as typed by accounts: "$1,250.50", "1250.5" -> 1250.5; nonsense -> null.
export function parseAmount(v: unknown): number | null {
  const raw = typeof v === "string" ? v.replace(/[$,\s]/g, "") : v;
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) / 100 : null;
}

export const purchaseNo = (n: number) => `P-${String(n).padStart(4, "0")}`;

// What a link (Alex's OFFICE link) and a Manager see: no amount, no accounts note. Built field by field so a new
// money column can never slip through.
export type RequesterView = {
  id: string; ref: string; what: string; why: string | null; qty: string | null; supplier: string | null; linkUrl: string | null;
  neededBy: string | null; status: Status; statusText: string; infoQuestion: string | null; infoAnswer: string | null;
  decisionNote: string | null; requestedBy: string; createdAt: string; version: number;
};
export function requesterView(r: {
  id: string; number: number; what: string; why: string | null; qty: string | null; supplier: string | null; linkUrl: string | null;
  neededBy: string | null; status: string; infoQuestion: string | null; infoAnswer: string | null; decisionNote: string | null;
  requestedBy: string; createdAt: Date | string; version: number;
}): RequesterView {
  const status = r.status as Status;
  const safe = (t: string | null) => (linkSafeText(t) ? t : null);
  return {
    id: r.id, ref: purchaseNo(r.number), what: safe(r.what) ?? "(see accounts)", why: safe(r.why), qty: r.qty, supplier: r.supplier, linkUrl: r.linkUrl,
    neededBy: r.neededBy, status, statusText: STATUS_FOR_REQUESTER[status] ?? r.status, infoQuestion: safe(r.infoQuestion), infoAnswer: safe(r.infoAnswer),
    decisionNote: status === "DECLINED" || status === "APPROVED" ? safe(r.decisionNote) : null, requestedBy: r.requestedBy,
    createdAt: new Date(r.createdAt).toISOString(), version: r.version,
  };
}
