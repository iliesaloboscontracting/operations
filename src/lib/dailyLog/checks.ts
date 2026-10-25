// Daily site log read-time checks (Task K): the missing log, the split no
// longer matching sign-ins, crew entered by hand, when the 19:00 reminder is
// due, weekly progress due, and labour hours vs the approved budget. Worked
// out when a page loads - nothing stored, no list of their own (Ilies removed
// the Attention tab; these show in Day Review and the supervisor's reminder).
// Hours vs budget at "Act" is also the one Directors finding
// (LABOUR_HOURS_VS_BUDGET). No server imports; `npm test`.
import { fromSydneyLocal } from "../shiftTimes";
import { SPLIT_TOLERANCE, A2_RULES } from "./rules";

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const nextDay = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// Sydney's calendar day for a moment.
export const sydneyDay = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

// When a job's log is "due": 19:00 on the job's day; a night shift, 2 hours
// after it finishes (the next morning; 08:00 when the board has no clear finish).
export function logDueAt(job: { date: string; shift: string; finish: Date | null }): Date {
  const r = A2_RULES.DAILY_LOG_REMINDER;
  if (job.shift === "NIGHT") {
    return job.finish ? new Date(job.finish.getTime() + r.nightAfterFinishMinutes * 60_000) : fromSydneyLocal(`${nextDay(job.date)}T08:00`)!;
  }
  return fromSydneyLocal(`${job.date}T${hhmm(r.atMinutes)}`)!;
}

// The reminder's window: from the due time until 21:00 that evening (a night
// shift: 2 hours after the due time, and still never after 21:00). Outside
// it, no push - the next morning's brief carries it instead.
export function reminderWindow(job: { date: string; shift: string; finish: Date | null }): { from: Date; until: Date } | null {
  const r = A2_RULES.DAILY_LOG_REMINDER;
  const from = logDueAt(job);
  const nineAt = fromSydneyLocal(`${sydneyDay(from)}T${hhmm(r.noneAfterMinutes)}`)!;
  const until = job.shift === "NIGHT" ? new Date(Math.min(from.getTime() + 2 * 3_600_000, nineAt.getTime())) : nineAt;
  return from < until ? { from, until } : null;
}

export const reminderDue = (job: { date: string; shift: string; finish: Date | null }, now: Date) => {
  const w = reminderWindow(job);
  return !!w && now >= w.from && now < w.until;
};

// The red "No site log" badge: a pilot supervisor's job that ran (someone
// signed in, or crew on the board), no log yet, and past its due time.
export const isMissingLog = (j: { pilot: boolean; ran: boolean; hasLog: boolean; dueAt: Date }, now: Date) =>
  j.pilot && j.ran && !j.hasLog && now >= j.dueAt;

// Amber "split 46.5 h, signed now 48.0 h": sign-ins changed after the latest
// version (a hand-entered crew total isn't compared - it's flagged on its own).
export const splitMismatch = (log: { crewOk: boolean; labourHours: number }, signedNow: number) =>
  log.crewOk && Math.abs(signedNow - log.labourHours) > SPLIT_TOLERANCE + 1e-9;

// ---------- weekly % complete ----------

const dow = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 Sunday .. 6 Saturday
export const weekStartOf = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((dow(day) + 6) % 7)); return d.toISOString().slice(0, 10); };

// Asked on Fridays (and over the weekend), or on the first log of the next
// week if last week's was missed - until this week's is in.
export function progressDue(today: string, p: { thisWeek: boolean; lastWeek: boolean; workedLastWeek: boolean }) {
  if (p.thisWeek) return false;
  const d = dow(today);
  return d === 5 || d === 6 || d === 0 || (p.workedLastWeek && !p.lastWeek);
}

// ---------- labour hours vs the approved budget ----------

// The job's approved budget in Estimating: an APPROVED revision whose job or
// quote number is the project's (the same numbering G5 matches won tenders
// on); the latest revision if there are several.
const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
export function pickApprovedBudget<T extends { estimate_id: string; revision: number; status: string; jobNo: string; quoteNo: string }>(
  rows: T[], project: { jobNo: string | null; quoteNo: string | null },
): T | null {
  const keys = new Set([norm(project.jobNo), norm(project.quoteNo)].filter(Boolean));
  if (!keys.size) return null;
  const hits = rows.filter((r) => r.status === "APPROVED" && (keys.has(norm(r.jobNo)) || keys.has(norm(r.quoteNo))));
  return hits.sort((a, b) => b.revision - a.revision)[0] ?? null;
}

export const HOURS_VS_BUDGET = { watchPoints: 15, actPoints: 30, minLogs: 2, draft: true }; // draft thresholds (design §11.4)
export type BudgetStatus = "AHEAD" | "ON_TRACK" | "WATCH" | "ACT" | "NOT_ENOUGH";

export type BudgetPackageHours = { packageId: string; code: string | null; name: string; labourHrs: number };
export type HoursVsBudgetRow = {
  code: string; name: string; packages: number; budgetHours: number; loggedHours: number;
  usedPct: number | null; pctComplete: number | null; gapPoints: number | null; status: BudgetStatus;
};

// Per activity code: hours used % (logged labour ÷ budget labour hours)
// minus the latest weekly % complete. More than 15 points over = Watch, more
// than 30 = Act; 15 under = Ahead. Packages sharing a code are added together
// (their % weighted by budget hours). Needs at least 2 logs and a weekly %.
export function hoursVsBudget(
  packages: BudgetPackageHours[],
  logged: Map<string, number>, // labour hours by code, latest version of each log
  logCount: number,
  pct: Map<string, number>, // latest % by progressKey (pkg:<id> / code:<code>)
): HoursVsBudgetRow[] {
  const byCode = new Map<string, BudgetPackageHours[]>();
  for (const p of packages) if (p.code && p.labourHrs > 0) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
  const rows: HoursVsBudgetRow[] = [];
  for (const [code, pk] of byCode) {
    const budgetHours = pk.reduce((s, p) => s + p.labourHrs, 0);
    const loggedHours = Math.round((logged.get(code) ?? 0) * 100) / 100;
    const reported = pk.map((p) => ({ p, v: pct.get(`pkg:${p.packageId}`) ?? pct.get(`code:${code}`) })).filter((x) => x.v != null);
    const pctComplete = reported.length === pk.length
      ? Math.round(reported.reduce((s, x) => s + (x.v as number) * x.p.labourHrs, 0) / budgetHours)
      : null;
    const usedPct = Math.round((loggedHours / budgetHours) * 100);
    const enough = logCount >= HOURS_VS_BUDGET.minLogs && pctComplete != null;
    const gapPoints = enough ? usedPct - (pctComplete as number) : null;
    const status: BudgetStatus = gapPoints == null ? "NOT_ENOUGH"
      : gapPoints > HOURS_VS_BUDGET.actPoints ? "ACT"
      : gapPoints > HOURS_VS_BUDGET.watchPoints ? "WATCH"
      : gapPoints < -HOURS_VS_BUDGET.watchPoints ? "AHEAD" : "ON_TRACK";
    rows.push({ code, name: pk.length === 1 ? pk[0].name : `${pk[0].name} +${pk.length - 1} more`, packages: pk.length, budgetHours: Math.round(budgetHours * 10) / 10, loggedHours, usedPct, pctComplete, gapPoints, status });
  }
  const rank: Record<BudgetStatus, number> = { ACT: 0, WATCH: 1, ON_TRACK: 2, AHEAD: 3, NOT_ENOUGH: 4 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || a.code.localeCompare(b.code));
}
