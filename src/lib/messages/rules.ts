// Office chat (27 Oct 2026): the plain rules - who uses it, who may start a thread with whom, what a message may say,
// who may edit or delete it, and "seen" / unread. No server imports; `npm test` (rules.test.ts).
// Ilies, 27 Oct: "DOLLAR VALUES ARE APPROVED WITHIN THE OFFICE CHATS AND MESSAGES" - amounts are fine everywhere in the
// chat (room and one-to-ones, Managers and Operations AI included). Chat never reaches a site / driver / office link,
// and the link money guard elsewhere is unchanged.
// Design: docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3 (built on the messaging branch, 3c64ff1, without the
// site-link side - Ilies scrapped messaging to workers).
import { OPERATIONS_AI_NAME, isOperationsAi, overAiLimit } from "../infoRequests/rules";
import { looksLikeTfnOrBank } from "../compliance/rules";

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

// Ilies, 27 Oct (D-Q11 "YES"): the owner - and only the owner, not other Admins or the directors - may read every
// one-to-one, read-only ("All conversations"). He isn't a participant and his reading never marks anything seen.
export const canReadAllThreads = (email: string | null | undefined, ownerEmail: string) => (email ?? "").toLowerCase() === ownerEmail.toLowerCase();

// D-Q10: Operations AI may post at most 20 chat messages in a rolling 24 hours (its questions are counted apart).
// Nobody else has a limit.
export const overChatLimit = (email: string | null | undefined, sentLast24h: number) => isOperationsAi(email) && overAiLimit(sentLast24h);

// How a login is named in chat: the Building Agent is "Operations AI" everywhere.
export const chatName = (name: string, email: string | null | undefined) => (isOperationsAi(email) ? OPERATIONS_AI_NAME : name);

export const MAX_BODY = 2000;

// CH-022 (security review, Ilies approved 27 Oct): TFN and bank details never go in chat - they stay in Xero, and a
// bank detail change is never taken from a message (the usual invoice-fraud route). Same check as Compliance.
export const NO_TFN_OR_BANK = "Tax file numbers and bank details aren't sent in chat - they stay in Xero. Bank detail changes are never taken from chat.";

// A message as typed (new, or an edit) -> the text to keep, or why not. Amounts are allowed.
export function checkBody(body: unknown): { text: string } | { error: string } {
  const text = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return { error: "Write the message." };
  if (text.length > MAX_BODY) return { error: `Keep it under ${MAX_BODY} characters.` };
  if (looksLikeTfnOrBank(text, { freeText: true })) return { error: NO_TFN_OR_BANK };
  return { text };
}

// Ilies, 27 Oct: "ALLOW EDITING AND CORRECTIONS WITHOUT SAYING A NEW MESSAGE" and "everyone that sends a message ...
// should have the ability to allow editing or changes or deletion to the message without directors approval".
// The sender edits or deletes their own message, any time, no approval; nobody touches someone else's. A deleted
// message stays deleted (no edit, no second delete).
export function canChange(m: { authorId: string; deletedAt: Date | string | null }, myParticipantId: string): { ok: true } | { error: string } {
  if (m.authorId !== myParticipantId) return { error: "You can only change your own messages." };
  if (m.deletedAt) return { error: "That message was deleted." };
  return { ok: true };
}

// What a reader sees of a message's history: edits behind "edited" for everyone in the conversation; deleted text
// (the DELETE version, and the edits before it) for the owner only.
export function visibleHistory(versions: { kind: string; body: string; at: Date | string }[], deleted: boolean, viewerIsOwner: boolean) {
  if (deleted && !viewerIsOwner) return [];
  return versions.filter((v) => v.kind === "EDIT" || viewerIsOwner).map((v) => ({ kind: v.kind, text: v.body, at: new Date(v.at).toISOString() }));
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

// A record's label as both people see it.
export const labelOf = (ref: string, detail: string | null | undefined) => (detail ? `${ref} · ${detail.replace(/\s+/g, " ").trim().slice(0, 80)}` : ref);

// A phone alert never carries the message, nor the record label (a label can now carry an amount, and an alert shows
// on a lock screen through Apple's / Google's servers) - only who it's from. The Office room sends none (D-Q9).
export const alertText = (fromName: string) => ({ title: `Message from ${fromName}`, body: "Open Messages to read it." });
