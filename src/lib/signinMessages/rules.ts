// Message at sign-in (Ilies, 23 Nov 2026: "yes build it, deploy once passes"). The plain rules - no database, no server
// imports, so the routes, the Sign-ins page, the phone screens and `npm test` (rules.test.ts) all read the same words.
//
// The office (Managers, Admins and the coordinator - the same people as "Not in today") writes a short plain-text note to
// one person, several people (active Labour-register people), or everyone who signs in (staff and labour hire workers
// named at sign-in). It shows on the person's phone after a QR sign-in succeeds - after any truck pre-start, never
// holding the sign-in up - and on their own SUPERVISOR / DRIVER link home. "Got it" records it seen (once overall);
// unseen, it shows again at the next sign-in until its "show until" day. Archive hides it from crew (the row stays);
// there is no edit - archive and re-send, so what someone saw is never rewritten. Text only: no amounts, no TFN / bank.
import { assertNoMoney } from "../moneyGuard";
import { looksLikeTfnOrBank } from "../compliance/rules";
import { resolveCompany, workerKey } from "../labourHire/rules";

export const MESSAGE_LIMITS = {
  textMin: 2,
  textMax: 300,
  /** "Show until", when not given: today + 14 days. */
  defaultDays: 14,
  /** The latest "show until": today + 90 days. */
  maxDays: 90,
  /** Messages one login may write in 24 hours. */
  perDay: 30,
  /** People on one message. */
  maxRecipients: 100,
  archiveReasonMax: 200,
  /** Unseen messages shown to one person at once (the newest). */
  showMax: 5,
} as const;

export const AUDIENCES = ["ALL", "PEOPLE"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const SEEN_WHERE = ["QR", "LINK"] as const;
export type SeenWhere = (typeof SEEN_WHERE)[number];

// ---------- the text ----------

// Any dollar sign (also the full-width and small ones) before a figure, or "<figure> dollars / bucks".
const DOLLAR_FIGURE = /[$＄﹩]\s*\d|\d\s*(dollars?|bucks)\b|\baud\s*\d/i;
// Null = fine, else the words to show.
export function textRefusal(s: string): string | null {
  if (!assertNoMoney(s) || DOLLAR_FIGURE.test(s)) return "No dollar amounts in a message, please.";
  if (looksLikeTfnOrBank(s, { freeText: true })) return "No bank or tax file details in a message, please.";
  return null;
}
export const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------- the days ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const validDay = (d: string) => ISO.test(d) && !Number.isNaN(new Date(`${d}T12:00:00Z`).getTime()) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

// ---------- input ----------

export type MessageInput = { text: string; audience: Audience; resourceIds: string[]; showUntil: string };
export function parseMessage(body: unknown, today: string): { ok: true; value: MessageInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const text = typeof b.text === "string" ? tidy(b.text) : "";
  if (text.length < MESSAGE_LIMITS.textMin) return { ok: false, error: "Write the message." };
  if (text.length > MESSAGE_LIMITS.textMax) return { ok: false, error: `Keep the message to ${MESSAGE_LIMITS.textMax} characters.` };
  const bad = textRefusal(text);
  if (bad) return { ok: false, error: bad };
  if (b.audience !== "ALL" && b.audience !== "PEOPLE") return { ok: false, error: "Pick who it's for - everyone, or people." };
  const audience: Audience = b.audience;
  const raw = Array.isArray(b.resourceIds) ? b.resourceIds : [];
  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)))];
  if (audience === "PEOPLE") {
    if (ids.length === 0 || ids.length !== raw.length) return { ok: false, error: "Pick the people it's for." };
    if (ids.length > MESSAGE_LIMITS.maxRecipients) return { ok: false, error: `At most ${MESSAGE_LIMITS.maxRecipients} people on one message - or send it to everyone.` };
  } else if (raw.length) return { ok: false, error: "A message to everyone has no people picked." };
  let showUntil = addDays(today, MESSAGE_LIMITS.defaultDays);
  if (b.showUntil != null && b.showUntil !== "") {
    if (typeof b.showUntil !== "string" || !validDay(b.showUntil)) return { ok: false, error: "Pick the last day it shows." };
    if (b.showUntil < today) return { ok: false, error: "The last day it shows can't be in the past." };
    if (b.showUntil > addDays(today, MESSAGE_LIMITS.maxDays)) return { ok: false, error: `It can show for at most ${MESSAGE_LIMITS.maxDays} days.` };
    showUntil = b.showUntil;
  }
  return { ok: true, value: { text, audience, resourceIds: audience === "PEOPLE" ? ids : [], showUntil } };
}

export function parseArchive(body: unknown): { ok: true; reason: string | null } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const reason = typeof b.reason === "string" ? tidy(b.reason) : "";
  if (reason.length > MESSAGE_LIMITS.archiveReasonMax) return { ok: false, error: `Keep the reason under ${MESSAGE_LIMITS.archiveReasonMax} characters.` };
  const bad = reason ? textRefusal(reason) : null;
  if (bad) return { ok: false, error: bad };
  return { ok: true, reason: reason || null };
}

// 30 a day per login. Null = fine.
export const rateRefusal = (writtenLast24h: number) =>
  writtenLast24h >= MESSAGE_LIMITS.perDay ? `That's ${MESSAGE_LIMITS.perDay} messages in a day from this login - try again tomorrow.` : null;

// ---------- who it is ----------

// A person at sign-in: a Labour-register person, or a hire worker by the name and company they typed. Hire workers are
// matched by the tidied keys the labour hire timesheet uses (lib/labourHire/rules.ts): the company's key with the
// built-in spellings folded in ("Advanced Labour Hire Pty Ltd" = "advanced"), and the name's key (case, spaces and
// punctuation ignored - "Sam  O'Brien" = "sam obrien"). Nothing else is guessed. A hire worker only ever gets
// "everyone" messages - people are picked from the Labour register.
export type Who = { resourceId: string } | { hire: { name: string; company: string } };
const NO_ALIASES = new Map<string, string>();
export const hireKey = (name: string, company: string) => `hire:${resolveCompany(company, NO_ALIASES)}|${workerKey(name)}`;
export const personKeyOf = (w: Who) => ("resourceId" in w ? w.resourceId : hireKey(w.hire.name, w.hire.company));

// ---------- who sees what ----------

export type MessageRow = {
  id: string; text: string; audience: string; showUntil: string; createdAt: Date | string;
  archivedAt: Date | string | null;
};
export type MessageStatus = "LIVE" | "EXPIRED" | "ARCHIVED";
export const statusOf = (m: Pick<MessageRow, "archivedAt" | "showUntil">, today: string): MessageStatus =>
  m.archivedAt ? "ARCHIVED" : m.showUntil < today ? "EXPIRED" : "LIVE";
export const STATUS_LABEL: Record<MessageStatus, string> = { LIVE: "Showing", EXPIRED: "Finished", ARCHIVED: "Archived" };

// The messages this person should see now: live (not archived, not past its day), for everyone or naming them (a
// Labour-register person only), and not seen by them yet. Newest first, at most showMax. recipients: messageId -> the
// resourceIds it names. seen: the ids of messages this person has already seen.
export function messagesFor<M extends MessageRow>(o: { messages: M[]; recipients: Map<string, Set<string>>; seen: Set<string>; who: Who; today: string }): M[] {
  const rid = "resourceId" in o.who ? o.who.resourceId : null;
  return o.messages
    .filter((m) => statusOf(m, o.today) === "LIVE" && !o.seen.has(m.id))
    .filter((m) => m.audience === "ALL" || (m.audience === "PEOPLE" && !!rid && !!o.recipients.get(m.id)?.has(rid)))
    .sort((a, b) => String(iso(b.createdAt)).localeCompare(String(iso(a.createdAt))))
    .slice(0, MESSAGE_LIMITS.showMax);
}
// Whether this person may mark this message seen (it's theirs to see - seen or not).
export function mayMark(m: MessageRow, recipients: Set<string> | undefined, who: Who, today: string): boolean {
  if (statusOf(m, today) !== "LIVE") return false;
  if (m.audience === "ALL") return true;
  return "resourceId" in who && !!recipients?.has(who.resourceId);
}

const iso = (d: Date | string | null) => (d == null ? null : typeof d === "string" ? d : d.toISOString());
const dayMonth = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });

// What a phone gets: the words and the day - never who else it went to, never the writer's login.
export type CrewMessage = { id: string; text: string; sent: string };
export function toCrew(m: MessageRow): CrewMessage | null {
  const out = { id: m.id, text: m.text, sent: dayMonth(m.createdAt) };
  return assertNoMoney(JSON.stringify(out)) ? out : null; // refused at entry anyway - the backstop
}

// ---------- the office's view ----------

export type SeenRow = { messageId: string; personKey: string; resourceId: string | null; hireName: string | null; hireCompany: string | null; where: string; seenAt: Date | string };
export type RecipientRow = { messageId: string; resourceId: string; name: string };
export type OfficeMessage = {
  id: string; text: string; audience: Audience; showUntil: string; status: MessageStatus; statusLabel: string;
  by: string; at: string; archived: { at: string; by: string | null; reason: string | null } | null;
  // PEOPLE: everyone it's for, seen or not yet. ALL: everyone who has seen it so far.
  recipients: { name: string; seenAt: string | null; where: string | null }[];
  seenCount: number;
};
export function officeView(
  m: MessageRow & { createdBy: string; archivedBy: string | null; archiveReason: string | null },
  recipients: RecipientRow[], seen: SeenRow[], names: Map<string, string>, today: string,
): OfficeMessage {
  const mine = seen.filter((s) => s.messageId === m.id).sort((a, b) => String(iso(a.seenAt)).localeCompare(String(iso(b.seenAt))));
  const byKey = new Map(mine.map((s) => [s.personKey, s]));
  const status = statusOf(m, today);
  const list = m.audience === "PEOPLE"
    ? recipients.filter((r) => r.messageId === m.id).map((r) => {
        const s = byKey.get(r.resourceId);
        return { name: names.get(r.resourceId) ?? r.name, seenAt: s ? iso(s.seenAt) : null, where: s?.where ?? null };
      }).sort((a, b) => a.name.localeCompare(b.name))
    : mine.map((s) => ({
        name: s.resourceId ? names.get(s.resourceId) ?? "Someone" : `${s.hireName ?? "Hire worker"}${s.hireCompany ? ` (${s.hireCompany})` : ""}`,
        seenAt: iso(s.seenAt), where: s.where,
      }));
  return {
    id: m.id, text: m.text, audience: m.audience === "PEOPLE" ? "PEOPLE" : "ALL", showUntil: m.showUntil, status, statusLabel: STATUS_LABEL[status],
    by: m.createdBy, at: iso(m.createdAt)!, archived: m.archivedAt ? { at: iso(m.archivedAt)!, by: m.archivedBy, reason: m.archiveReason } : null,
    recipients: list, seenCount: mine.length,
  };
}
