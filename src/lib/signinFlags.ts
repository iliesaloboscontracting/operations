// Sign-in flags and the "confirm your poster sign-ins" reminder (Ilies, 10 Nov 2026: "do A and B").
// Background: on Mon 9 Nov hours went missing from the week's timesheets - poster sign-ins left unconfirmed, crew
// signing in hours after the start, staff on the board with no sign-in at all, and four crew signed out together at
// 10:47pm on a 7am-3:30pm job. These are information only: they never block anything and never change hours.
// Plain rules, no server imports (the Sign-ins page and npm test use them too).
import { fromSydneyLocal, jobFinish, parseClock } from "./shiftTimes";

// Every threshold in one place, with plain names.
export const SIGNIN_FLAG_LIMITS = {
  /** "Late sign-in": signed in more than this many minutes after the job's start. */
  lateSignInMinutes: 60,
  /** "Long day": signed out more than this many minutes after the job's finish... */
  lateSignOutMinutes: 120,
  /** ...or signed in for more than this many hours on one line. */
  longShiftHours: 12,
  /** "Signed out together": this many or more signed out by the supervisor / office in the same minute. */
  bulkSignOutPeople: 3,
} as const;

// A: the supervisor's reminder about poster sign-ins still waiting to be confirmed.
export const CONFIRM_REMINDER = {
  /** Day shifts: 3:30pm Sydney on the job's day. */
  dayAtMinutes: 15 * 60 + 30,
  /** Night shifts: this long after the job's finish (the next morning). Unclear night times: no reminder. */
  nightAfterFinishMinutes: 30,
  /** Still sent up to this long after it was due (the server was restarting at the time); never later. */
  windowHours: 4,
  /** ShiftReminder kind - one per job (a job is one day), so once per job per day. */
  kind: "CONFIRM_POSTER",
  /** CONFIRM_REMINDER=off in .env stops it. */
  switchEnv: "CONFIRM_REMINDER",
} as const;

export type SigninFlag = "LATE_IN" | "LONG_SHIFT" | "BULK_OUT";

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 420 -> "7am", 930 -> "3:30pm", 720 -> "12pm", 0 -> "12am".
export function clockLabel(mins: number): string {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
}
const sydParts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
// A moment as Sydney wall-clock text: "3:05pm".
export function sydneyClock(d: Date): string {
  const p = sydParts(d);
  return clockLabel(Number(p.hour) * 60 + Number(p.minute));
}
export function sydneyDay(d: Date): string {
  const p = sydParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

// When a job on `day` starts, or null if the board's start isn't clear ("TBC", "3:30" with no am/pm...).
// A night shift starting before midday (e.g. "12:30am") starts the next morning.
export function jobStartAt(day: string, shift: string, startText: string | null): Date | null {
  const s = parseClock(startText);
  if (s == null) return null;
  const next = shift === "NIGHT" && s < 12 * 60;
  return fromSydneyLocal(`${next ? addDays(day, 1) : day}T${hhmm(s)}`);
}

export type FlagJob = { date: string; shift: string; start: string | null; end: string | null };
export type FlagRow = {
  id: string;
  signInAt: Date;
  signOutAt: Date | null;
  signOutMethod: string | null;
  status: string;
  /** They were already signed in somewhere else (or earlier here) that day - coming on late isn't missing hours. */
  signedInEarlier?: boolean;
};

// 1. Late sign-in: "Signed in 3:05pm – job starts 7am", or null.
export function lateSignIn(row: FlagRow, job: FlagJob): string | null {
  if (row.status === "REJECTED" || row.signedInEarlier) return null;
  const start = jobStartAt(job.date, job.shift, job.start);
  if (!start) return null;
  if (row.signInAt.getTime() - start.getTime() <= SIGNIN_FLAG_LIMITS.lateSignInMinutes * 60_000) return null;
  return `Signed in ${sydneyClock(row.signInAt)} – job starts ${clockLabel(parseClock(job.start)!)}`;
}

// 2. Long after the finish, or a long line: "Signed out 10:47pm – job ends 3:30pm" / "Signed in 13.5h (6am – 7:30pm)".
export function longShift(row: FlagRow, job: FlagJob): string | null {
  if (row.status === "REJECTED" || !row.signOutAt) return null;
  const out = row.signOutAt;
  const finish = jobFinish(job.date, job.shift, job.start, job.end);
  if (finish && out.getTime() - finish.getTime() > SIGNIN_FLAG_LIMITS.lateSignOutMinutes * 60_000) {
    const nextDay = sydneyDay(out) > sydneyDay(finish) ? " (next day)" : "";
    return `Signed out ${sydneyClock(out)}${nextDay} – job ends ${clockLabel(parseClock(job.end)!)}`;
  }
  const hours = (out.getTime() - row.signInAt.getTime()) / 3_600_000;
  if (hours > SIGNIN_FLAG_LIMITS.longShiftHours) {
    return `Signed in ${Math.round(hours * 4) / 4}h (${sydneyClock(row.signInAt)} – ${sydneyClock(out)})`;
  }
  return null;
}

// Several people on one job signed out in the same minute by the supervisor (MANUAL) or the office (OFFICE) -
// row id -> how many and by whom. Crew scanning out themselves never count.
export function bulkSignOuts(rows: FlagRow[]): Map<string, { count: number; by: "supervisor" | "office"; at: Date }> {
  const groups = new Map<string, FlagRow[]>();
  for (const r of rows) {
    if (!r.signOutAt || r.status === "REJECTED" || (r.signOutMethod !== "MANUAL" && r.signOutMethod !== "OFFICE")) continue;
    const key = `${r.signOutMethod}|${Math.floor(r.signOutAt.getTime() / 60_000)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, { count: number; by: "supervisor" | "office"; at: Date }>();
  for (const g of groups.values()) {
    if (g.length < SIGNIN_FLAG_LIMITS.bulkSignOutPeople) continue;
    for (const r of g) out.set(r.id, { count: g.length, by: r.signOutMethod === "OFFICE" ? "office" : "supervisor", at: r.signOutAt! });
  }
  return out;
}

// The new flags for one job's sign-ins, with the words to show. A bulk sign-out is only worth a note on a line
// that's already a long day - signing the crew out together at the finish is normal.
export function flagsForJobRows(rows: FlagRow[], job: FlagJob): Map<string, { flags: SigninFlag[]; notes: Partial<Record<SigninFlag, string>> }> {
  const bulk = bulkSignOuts(rows);
  const out = new Map<string, { flags: SigninFlag[]; notes: Partial<Record<SigninFlag, string>> }>();
  for (const r of rows) {
    const flags: SigninFlag[] = [];
    const notes: Partial<Record<SigninFlag, string>> = {};
    const late = lateSignIn(r, job);
    if (late) { flags.push("LATE_IN"); notes.LATE_IN = late; }
    const long = longShift(r, job);
    if (long) { flags.push("LONG_SHIFT"); notes.LONG_SHIFT = long; }
    const b = bulk.get(r.id);
    if (long && b) { flags.push("BULK_OUT"); notes.BULK_OUT = `${b.count} signed out together at ${sydneyClock(b.at)} by the ${b.by}`; }
    out.set(r.id, { flags, notes });
  }
  return out;
}

// Who on a person-day had signed in before this line began (any job or sign-in point that day).
// key: the person (resource id, or name|company for hire). Rejected lines don't count.
export function signedInEarlierIds(rows: { id: string; key: string; signInAt: Date; status: string }[]): Set<string> {
  const first = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "REJECTED") continue;
    const t = r.signInAt.getTime();
    if (!first.has(r.key) || t < first.get(r.key)!) first.set(r.key, t);
  }
  return new Set(rows.filter((r) => r.status !== "REJECTED" && (first.get(r.key) ?? Infinity) < r.signInAt.getTime()).map((r) => r.id));
}

// The summary strip: "N to confirm · N late · N long day · N no sign-in".
export type SigninFlagSummary = { toConfirm: number; late: number; longDay: number; noSignIn: number };
export function flagSummary(groups: { rows: { flags: string[] }[]; noShows: { id: string; nowhere?: boolean }[] }[]): SigninFlagSummary {
  const rows = groups.flatMap((g) => g.rows);
  const has = (...f: string[]) => rows.filter((r) => f.some((x) => r.flags.includes(x))).length;
  return {
    toConfirm: has("TO_CONFIRM"),
    late: has("LATE_IN"),
    longDay: has("LONG_SHIFT", "LONG_DAY"), // LONG_DAY: office / yard / truck over 14h (unchanged)
    noSignIn: groups.reduce((n, g) => n + g.noShows.filter((s) => s.nowhere).length, 0),
  };
}

// ---------- A: the supervisor's reminder ----------

// Is the reminder due for this job at `now`? Day shift: 3:30pm on its day. Night shift: 30 min after it finishes
// (unclear night times: never). Sent up to 4 hours late (a restart), never after.
export function confirmReminderDue(job: FlagJob, now: Date): boolean {
  let due: Date | null;
  if (job.shift === "NIGHT") {
    const finish = jobFinish(job.date, job.shift, job.start, job.end);
    due = finish ? new Date(finish.getTime() + CONFIRM_REMINDER.nightAfterFinishMinutes * 60_000) : null;
  } else {
    due = fromSydneyLocal(`${job.date}T${hhmm(CONFIRM_REMINDER.dayAtMinutes)}`);
  }
  if (!due) return false;
  const since = now.getTime() - due.getTime();
  return since >= 0 && since <= CONFIRM_REMINDER.windowHours * 3_600_000;
}

const isLead = (role: string | null | undefined) => role === "Supervisor" || role === "Lead";
// Whose phones get it: the SUPERVISOR links of the people on the board as Supervisor / Lead on that job; if none of
// them holds a link, any SUPERVISOR link held by someone on the job (how the other site reminders target); plus
// the job's hand-over links. Link ids, no repeats.
export function confirmReminderTargets(
  crew: { resourceId: string; role: string | null }[],
  supervisorLinks: { id: string; resourceId: string | null }[],
  handoverLinkIds: string[],
): string[] {
  const onJob = new Set(crew.map((c) => c.resourceId));
  const leads = new Set(crew.filter((c) => isLead(c.role)).map((c) => c.resourceId));
  const mine = supervisorLinks.filter((l) => l.resourceId && onJob.has(l.resourceId));
  const leadLinks = mine.filter((l) => leads.has(l.resourceId!));
  return [...new Set([...(leadLinks.length ? leadLinks : mine).map((l) => l.id), ...handoverLinkIds])];
}

export function confirmReminderText(count: number, site: string) {
  return {
    title: "Sign-ins to confirm",
    body: `${count} sign-in${count === 1 ? "" : "s"} at ${site} ${count === 1 ? "is" : "are"} waiting for you to confirm – open your link.`,
  };
}
