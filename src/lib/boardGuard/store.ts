// Allocation guard (2 Nov 2026) - the database side of lib/boardGuard/rules.ts: what the board holds for a day, the
// record of each change and each sheet sent, the check the board asks before a change or a send, and the evening
// phone alert. Recording never gets in the way: a failure to record is logged and the change goes ahead.
import { prisma } from "../prisma";
import { pushToUsers } from "../push";
import { isISODate } from "../dateRules";
import {
  LEARN, SEND_LIMITS, addDaysIso, changesSince, daysBetween, dayLabel, editPrompt, hideMoneyLines, sendDateProblem, sendPrompt, sydney, timeLabel,
  type BoardSnapshot, type EditStat, type LaterSend, type Prompt,
} from "./rules";

const ACTIONS = ["ASSIGN", "MOVE", "ROLE", "REMOVE", "JOB_ADD", "JOB_EDIT", "JOB_DELETE", "COPY", "CLEAR"] as const;
export type BoardAction = (typeof ACTIONS)[number];
type Who = { id: string; name: string } | null | undefined;

const dayRange = (date: string) => {
  const start = new Date(`${date}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
};
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const siteName = (j: { title: string; shift: string }) => (j.shift === "NIGHT" ? `${j.title} (night)` : j.title);

// One line of history for each change. Never throws (BG-004: a real calendar date only).
export async function logBoardEdit(who: Who, date: string, action: BoardAction, detail?: string | null) {
  if (!who || !isISODate(date)) return;
  try {
    await prisma.boardEdit.create({ data: { date, action, detail: detail ? detail.slice(0, 200) : null, userId: who.id, by: who.name } });
  } catch (e) {
    console.error("board edit log", e instanceof Error ? e.message : "failed");
  }
}

// What the board holds for a day: every job (running or stood down), its times and who's on it.
export async function snapshotFor(date: string): Promise<BoardSnapshot> {
  const jobs = await prisma.job.findMany({
    where: { date: dayRange(date) },
    select: { id: true, projectId: true, title: true, shift: true, startTime: true, endTime: true, notRunning: true, status: true,
      assignments: { select: { resourceId: true, role: true, resource: { select: { name: true } } } } },
  });
  return {
    jobs: jobs.map((j) => ({
      key: `${j.projectId ?? j.id}|${j.shift}`,
      site: siteName(j),
      running: !j.notRunning && j.status !== "COMPLETED",
      start: j.startTime, end: j.endTime,
      crew: j.assignments.map((a) => ({ id: a.resourceId, name: a.resource.name, role: a.role })),
    })),
  };
}

export { sendDateProblem };

export async function recordSend(who: { id: string; name: string }, date: string, how: "COPY" | "EMAIL"): Promise<{ ok: true } | { error: string; status: number }> {
  const same = await prisma.daySheetSend.findFirst({ where: { date, sentById: who.id, sentAt: { gte: new Date(Date.now() - SEND_LIMITS.sameSendMs) } }, select: { id: true } });
  if (same) return { ok: true }; // the same send, pressed twice
  const today = sydney().date;
  const mine = await prisma.daySheetSend.findMany({ where: { sentById: who.id, sentAt: { gte: new Date(Date.now() - 26 * 3_600_000) } }, select: { sentAt: true } });
  if (mine.filter((s) => sydney(s.sentAt).date === today).length >= SEND_LIMITS.perDay) return { error: "That's a lot of sheets sent today - try again tomorrow.", status: 429 };
  const snapshot = await snapshotFor(date);
  await prisma.daySheetSend.create({ data: { date, how, sentById: who.id, sentBy: who.name, snapshot: JSON.stringify(snapshot) } });
  return { ok: true };
}

const readSnap = (s: string): BoardSnapshot => {
  try { const j = JSON.parse(s); return Array.isArray(j?.jobs) ? j : { jobs: [] }; } catch { return { jobs: [] }; }
};

// This person's changes over the last 60 days: how far ahead the board day was, and the Sydney time of day.
async function editStats(userId: string): Promise<EditStat[]> {
  const rows = await prisma.boardEdit.findMany({
    where: { userId, at: { gte: new Date(Date.now() - LEARN.days * 86_400_000) } },
    select: { date: true, at: true }, orderBy: { at: "desc" }, take: 5000,
  });
  return rows.map((r) => { const s = sydney(r.at); return { offset: daysBetween(s.date, r.date), minutes: s.minutes }; });
}

// The latest sheet sent (by anyone) in the last 18 hours for a day after this one - and no more than a week ahead
// (BG-001), so a far-off send never steers today's questions.
async function laterSendAfter(date: string, today: string): Promise<LaterSend | null> {
  const s = await prisma.daySheetSend.findFirst({
    where: { date: { gt: date, lte: addDaysIso(today, SEND_LIMITS.laterSendDaysAhead) }, sentAt: { gte: new Date(Date.now() - LEARN.laterSendHours * 3_600_000) } },
    orderBy: { sentAt: "desc" }, select: { date: true, sentAt: true, sentBy: true },
  });
  return s ?? null;
}

export type SentInfo = { at: string; time: string; by: string; how: string; changes: string[] };

// The last sheet sent for this day, and what's changed on the board since. BG-003: Viewers see this, so a line with a
// dollar amount in it (a "$" typed into a job or tile name) is replaced, never shown.
export async function lastSent(date: string): Promise<SentInfo | null> {
  const s = await prisma.daySheetSend.findFirst({ where: { date }, orderBy: { sentAt: "desc" } });
  if (!s) return null;
  const changes = hideMoneyLines(changesSince(readSnap(s.snapshot), await snapshotFor(date)));
  return { at: s.sentAt.toISOString(), time: timeLabel(s.sentAt), by: s.sentBy, how: s.how, changes };
}

// GET /api/board/check: before a change (edit) or a send - the question to ask, if any - and the day's last send.
// BG-005: "status" (the banner, after every change) skips the question and what's been learned.
export async function boardCheck(userId: string, date: string, purpose: "edit" | "send" | "status"): Promise<{ prompt: Prompt | null; sent: SentInfo | null }> {
  if (purpose === "status") return { prompt: null, sent: await lastSent(date) };
  const now = sydney();
  const laterSend = await laterSendAfter(date, now.date);
  const prompt = purpose === "send"
    ? sendPrompt({ boardDate: date, today: now.date, nowMinutes: now.minutes, laterSend })
    : editPrompt({ boardDate: date, today: now.date, nowMinutes: now.minutes, stats: date > now.date ? [] : await editStats(userId), laterSend });
  return { prompt, sent: await lastSent(date) };
}

// The evening check (from the instrumentation tick, at most every 5 minutes, 7pm to 11pm Sydney). For each person who
// sent tomorrow's sheet today (their latest send - BG-002: a later export by someone else never takes their alert),
// once each, if they have a phone set up:
//  - tomorrow changed after it went out, and nobody has touched it for 10 minutes -> "re-send it";
//  - an earlier day (today or before) was changed after it went out -> "were those meant for tomorrow?" (1 Nov).
const globalForGuard = globalThis as unknown as { boardGuardState?: { lastRun: number } };
const state = (globalForGuard.boardGuardState ??= { lastRun: 0 });
export async function eveningBoardCheck() {
  if (Date.now() - state.lastRun < 5 * 60_000) return;
  state.lastRun = Date.now();
  const now = sydney();
  if (now.minutes < 19 * 60 || now.minutes >= 23 * 60) return;
  const tomorrow = addDaysIso(now.date, 1);
  const sends = await prisma.daySheetSend.findMany({ where: { date: tomorrow, sentAt: { gte: new Date(Date.now() - 26 * 3_600_000) } }, orderBy: { sentAt: "desc" } });
  const latestPerSender = new Map<string, (typeof sends)[number]>();
  for (const s of sends) if (sydney(s.sentAt).date === now.date && !latestPerSender.has(s.sentById)) latestPerSender.set(s.sentById, s);
  const url = `/command?date=${tomorrow}`;
  for (const send of latestPerSender.values()) {
    if (!(await prisma.pushDevice.count({ where: { userId: send.sentById } }))) continue; // no phone set up - nothing to send to
    if (!send.changeAlertAt) {
      const lastEdit = await prisma.boardEdit.findFirst({ where: { date: tomorrow, at: { gt: send.sentAt } }, orderBy: { at: "desc" }, select: { at: true } });
      if (lastEdit && Date.now() - lastEdit.at.getTime() >= 10 * 60_000) {
        const changes = changesSince(readSnap(send.snapshot), await snapshotFor(tomorrow));
        if (changes.length) {
          await prisma.daySheetSend.update({ where: { id: send.id }, data: { changeAlertAt: new Date() } });
          await pushToUsers([send.sentById], {
            title: `${dayLabel(tomorrow)} changed after it was sent`,
            body: `${changes.length} change${changes.length === 1 ? "" : "s"} since the sheet went out at ${timeLabel(send.sentAt)} - send it again so the crew have the latest.`,
            url, tag: `board-changed-${tomorrow}`,
          });
        }
      }
    }
    if (!send.wrongDayAlertAt) {
      const earlier = await prisma.boardEdit.findMany({ where: { date: { lte: now.date }, at: { gt: send.sentAt } }, select: { date: true, at: true } });
      const quiet = earlier.length && Date.now() - Math.max(...earlier.map((e) => e.at.getTime())) >= 10 * 60_000;
      if (quiet) {
        const days = [...new Set(earlier.map((e) => e.date))].sort().map(dayLabel).join(", ");
        await prisma.daySheetSend.update({ where: { id: send.id }, data: { wrongDayAlertAt: new Date() } });
        await pushToUsers([send.sentById], {
          title: `Changes made to ${days} after ${dayLabel(tomorrow)}'s sheet went out`,
          body: `${earlier.length} change${earlier.length === 1 ? "" : "s"} to ${days} since ${timeLabel(send.sentAt)}. If they were meant for ${dayLabel(tomorrow)}, its sheet doesn't have them.`,
          url, tag: `board-wrong-day-${tomorrow}`,
        });
      }
    }
  }
}

export { ACTIONS };
