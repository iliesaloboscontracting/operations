// "Waiting on you" (Directors, 10 Nov 2026; Ilies: "yes go and deploy once it passes"): the missing information only
// the directors themselves can give - questions to answer, approvals, figures only they hold (contract values),
// decisions not made yet. The plain rules: the groups and their order, what counts towards "N things waiting", the
// "why it matters" sentences, how long something has waited, who a waiting contract value is waiting on, and the
// Monday-morning phone alert's decision and words. No server imports; `npm test` (waiting.test.ts).
//
// Office gaps (rates, tickets, rego, job numbers) never come here - they are Operations' work, not the directors'.
import { cannotApprove, samePerson, type ChangeUser } from "../changes/rules";
import { sameUser } from "../samePerson";
import { isOwner } from "../owner";
import { daysWaiting } from "../infoRequests/rules";
import { KPIS } from "../insights/dictionary";

export const GROUPS = [
  { id: "QUESTIONS", title: "Questions waiting for your answer" },
  { id: "APPROVALS", title: "Approvals waiting" },
  { id: "FIGURES", title: "Figures only the directors hold" },
  { id: "DECISIONS", title: "Decisions not made yet" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

export type ItemKind = "QUESTION" | "CHANGE" | "BUDGET" | "BUDGETS_INFO" | "NO_CONTRACT_VALUE" | "NO_BUDGET" | "NOT_SET_UP";

// The one thing to do about an item, right there. Every href is a Directors page - never an Operations one.
export type WaitingAction =
  | { type: "ANSWER"; queryId: string }                 // the existing answer card (text + optional file)
  | { type: "APPROVE"; changeId: string }               // the existing change card (fingerprint + "before" re-check)
  | { type: "OPEN"; href: string; label: string }       // a Directors page (budgets)
  | { type: "ENTER_VALUE"; projectId: string }          // a contract-value proposal, approved by the other director
  | { type: "SEND_TO_ILIES"; key: string }              // a one-to-one office-chat message to the owner
  | { type: "NONE"; text: string };                     // nothing to tap: who it's waiting on, or "ask Ilies"

export type WaitingItem = {
  id: string;
  group: GroupId;
  kind: ItemKind;
  what: string;   // what's missing
  why: string;    // why it matters - one plain sentence
  since: string | null; // ISO - waiting since
  counts: boolean; // something this person can do now - counts towards "N things waiting"
  action: WaitingAction;
  sentAt?: string | null; // when this login last sent it to Ilies (decisions not made yet)
};

// ---------- why it matters ----------

export const WHY = {
  QUESTION: "Ilies is waiting on your answer before he can close this.",
  CHANGE: "The job's value only changes once a second director approves it - Tracking keeps the old figure until then.",
  BUDGET: "Daily-log hours can only be measured against a budget once it's approved.",
  BUDGETS_INFO: "Budgets come from Estimating; it couldn't be reached just now, so nothing is shown for them.",
  NO_CONTRACT_VALUE: "Tracking can't warn at 80% / 100% of the job's value.",
  NO_BUDGET: "The crew's daily-log hours on this job can't be checked against a budget.",
} as const;

// A question's own "why" (an information request carries one) is used when it was given.
export function whyItMatters(kind: ItemKind, extra: { questionWhy?: string | null; kpiName?: string } = {}): string {
  if (kind === "QUESTION") {
    const own = (extra.questionWhy ?? "").replace(/\s+/g, " ").trim();
    return own ? (/[.!?]$/.test(own) ? own : `${own}.`) : WHY.QUESTION;
  }
  if (kind === "NOT_SET_UP") return `The Directors screen can't show ${(extra.kpiName ?? "this").toLowerCase()} until it's set up.`;
  return WHY[kind];
}

// ---------- how long ----------

export function waitingText(since: string | Date | null, now: Date): string {
  if (!since) return "";
  const d = daysWaiting(new Date(since), now);
  if (d === 0) return "since today";
  if (d === 1) return "1 day";
  if (d < 14) return `${d} days`;
  const w = Math.floor(d / 7);
  return `${w} weeks`;
}

// ---------- decisions not made yet ----------

// The Directors screen started on 24 Oct 2026 (Director Insights Phase 1): the "not available yet" items have been
// missing since then.
export const DIRECTORS_SCREEN_START = "2026-10-24T00:00:00.000+11:00";

// The KPI dictionary's BLOCKED entries (the overview's "Not available yet") with what's needed - one line each.
export const notSetUp = () =>
  KPIS.filter((k) => k.status === "BLOCKED").map((k) => ({ key: k.id, name: k.name, needed: k.source }));

// The message to Ilies when a director asks for one to be set up (no amounts - it's words from the dictionary only).
export const askIliesText = (name: string, needed: string) =>
  `From the Directors screen (Waiting on you): please set up "${name}" - it isn't available yet. What's needed: ${needed}.`;

// A director may send it again a week after the last time.
export const ASK_AGAIN_DAYS = 7;
export const canAskAgain = (lastSent: Date | null, now: Date) => !lastSent || now.getTime() - lastSent.getTime() >= ASK_AGAIN_DAYS * 86_400_000;

// ---------- counting ----------

export function groupItems(items: WaitingItem[]) {
  const order = (g: GroupId) => GROUPS.findIndex((x) => x.id === g);
  const t = (i: WaitingItem) => (i.since ? new Date(i.since).getTime() : Number.MAX_SAFE_INTEGER);
  return GROUPS.map((g) => {
    // Oldest first; the ones with nothing to do sit after the ones that count.
    const rows = items.filter((i) => i.group === g.id).sort((a, b) => Number(b.counts) - Number(a.counts) || t(a) - t(b) || a.what.localeCompare(b.what));
    return { id: g.id, title: g.title, items: rows, count: rows.filter((i) => i.counts).length, order: order(g.id) };
  });
}
export const countWaiting = (items: WaitingItem[]) => items.filter((i) => i.counts).length;

// ---------- who a contract value waits on ----------

export type Login = ChangeUser & { active: boolean };
// The people (one name per person - Nick's two logins are one person) who may approve this proposal now.
export function whoCanApprove(logins: Login[], p: { kind: "PROJECT_CONTRACT_VALUE"; requestedBy: string; requestedByUserId: string | null; sourcePerson: string | null }): string[] {
  const ok = logins.filter((u) => u.active && !cannotApprove(u, { ...p, proposedByAi: false }));
  const people: Login[] = [];
  for (const u of ok) if (!people.some((x) => sameUser(x.id, u.id) || samePerson(x.name, u.name))) people.push(u);
  return people.map((u) => u.name);
}
export function waitingOnText(names: string[]): string {
  if (!names.length) return "Proposed - nobody else can approve it yet (contract values need a second director login). Ask Ilies.";
  return `Proposed - waiting on ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`} to approve.`;
}

// ---------- the Monday-morning alert ----------

export const REMINDER_KIND = "DIRECTOR_WAITING"; // a ShiftReminder row per person per week - survives a restart
export const reminderOff = (v: string | undefined = process.env.DIRECTOR_WAITING_REMINDER) => (v ?? "").trim().toLowerCase() === "off";

const sydneyParts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hourCycle: "h23",
}).formatToParts(d).map((x) => [x.type, x.value]));

// Monday 8:00 to 11:59 Sydney time -> that Monday's date (the week's key); any other time -> null.
export function mondayWindow(now: Date): string | null {
  const p = sydneyParts(now);
  if (p.weekday !== "Mon") return null;
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (mins < 8 * 60 || mins >= 12 * 60) return null;
  return `${p.year}-${p.month}-${p.day}`;
}
export const reminderKey = (personId: string, week: string) => `${personId}:${week}`;

export function mondayDecision(x: { off: boolean; week: string | null; active: boolean; alreadySent: boolean; hasDevice: boolean; n: number }):
  { send: true } | { send: false; why: string } {
  if (x.off) return { send: false, why: "switched off" };
  if (!x.week) return { send: false, why: "not Monday morning" };
  if (!x.active) return { send: false, why: "not active" };
  if (x.alreadySent) return { send: false, why: "already sent this week" };
  if (!x.hasDevice) return { send: false, why: "phone alerts off" };
  if (x.n <= 0) return { send: false, why: "nothing waiting" };
  return { send: true };
}

// The phone alert: a count and where to look - never an amount or a name.
export const reminderPush = (n: number) => ({
  title: "Directors",
  body: `${n} thing${n === 1 ? "" : "s"} waiting on you - open the Directors screen`,
  url: "/directors/waiting",
  tag: "directors-waiting",
});

// The directors the Monday alert goes to: director access, active, never the owner (he's who they reply to), one per
// person (Nick's two logins are one person - his DIRECTOR login counts for him, the alert reaches both logins' phones).
export type Person = { primary: Login; ids: string[] };
export function directorPeople(logins: (Login & { email: string })[]): Person[] {
  const eligible = logins.filter((u) => u.active && u.directorAccess && !isOwner(u.email));
  const people: Person[] = [];
  for (const u of [...eligible].sort((a, b) => Number(b.role === "DIRECTOR") - Number(a.role === "DIRECTOR") || a.id.localeCompare(b.id))) {
    const p = people.find((x) => x.ids.some((id) => sameUser(id, u.id)) || samePerson(x.primary.name, u.name));
    if (p) p.ids.push(u.id);
    else people.push({ primary: u, ids: [u.id] });
  }
  return people;
}
