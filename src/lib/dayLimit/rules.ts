// Days-a-week limit (Ilies, 12 Nov 2026: "for darnell we need a new rule he is only allowed to work 3 days a week and no
// more"). A per-person setting on the Labour register (Resource.maxDaysPerWeek, null = no limit), set by an Admin only.
//   - The week is Monday to Sunday, by Sydney date.
//   - A "day" is a calendar date the person is on the board (any job, day or night shift); several jobs or shifts on
//     the same date count once.
//   - The board REFUSES the extra day (an Admin may go over it with a reason, kept on record); copying a day skips
//     the person on that date and says so.
//   - Sign-ins are never refused: a sign-in date over the limit is FLAGGED (Sign-ins, Timesheets) and the Admins get
//     one phone alert per person per day. Hours are never changed. No money anywhere.
// Plain rules, no server imports (npm test, the board and the Sign-ins page use them).

/** A limit is a whole number of days, 1 to 6 (7 would be no limit at all); blank = no limit. */
export const DAY_LIMIT_RANGE = { min: 1, max: 6 } as const;
/** ShiftReminder kind for the Admins' alert - one row per person per day claims it (jobId = `<resourceId>|<date>`). */
export const OVER_LIMIT_ALERT_KIND = "OVER_DAY_LIMIT";
/** BoardEdit action for an Admin's override (the reason in its detail). */
export const OVERRIDE_ACTION = "LIMIT_OVERRIDE";
/** OVER_DAY_LIMIT_ALERT=off in .env stops the phone alert (the flag still shows). */
export const ALERT_SWITCH = "OVER_DAY_LIMIT_ALERT";

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s));

// The Sydney calendar date of a moment ("2026-11-15T14:30Z" is Mon 16 Nov 1:30am in Sydney -> "2026-11-16").
export function sydneyDateOf(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// The Monday of the Mon-Sun week a calendar date (YYYY-MM-DD, already a Sydney date) falls in.
export function weekMonday(date: string): string {
  const ms = utc(date);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return isoOf(ms - ((dow + 6) % 7) * DAY_MS);
}
export const weekSunday = (date: string) => isoOf(utc(weekMonday(date)) + 6 * DAY_MS);
export const sameWeek = (a: string, b: string) => weekMonday(a) === weekMonday(b);

// The distinct calendar dates, oldest first.
export const distinctDates = (dates: string[]) => [...new Set(dates.filter(isIso))].sort();

// A stored limit as the rule reads it: a whole number 1-6, else no limit.
export function limitOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= DAY_LIMIT_RANGE.min && v <= DAY_LIMIT_RANGE.max ? v : null;
}

// What a form or API body may set: "" / null = no limit; a whole number 1-6. Anything else is refused with words.
export function parseLimitInput(v: unknown): { value: number | null } | { error: string } {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { value: null };
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < DAY_LIMIT_RANGE.min || n > DAY_LIMIT_RANGE.max) {
    return { error: `Days a week must be a whole number from ${DAY_LIMIT_RANGE.min} to ${DAY_LIMIT_RANGE.max}, or blank for no limit.` };
  }
  return { value: n };
}

// "2026-11-09" -> "Mon 9".
export function shortDay(date: string): string {
  const d = new Date(utc(date));
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()}`;
}
// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11 -> "11th", 22 -> "22nd".
export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
// The board tag: "3 d/wk".
export const limitTag = (limit: number) => `${limit} d/wk`;

export type LimitCheck = { ok: true } | { ok: false; limit: number; already: string[] };

// Would putting this person on `target` take them over their limit? `onBoard` = every date they're already on the
// board (any jobs, any week - only the target's week counts; leave out the assignment being moved). A date they're
// already on never counts again, so a second job or shift that day is always fine.
export function checkDay(limit: number | null | undefined, onBoard: string[], target: string): LimitCheck {
  const max = limitOf(limit);
  if (max == null) return { ok: true };
  const already = distinctDates(onBoard).filter((d) => sameWeek(d, target));
  if (already.includes(target)) return { ok: true };
  if (already.length + 1 <= max) return { ok: true };
  return { ok: false, limit: max, already };
}

// "Darnell is limited to 3 days a week – already on Mon 9, Tue 10, Wed 11."
export function limitMessage(name: string, limit: number, already: string[]): string {
  return `${name} is limited to ${limit} day${limit === 1 ? "" : "s"} a week – already on ${already.map(shortDay).join(", ")}.`;
}

// An Admin may go over the limit, with a reason (kept on record). A Manager can't.
export type OverrideDecision = { ok: true; reason: string } | { ok: false; status: number; error: string };
export function overrideDecision(role: string | null | undefined, reason: unknown): OverrideDecision {
  if (role !== "ADMIN") return { ok: false, status: 403, error: "Only an Admin can go over a days-a-week limit." };
  const r = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  if (r.length < 3) return { ok: false, status: 400, error: "Say why this person is going over their days-a-week limit (kept on record)." };
  return { ok: true, reason: r };
}
// The override's line in the board history: "Darnell: 4th day Thu 12 (limit 3 d/wk) – reason: short-staffed".
export function overrideNote(name: string, limit: number, already: string[], target: string, reason: string): string {
  return `${name}: ${ordinal(distinctDates([...already, target]).length)} day ${shortDay(target)} (limit ${limitTag(limit)}) – reason: ${reason}`;
}

// Copy day: which people to leave off the target date. `people` = each person the copy would place there, with their
// limit and the dates they're on the board now. Everyone else is untouched.
export type CopyPerson = { resourceId: string; name: string; limit: number | null | undefined; onBoard: string[] };
export function copySkips(people: CopyPerson[], target: string): { skip: Set<string>; notes: string[] } {
  const skip = new Set<string>();
  const notes: string[] = [];
  for (const p of people) {
    if (skip.has(p.resourceId)) continue;
    const c = checkDay(p.limit, p.onBoard, target);
    if (c.ok) continue;
    skip.add(p.resourceId);
    notes.push(`${p.name} not copied to ${shortDay(target)} – ${c.limit}-day limit`);
  }
  return { skip, notes };
}

// Sign-ins: the dates that took the person over their limit (the 4th, 5th... distinct sign-in date of a Mon-Sun week),
// each with its place in the week. `dates` = their non-rejected sign-in dates (any weeks).
export function overLimitDates(limit: number | null | undefined, dates: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const max = limitOf(limit);
  if (max == null) return out;
  const byWeek = new Map<string, string[]>();
  for (const d of distinctDates(dates)) byWeek.set(weekMonday(d), [...(byWeek.get(weekMonday(d)) ?? []), d]);
  for (const week of byWeek.values()) week.forEach((d, i) => { if (i + 1 > max) out.set(d, i + 1); });
  return out;
}
// "Over 3-day limit (4th day this week)".
export const overLimitNote = (limit: number, nth: number) => `Over ${limit}-day limit (${ordinal(nth)} day this week)`;
// The Admins' phone alert, names and dates only.
export function overLimitAlert(name: string, limit: number, nth: number, date: string) {
  return { title: `${name}: over ${limit}-day limit`, body: `${name} signed in on ${shortDay(date)} – the ${ordinal(nth)} day this week (limit ${limitTag(limit)}). Hours are recorded as usual.` };
}
