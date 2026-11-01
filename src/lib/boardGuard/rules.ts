// Allocation guard (2 Nov 2026). Ilies changed Sunday's board after sending Monday's - he meant Monday - so Monday's
// sheet went out without the change: "I need the system to learn and say, hey, did you actually mean this?".
// The plain rules, no server imports: when to ask "did you mean another day?" before a change or a send, how the board
// learns which day each person usually works on at each time of day, and what changed since a sheet went out.
// Every prompt is a question with one tap either way - never a block. `npm test` (rules.test.ts).

// What the board held when a sheet went out - and what it holds now. Names, roles, sites and times only.
export type SnapJob = { key: string; site: string; running: boolean; start: string | null; end: string | null; crew: { id: string; name: string; role: string | null }[] };
export type BoardSnapshot = { jobs: SnapJob[] };

// One past change by this person: how many days ahead of that day the board day was, and the Sydney time of day.
export type EditStat = { offset: number; minutes: number };
// A sheet sent for another day (the latest one, by anyone).
export type LaterSend = { date: string; sentAt: Date; sentBy: string };

export type Prompt = { reason: "SENT_LATER" | "PAST" | "USUAL_AHEAD" | "EVENING" | "SEND_PAST" | "SEND_TODAY"; message: string; suggest: string };

export const LEARN = {
  minSamples: 20, // changes at about this time of day before the board trusts what it's learned
  windowMinutes: 90, // "about this time": within an hour and a half either side
  aheadShare: 0.8, // ask when at least 80% of them were for a later day
  days: 60, // learned from the last 60 days
  eveningFrom: 15 * 60, // until then: changing today from 3pm on asks
  sendTodayFrom: 12 * 60, // sending today's sheet from noon on asks
  laterSendHours: 18, // a sheet sent for a later day within the last 18 hours
};

const pad = (n: number) => String(n).padStart(2, "0");
export const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

// "Sun 1 Nov"
export const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`)).replace(",", "");

// Sydney's calendar day and minutes past midnight for a moment.
export function sydney(d = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

// "6:12pm", Sydney time.
export const timeLabel = (d: Date) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").toLowerCase();

const nearTime = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b)) <= LEARN.windowMinutes;

// What the board has learned about this person at this time of day: how many of their changes it has seen, and the
// share that were for a later day than the day they were made.
export function usualAhead(stats: EditStat[], nowMinutes: number): { known: boolean; n: number; aheadShare: number } {
  const near = stats.filter((s) => nearTime(s.minutes, nowMinutes));
  const ahead = near.filter((s) => s.offset >= 1).length;
  return { known: near.length >= LEARN.minSamples, n: near.length, aheadShare: near.length ? ahead / near.length : 0 };
}

const todayWord = (boardDate: string, today: string) => (boardDate === today ? `today, ${dayLabel(boardDate)}` : dayLabel(boardDate));

// Before the first change to a day: null, or "did you mean...?". A later day is never asked about.
export function editPrompt(p: { boardDate: string; today: string; nowMinutes: number; stats: EditStat[]; laterSend: LaterSend | null }): Prompt | null {
  const { boardDate, today, nowMinutes, laterSend } = p;
  if (boardDate > today) return null;
  const tomorrow = addDaysIso(today, 1);
  // What happened on 1 Nov: a later day's sheet has just gone out, and now an earlier day is being changed.
  if (laterSend && laterSend.date > boardDate) {
    return {
      reason: "SENT_LATER",
      message: `${dayLabel(laterSend.date)}'s sheet went out at ${timeLabel(laterSend.sentAt)}${laterSend.sentBy ? ` (${laterSend.sentBy})` : ""}. You're now changing ${todayWord(boardDate, today)} - did you mean ${dayLabel(laterSend.date)}?`,
      suggest: laterSend.date,
    };
  }
  if (boardDate < today) {
    return { reason: "PAST", message: `${dayLabel(boardDate)} has already been and gone. Did you mean tomorrow, ${dayLabel(tomorrow)}?`, suggest: tomorrow };
  }
  const learned = usualAhead(p.stats, nowMinutes);
  if (learned.known) {
    if (learned.aheadShare < LEARN.aheadShare) return null;
    return {
      reason: "USUAL_AHEAD",
      message: `At this time of day you're usually planning ahead (${Math.round(learned.aheadShare * 100)}% of your changes are for a later day). You're changing ${todayWord(boardDate, today)} - did you mean tomorrow, ${dayLabel(tomorrow)}?`,
      suggest: tomorrow,
    };
  }
  if (nowMinutes >= LEARN.eveningFrom) {
    return { reason: "EVENING", message: `You're changing ${todayWord(boardDate, today)}, and the day's nearly done. Did you mean tomorrow, ${dayLabel(tomorrow)}?`, suggest: tomorrow };
  }
  return null;
}

// Before a sheet goes out: null, or "did you mean...?". A later day's sheet is never asked about.
export function sendPrompt(p: { boardDate: string; today: string; nowMinutes: number; laterSend: LaterSend | null }): Prompt | null {
  const { boardDate, today, nowMinutes, laterSend } = p;
  if (boardDate > today) return null;
  const tomorrow = addDaysIso(today, 1);
  if (laterSend && laterSend.date > boardDate) {
    return {
      reason: "SENT_LATER",
      message: `${dayLabel(laterSend.date)}'s sheet already went out at ${timeLabel(laterSend.sentAt)}. This one is for ${todayWord(boardDate, today)} - did you mean ${dayLabel(laterSend.date)}?`,
      suggest: laterSend.date,
    };
  }
  if (boardDate < today) return { reason: "SEND_PAST", message: `This sheet is for ${dayLabel(boardDate)}, which has already been and gone. Did you mean tomorrow, ${dayLabel(tomorrow)}?`, suggest: tomorrow };
  if (nowMinutes >= LEARN.sendTodayFrom) return { reason: "SEND_TODAY", message: `This sheet is for ${todayWord(boardDate, today)}, and the day is well under way. Did you mean tomorrow, ${dayLabel(tomorrow)}?`, suggest: tomorrow };
  return null;
}

// What changed between the sheet that went out and the board now, in plain words. Capped so a cleared board stays short.
export function changesSince(before: BoardSnapshot, after: BoardSnapshot, max = 30): string[] {
  const out: string[] = [];
  const b = new Map(before.jobs.map((j) => [j.key, j])), a = new Map(after.jobs.map((j) => [j.key, j]));
  for (const [k, j] of a) {
    const old = b.get(k);
    if (j.running && (!old || !old.running)) out.push(`${j.site} added`);
    else if (!j.running && old?.running) out.push(`${j.site} no longer running`);
    else if (old && j.running && (old.start !== j.start || old.end !== j.end)) out.push(`${j.site}: ${old.start ?? "?"}-${old.end ?? "?"} -> ${j.start ?? "?"}-${j.end ?? "?"}`);
  }
  for (const [k, j] of b) if (j.running && !a.has(k)) out.push(`${j.site} removed`);
  // Each person or machine: where they were (running jobs) and where they are now.
  const where = (s: BoardSnapshot) => {
    const m = new Map<string, { name: string; at: Map<string, { site: string; role: string | null }> }>();
    for (const j of s.jobs) if (j.running) for (const c of j.crew) {
      const e = m.get(c.id) ?? { name: c.name, at: new Map() };
      e.at.set(j.key, { site: j.site, role: c.role });
      m.set(c.id, e);
    }
    return m;
  };
  const wb = where(before), wa = where(after);
  for (const id of new Set([...wb.keys(), ...wa.keys()])) {
    const was = wb.get(id), now = wa.get(id);
    const name = (now ?? was)!.name;
    const gone = [...(was?.at.keys() ?? [])].filter((k) => !now?.at.has(k));
    const added = [...(now?.at.keys() ?? [])].filter((k) => !was?.at.has(k));
    const site = (m: typeof was, k: string) => m!.at.get(k)!.site;
    if (gone.length && added.length) out.push(`${name}: ${gone.map((k) => site(was, k)).join(", ")} -> ${added.map((k) => site(now, k)).join(", ")}`);
    else if (added.length) out.push(`${name} added to ${added.map((k) => site(now, k)).join(", ")}`);
    else if (gone.length) out.push(`${name} taken off ${gone.map((k) => site(was, k)).join(", ")}`);
    for (const k of [...(now?.at.keys() ?? [])].filter((x) => was?.at.has(x))) {
      const r0 = was!.at.get(k)!.role, r1 = now!.at.get(k)!.role;
      if (r0 !== r1) out.push(`${name} now ${r1 ?? "no role"} at ${site(now, k)}`);
    }
  }
  return out.length > max ? [...out.slice(0, max), `and ${out.length - max} more`] : out;
}
