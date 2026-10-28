// Accounts stage 6 (27 Oct 2026): purchase requests - the plain rules. Who may do what at which status, the
// money rules, and the narrow shapes a link / Manager may see. No server imports; `npm test` (rules.test.ts).
// Design: docs/accounts/STAGE6-DESIGN.md §3.
//
// 28 Oct 2026, Ilies: "This should have send to directors ... not accounts ... accounts removed as it has no authority
// to approve". A request goes STRAIGHT to the approvers (the owner or a DIRECTOR login, never the person who asked);
// once approved, accounts order it (and may note the price then). CHECKED is kept only so older requests can still
// be decided.
import { assertNoMoney } from "../moneyGuard";
import { sameUser } from "../samePerson";
import { isOwner } from "../owner";

export const STATUSES = ["REQUESTED", "NEEDS_INFO", "CHECKED", "APPROVED", "DECLINED", "ORDERED", "CLOSED", "CANCELLED"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN: Status[] = ["REQUESTED", "NEEDS_INFO", "CHECKED", "APPROVED"];

// How a status reads to the person who asked (link or app) - words only, never an amount.
export const STATUS_FOR_REQUESTER: Record<Status, string> = {
  REQUESTED: "With the directors to approve",
  NEEDS_INFO: "The directors need more info",
  CHECKED: "With the directors to approve", // older requests (before 28 Oct 2026, when accounts checked first)
  APPROVED: "Approved - accounts will order it",
  DECLINED: "Declined",
  ORDERED: "Ordered",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export type Actor =
  | { kind: "REQUESTER" } // the person who asked: same link, or same login
  | { kind: "ACCOUNTS" } // the ACCOUNTS login or an Admin - orders approved requests
  | { kind: "DIRECTOR"; role: string; name: string; userId?: string; owner?: boolean }; // anyone with director access; the owner or a DIRECTOR login decides

export type Action = "ASK_INFO" | "ANSWER" | "CANCEL" | "APPROVE" | "DECLINE" | "ORDERED";

// Purchases (Ilies, 27 Oct 2026: "this approval should be to myself and directors"): the owner or a DIRECTOR login
// decides, never the person who asked; accounts then order it (28 Oct 2026).
export const PURCHASE_APPROVERS_NOTE = "Ilies, Nick or Yoel approve purchases (Nick and Yoel from their director logins) - never the person who asked. Accounts then order it.";
const person = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const samePerson = (a: string | null | undefined, b: string | null | undefined) => !!person(a) && person(a) === person(b);

const RULES: Record<Action, { from: Status[]; by: Actor["kind"]; to: Status }> = {
  ASK_INFO: { from: ["REQUESTED", "CHECKED"], by: "DIRECTOR", to: "NEEDS_INFO" },
  ANSWER: { from: ["NEEDS_INFO"], by: "REQUESTER", to: "REQUESTED" },
  CANCEL: { from: ["REQUESTED", "NEEDS_INFO"], by: "REQUESTER", to: "CANCELLED" },
  APPROVE: { from: ["REQUESTED", "CHECKED"], by: "DIRECTOR", to: "APPROVED" },
  DECLINE: { from: ["REQUESTED", "CHECKED"], by: "DIRECTOR", to: "DECLINED" },
  ORDERED: { from: ["APPROVED"], by: "ACCOUNTS", to: "ORDERED" },
};
export const isAction = (a: unknown): a is Action => typeof a === "string" && a in RULES;

// Who hears about a new or answered request: the approvers (DIRECTOR logins and the owner), minus the person who
// asked under any of their logins - so Ilies's own requests reach Nick and Yoel only.
export function approverIds(users: { id: string; role: string; email: string; active?: boolean }[], requesterUserId: string | null | undefined): string[] {
  return users.filter((u) => u.active !== false && (u.role === "DIRECTOR" || isOwner(u.email)) && !sameUser(u.id, requesterUserId)).map((u) => u.id);
}

// Why this actor can't do this action now (null = allowed), and the status it leads to.
export function check(action: Action, r: { status: string; requestedBy: string; requestedByUserId?: string | null }, actor: Actor): { error: string } | { to: Status } {
  const rule = RULES[action];
  if (actor.kind !== rule.by) return { error: "You can't do that on this request." };
  if (actor.kind === "DIRECTOR") {
    if (actor.role !== "DIRECTOR" && !actor.owner) return { error: PURCHASE_APPROVERS_NOTE };
    // SEC-002 (c): by name, and by login id (another login of the same person counts - lib/samePerson.ts). The owner too.
    if (samePerson(actor.name, r.requestedBy) || sameUser(actor.userId, r.requestedByUserId)) return { error: "You asked for this, so someone else has to approve or decline it." };
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
