// Yard jobs (Stage A, Ilies, 4 Nov 2026): the office is upstairs, the yard
// downstairs. Tools, materials and deliveries a supervisor asks for can go
// straight onto the yard's list; the yard gets the gear ready, photographs it,
// says if anything is missing, and the supervisor (or the yard) marks it
// collected. Admins can send any open site request to the yard, pull one back,
// or decline it. The plain rules - who may do what, which status moves are
// allowed, and how the list is grouped. No database code (used in browsers and
// `npm test`), and nothing here ever carries a dollar figure.
import { OFFICE_KINDS } from "../requestTypes";
import { assertNoMoney } from "../moneyGuard";

// The three kinds a supervisor can send straight to the yard (default Yard on the form).
export const YARD_KINDS = ["TOOLS", "MATERIALS", "DELIVERY"];
export const mayChooseYard = (kind: string) => YARD_KINDS.includes(kind);
// "Send to: Yard / Office" from the form - only ever Yard when asked for, on one of the three kinds
// (an older phone that doesn't send the choice keeps today's behaviour: the office).
export const sendsToYard = (kind: string, sendTo: unknown) => mayChooseYard(kind) && sendTo === "YARD";

// On the yard's list. READY = ready for collection; collected = DONE with this outcome.
export const YARD_STATUSES = ["YARD", "READY"];
export const COLLECTED = "Collected";
export const isWithYard = (status: string) => YARD_STATUSES.includes(status);

// An Admin may send a site request to the yard while it's open with the office: new, seen,
// waiting on the supervisor, with Alex, being done by Ilies, or sent back. Never an office
// kind (queries / actions), never one already with the yard, never a closed one.
const SENDABLE = ["SENT", "SEEN", "NEEDS_INFO", "TODO", "ACTIONING", "MINE", "CANT_DO"];
export function sendToYardError(r: { kind: string; status: string }): string | null {
  if (OFFICE_KINDS.includes(r.kind)) return "Directors and accounts items never go to the yard.";
  if (isWithYard(r.status)) return "It's already with the yard.";
  if (!SENDABLE.includes(r.status)) return "This one is closed - reopen it first.";
  return null;
}
export function pullBackError(r: { status: string }): string | null {
  return isWithYard(r.status) ? null : "It isn't with the yard.";
}
// While the yard has it, the Admin's other decisions wait until it's pulled back
// (declining, reminders and "Collected" still work).
export const BLOCKED_WHILE_WITH_YARD = ["APPROVE", "MINE", "ASK", "DONE"];
export function adminBlockedByYard(action: string, status: string): string | null {
  return isWithYard(status) && BLOCKED_WHILE_WITH_YARD.includes(action) ? "It's with the yard - pull it back first." : null;
}

// What the yard (or whoever collects) does to a yard job.
export type YardAction = "ON_IT" | "READY" | "CANT_DO" | "COLLECTED";
export const YARD_ACTIONS: YardAction[] = ["ON_IT", "READY", "CANT_DO", "COLLECTED"];
export function yardActionError(action: string, status: string): string | null {
  switch (action) {
    case "ON_IT":
    case "READY":
    case "CANT_DO":
      return status === "YARD" ? null : status === "READY" ? "It's already ready for collection." : "It isn't on the yard's list any more.";
    case "COLLECTED":
      return status === "READY" ? null : status === "YARD" ? "It isn't ready for collection yet." : "It isn't waiting to be collected.";
    default:
      return "Unknown action.";
  }
}

// Who may act on the yard's list: the yard's shared phone link, the YARD login and
// Admins. Managers and the coordinator only look. The supervisor who asked may only
// mark their own one collected (checked by the link route).
export type YardActor = { via: "LINK"; kind: string; shared: boolean } | { via: "LOGIN"; role: string };
export const isYardLink = (l: { kind: string; shared: boolean }) => l.kind === "OFFICE" && l.shared;
export const isYardLogin = (role: string) => role === "YARD";
export function mayActOnYard(a: YardActor): boolean {
  return a.via === "LINK" ? isYardLink(a) : a.role === "ADMIN" || isYardLogin(a.role);
}

// ---------- the list ----------

// The default view: open yard jobs, ready ones not yet collected, and those collected in
// the last 7 days.
export const COLLECTED_DAYS = 7;
export function onYardList(r: { status: string; outcome: string | null; doneAt: string | Date | null; yardAt: string | Date | null }, now = new Date()) {
  if (!r.yardAt) return false;
  if (isWithYard(r.status)) return true;
  return r.status === "DONE" && r.outcome === COLLECTED && !!r.doneAt && new Date(r.doneAt).getTime() >= now.getTime() - COLLECTED_DAYS * 86_400_000;
}

// The Sydney calendar day of a time, "YYYY-MM-DD".
export const sydneyDay = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(iso));
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function dayLabel(day: string, today: string) {
  const nice = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  if (day === today) return `Today - ${nice}`;
  if (day === addDays(today, 1)) return `Tomorrow - ${nice}`;
  if (day < today) return `${nice} - overdue`;
  return nice;
}

type Listable = { status: string; neededBy: string; site: string; priority: string };
const RANK: Record<string, number> = { URGENT: 0, HIGH: 1, LOW: 2 };
// Open jobs grouped by needed-by day (Sydney), then site; most urgent and soonest first.
// Collected ones go in their own list, newest first.
export function groupYardJobs<T extends Listable & { collectedAt?: string | null }>(rows: T[], now = new Date()) {
  const today = sydneyDay(now);
  const open = rows.filter((r) => isWithYard(r.status));
  const days = new Map<string, Map<string, T[]>>();
  for (const r of open) {
    const day = sydneyDay(r.neededBy);
    const sites = days.get(day) ?? new Map<string, T[]>();
    sites.set(r.site, [...(sites.get(r.site) ?? []), r]);
    days.set(day, sites);
  }
  const groups = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, sites]) => ({
      day,
      label: dayLabel(day, today),
      overdue: day < today,
      sites: [...sites.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([site, jobs]) => ({
          site,
          jobs: [...jobs].sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || new Date(a.neededBy).getTime() - new Date(b.neededBy).getTime()),
        })),
    }));
  const collected = rows
    .filter((r) => r.status === "DONE")
    .sort((a, b) => new Date(b.collectedAt ?? 0).getTime() - new Date(a.collectedAt ?? 0).getTime());
  return { groups, collected, open: open.length, ready: open.filter((r) => r.status === "READY").length };
}

// Name typed on the shared yard phone, as every shared-link action stores it: "Yard - Sam".
// YD-004 (Ilies approved 4 Nov 2026): a "name" with a dollar figure in it is refused (null -> the
// route answers 400 "Put your name in") - it would otherwise ride readyBy / onItBy / collectedBy onto
// the supervisor's link. assertNoMoney is a plain regex with no imports - safe in the browser too.
export const sharedWho = (label: string, who: unknown) => {
  const w = typeof who === "string" ? who.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return w.length >= 2 && assertNoMoney(w) ? `${label} - ${w}` : null;
};
