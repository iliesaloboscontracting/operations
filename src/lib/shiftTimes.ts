// Reading the board's free-text job times ("7am", "3:30pm", "15:30") and
// Sydney wall-clock <-> real time (24 Oct 2026). Used for the supervisors'
// 20-minute sign-out reminder, the office's "sign out selected" default time
// and the check for jobs with missing or unclear times. No server imports -
// the Sign-ins page uses it too.

// Minutes after midnight, or null when the text isn't a clear time.
// "3pm" / "3:30pm" / "3.30 pm" / "15:30" / "0630" are clear; "3:30" with no
// am/pm and an hour of 1-5 is not (could be 3:30am or pm) - nor is "TBC".
export function parseClock(text: string | null | undefined): number | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/.exec(t);
  if (m) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    if (m[3] === "am" && h === 12) h = 0;
    if (m[3] === "pm" && h !== 12) h += 12;
    return h * 60 + min;
  }
  m = /^(\d{1,2})[:.]?(\d{2})$/.exec(t);
  if (m) {
    const h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    if (h >= 1 && h <= 5) return null; // 3:30 - morning or afternoon? ask
    return h * 60 + min;
  }
  return null;
}

const SYD = "Australia/Sydney";
function sydneyOffsetMs(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: SYD, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime();
}
// "2026-10-26T06:00" (Sydney wall clock) -> the real moment, or null.
export function fromSydneyLocal(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = asUtc - sydneyOffsetMs(new Date(asUtc));
  t = asUtc - sydneyOffsetMs(new Date(t)); // second pass settles daylight-saving edges
  return new Date(t);
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// When a job on `day` (YYYY-MM-DD) finishes, or null if the board's times
// aren't clear. A night shift, or a finish earlier than the start, ends the
// next morning.
export function jobFinish(day: string, shift: string, startTime: string | null, endTime: string | null): Date | null {
  const end = parseClock(endTime);
  if (end == null) return null;
  const start = parseClock(startTime);
  const nextDay = (start != null && end <= start) || (shift === "NIGHT" && end < 12 * 60);
  return fromSydneyLocal(`${nextDay ? addDays(day, 1) : day}T${hhmm(end)}`);
}

// Why a job's times need a look (for the daily check): null when both are clear.
export function timesProblem(startTime: string | null, endTime: string | null): string | null {
  if (!startTime?.trim() && !endTime?.trim()) return "no start or finish time";
  if (!endTime?.trim()) return "no finish time";
  if (parseClock(endTime) == null) return `finish time "${endTime}" isn't clear`;
  if (!startTime?.trim()) return "no start time";
  if (parseClock(startTime) == null) return `start time "${startTime}" isn't clear`;
  return null;
}

// A job's times, falling back to its project's usual hours for that shift
// when the job itself has none (24 Oct 2026 - copied-forward jobs had been
// carrying blank times). Never invented: no job or project times -> null.
type ProjectHours = { dayStart: string | null; dayEnd: string | null; nightStart: string | null; nightEnd: string | null } | null | undefined;
export function projectHours(project: ProjectHours, shift: string) {
  if (!project) return { start: null, end: null };
  return shift === "NIGHT" ? { start: project.nightStart, end: project.nightEnd } : { start: project.dayStart, end: project.dayEnd };
}
export function effectiveTimes(job: { shift: string; startTime: string | null; endTime: string | null }, project: ProjectHours) {
  const usual = projectHours(project, job.shift);
  return { start: job.startTime?.trim() || usual.start || null, end: job.endTime?.trim() || usual.end || null };
}
// A project that only works nights (night hours set, no day hours) - e.g.
// Coles, Mt Hutton (Ilies, 24 Oct 2026: "Mt Hutton is night works"). Its jobs
// go on the board, and copy forward, as night shifts.
export const nightOnly = (p: { dayStart?: string | null; dayEnd?: string | null; nightStart?: string | null } | null | undefined) =>
  !!p && !p.dayStart && !p.dayEnd && !!p.nightStart;
