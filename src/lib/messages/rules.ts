// Office chat (27 Oct 2026): the plain rules - who uses it, who may start a thread with whom, when a thread may carry
// amounts, what a message may say, and "seen" / unread. No server imports; `npm test` (rules.test.ts).
// Design: docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3 (built on the messaging branch, 3c64ff1, without the
// site-link side - Ilies scrapped messaging to workers).
import { assertNoMoney } from "../moneyGuard";
import { OPERATIONS_AI_NAME, isOperationsAi } from "../infoRequests/rules";

// Office logins: the owner and Admins, Managers, accounts and the directors. Viewers and Timesheets logins don't chat.
export const OFFICE_ROLES = ["ADMIN", "MANAGER", "ACCOUNTS", "DIRECTOR"];
export const canMessage = (role: string) => OFFICE_ROLES.includes(role);

// The one shared group room every office login reads and posts in.
export const ROOM_KEY = "OFFICE";
export const ROOM_TITLE = "Office";
export const ROOM_FIRST_VISIT_DAYS = 7; // D-Q7: before your first visit, only the last week counts as unread

// One-to-one: any two office logins (the branch kept directors and the office apart - Ilies asked for chat between
// office personnel, so that's lifted).
export function canStart(fromRole: string, toRole: string): { ok: true } | { error: string } {
  if (!canMessage(fromRole)) return { error: "Your login can't send messages." };
  if (!canMessage(toRole)) return { error: "That login doesn't use messages." };
  return { ok: true };
}

// Amounts only when both people are owner / Admin / accounts / director logins - never a Manager, never Operations AI
// (a Manager login), and never in the Office room (Managers read it).
const MONEY_ROLES = ["ACCOUNTS", "DIRECTOR", "ADMIN"];
export type Person = { role: string; email?: string | null };
export const moneyAllowed = (a: Person, b: Person) => [a, b].every((p) => MONEY_ROLES.includes(p.role) && !isOperationsAi(p.email));

// How a login is named in chat: the Building Agent is "Operations AI" everywhere.
export const chatName = (name: string, email: string | null | undefined) => (isOperationsAi(email) ? OPERATIONS_AI_NAME : name);

export const MAX_BODY = 2000;
const NO_MONEY = "Leave amounts out - a Manager can read this conversation. Accounts keep the figures.";

// A message as typed -> the text to keep, or why not.
export function checkBody(body: unknown, money: boolean): { text: string } | { error: string } {
  const text = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return { error: "Write the message." };
  if (text.length > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters.` };
  if (!money && !assertNoMoney(text)) return { error: NO_MONEY };
  return { text };
}

// "Seen": the other person opened the thread at or after the message.
export const seenBy = (messageAt: Date | string, otherLastSeen: Date | string | null | undefined) =>
  !!otherLastSeen && new Date(otherLastSeen).getTime() >= new Date(messageAt).getTime();

// In the room (D-Q6): who has opened it since the message - "Seen by N", names on hover.
export const roomSeenBy = (messageAt: Date | string, others: { name: string; lastSeenAt: Date | string | null }[]) =>
  others.filter((o) => seenBy(messageAt, o.lastSeenAt)).map((o) => o.name);

// Unread for me: messages from others after I last opened the thread. `floor` is where an unopened room starts.
export function unreadCount(messages: { authorId: string; createdAt: Date | string }[], meId: string | null, myLastSeen: Date | string | null | undefined, floor?: Date | string) {
  const since = myLastSeen ? new Date(myLastSeen).getTime() : floor ? new Date(floor).getTime() : -Infinity;
  return messages.filter((m) => m.authorId !== meId && new Date(m.createdAt).getTime() > since).length;
}

export const SUBJECT_TYPES = ["NONE", "PURCHASE", "REIMBURSEMENT", "PAY_WEEK", "ABN_INVOICE", "SITE_REQUEST"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const isSubjectType = (t: unknown): t is SubjectType => typeof t === "string" && (SUBJECT_TYPES as readonly string[]).includes(t);

// Who may start a thread about which kind of record - the people who already work on that record's screen.
const SUBJECT_ROLES: Record<SubjectType, string[]> = {
  NONE: ["ACCOUNTS", "DIRECTOR", "ADMIN", "MANAGER"],
  PURCHASE: ["ACCOUNTS", "DIRECTOR", "ADMIN"],
  REIMBURSEMENT: ["ACCOUNTS", "ADMIN"],
  PAY_WEEK: ["ACCOUNTS", "ADMIN"],
  ABN_INVOICE: ["ACCOUNTS", "ADMIN"],
  SITE_REQUEST: ["ADMIN", "MANAGER"],
};
export const canUseSubject = (role: string, t: SubjectType) => SUBJECT_ROLES[t].includes(role);

// A record's label as both people see it. When a Manager can read the thread, a part carrying a dollar figure is
// dropped (the reference alone finds the record).
export const labelOf = (ref: string, detail: string | null | undefined, money: boolean) =>
  detail && (money || assertNoMoney(detail)) ? `${ref} · ${detail.replace(/\s+/g, " ").trim().slice(0, 80)}` : ref;

// A phone alert never carries the message - who it's from, and (D-Q8) the record label only in a thread with no
// amounts. The Office room sends no alerts (D-Q9).
export const alertText = (fromName: string, subjectLabel: string, money: boolean) => ({
  title: `Message from ${fromName}`,
  body: !money && subjectLabel && subjectLabel !== "Message" ? subjectLabel : "Open Messages to read it.",
});
