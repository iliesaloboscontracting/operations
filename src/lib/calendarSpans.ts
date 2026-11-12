// Project spans on the Calendar (Ilies, 12 Nov 2026: "show how the jobs [go] across the days or months pending how
// long the job is estimated to take"). Each project is drawn as a bar from its start date (Project.startDate) to its
// expected completion (Project.expectedCompletion), behind the board's booked-day chips. Plain rules, no server imports,
// so `npm test` (calendarSpans.test.ts) and the API (/api/calendar/spans) read the same code.
//
// Which projects (his decisions):
//  - ACTIVE projects;
//  - INACTIVE ones (paused / waiting to recommence - anything not ACTIVE or COMPLETED) with a start or finish on or after
//    today, or whose dated span overlaps the range being viewed;
//  - never COMPLETED or archived ones.
// Drawn only where the span overlaps the range. No start date (whatever the finish) = not drawn, listed under
// "No dates yet" instead, so the gap is visible. An inactive project with a past start and a TBC finish has no upcoming
// date at all - drawing it to the edge of every future view would read as "running", so it is listed there too.
//
// The bar:
//  - finish TBC / blank: runs from the start to the edge of the view (open = true);
//  - startDateConfidence TENTATIVE = tentative (a dashed, lighter bar); CONFIRMED or blank = solid;
//  - past its expected finish: still ACTIVE and today is after the finish, or board jobs booked after the finish (the
//    same "last job with our crew" the Projects page's date exceptions use). The bar then carries on, marked, to today
//    or the last booked job, whichever is later;
//  - an inactive project with a start on or after today says "Starts <date>", or "Recommences <date>" when our crew
//    has already been on the board for it.
// No money: names, job numbers, dates and flags only.
import { daysBetween } from "./dates";

export const isISODay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface SpanProject {
  id: string;
  name: string;
  jobNo: string | null;
  status: string;
  archived?: boolean;
  startDate: string | null;
  startDateConfidence: string | null;
  expectedCompletion: string | null;
}

// The board's view of a project (lib/dateExceptions.ts boardDatesByProject): first / last running job with our crew.
export interface SpanBoard {
  firstJobDate: string | null;
  lastJobDate: string | null;
}

export type SpanStatus = "ACTIVE" | "INACTIVE";

export interface CalendarSpanDTO {
  projectId: string;
  name: string;
  jobNo: string | null;
  status: SpanStatus;
  start: string; // planned start, YYYY-MM-DD
  finish: string | null; // planned finish; null = TBC / blank
  finishTbc: boolean;
  tentative: boolean; // startDateConfidence TENTATIVE
  // Past its expected finish: why, and how far the bar carries on past the finish (today or the last booked job).
  pastFinish: { reason: "STILL_ACTIVE" | "JOBS_AFTER"; until: string } | null;
  // An inactive project's next date: "Starts <date>" / "Recommences <date>".
  upcoming: { kind: "STARTS" | "RECOMMENCES"; date: string } | null;
  // The part of the bar inside the range asked for.
  from: string;
  to: string;
  clippedStart: boolean; // the span starts before the range
  clippedEnd: boolean; // the span runs on past the range (a TBC finish always does)
}

export interface NoDatesDTO {
  projectId: string;
  name: string;
  jobNo: string | null;
  status: SpanStatus;
  // NO_START: no start date (a finish alone isn't enough to draw). NO_RESTART: inactive, started, finish TBC - no
  // upcoming date to draw to.
  reason: "NO_START" | "NO_RESTART";
}

export interface CalendarSpansResponse {
  from: string;
  to: string;
  spans: CalendarSpanDTO[];
  noDates: NoDatesDTO[];
}

export const spanStatus = (status: string): SpanStatus | null =>
  status === "ACTIVE" ? "ACTIVE" : status === "COMPLETED" ? null : "INACTIVE";

// A span [start, end] (end null = open, runs on past any range) cut to [from, to]; null when they don't meet.
export function clipSpan(start: string, end: string | null, from: string, to: string) {
  if (start > to) return null;
  if (end !== null && end < from) return null;
  return {
    from: start < from ? from : start,
    to: end === null || end > to ? to : end,
    clippedStart: start < from,
    clippedEnd: end === null || end > to,
  };
}

// Past its expected finish: a dated finish, and either still ACTIVE after it or board jobs booked after it.
export function pastFinishOf(
  p: Pick<SpanProject, "expectedCompletion">,
  status: SpanStatus,
  board: SpanBoard | undefined,
  today: string
): CalendarSpanDTO["pastFinish"] {
  const finish = isISODay(p.expectedCompletion) ? p.expectedCompletion : null;
  if (!finish) return null;
  const last = board?.lastJobDate ?? null;
  const jobsAfter = !!last && last > finish;
  const activeAfter = status === "ACTIVE" && today > finish;
  if (!jobsAfter && !activeAfter) return null;
  let until = finish;
  if (activeAfter && today > until) until = today;
  if (jobsAfter && last! > until) until = last!;
  return { reason: activeAfter ? "STILL_ACTIVE" : "JOBS_AFTER", until };
}

export function buildCalendarSpans(
  projects: SpanProject[],
  boards: Map<string, SpanBoard>,
  from: string,
  to: string,
  today: string
): CalendarSpansResponse {
  const spans: CalendarSpanDTO[] = [];
  const noDates: NoDatesDTO[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    const status = spanStatus(p.status);
    if (!status) continue;
    const inactive = status === "INACTIVE";
    const start = isISODay(p.startDate) ? p.startDate : null;
    const finish = isISODay(p.expectedCompletion) ? p.expectedCompletion : null;
    // A finish before the start can't be drawn as a bar - treat it like a TBC finish (dateRules refuses it on save).
    const goodFinish = finish && start && finish >= start ? finish : start ? null : finish;
    const base = { projectId: p.id, name: p.name, jobNo: p.jobNo, status };

    if (!start) {
      // Active: always listed. Inactive: when it has no dates at all, or a finish still to come.
      if (!inactive || !finish || finish >= today) noDates.push({ ...base, reason: "NO_START" });
      continue;
    }
    if (inactive && !goodFinish && start < today) {
      noDates.push({ ...base, reason: "NO_RESTART" });
      continue;
    }
    const board = boards.get(p.id);
    const pastFinish = goodFinish ? pastFinishOf({ expectedCompletion: goodFinish }, status, board, today) : null;
    const drawEnd = pastFinish ? pastFinish.until : goodFinish; // null = open (TBC)
    // Inactive projects: a date on or after today, or a dated span overlapping the range (checked by clipSpan below).
    const clip = clipSpan(start, drawEnd, from, to);
    if (!clip) continue;
    const upcoming =
      inactive && start >= today
        ? { kind: board?.firstJobDate && board.firstJobDate < today ? ("RECOMMENCES" as const) : ("STARTS" as const), date: start }
        : null;
    spans.push({
      ...base,
      start,
      finish: goodFinish,
      finishTbc: !goodFinish,
      tentative: p.startDateConfidence === "TENTATIVE",
      pastFinish,
      upcoming,
      ...clip,
    });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  spans.sort(byName);
  noDates.sort(byName);
  return { from, to, spans, noDates };
}

// Words for a span, shared by the bar's tooltip and the details panel: "3 Nov - 20 Dec 2026 (start tentative)".
export function spanWords(s: Pick<CalendarSpanDTO, "start" | "finish" | "finishTbc" | "tentative" | "pastFinish">, fmt: (iso: string) => string) {
  const parts = [`${fmt(s.start)} – ${s.finishTbc ? "finish TBC" : fmt(s.finish!)}`];
  if (s.tentative) parts.push("start tentative");
  if (s.pastFinish) parts.push("past expected finish");
  return parts.join(" · ");
}

// Days the span covers (inclusive), for tooltips; null when the finish is TBC.
export const spanDays = (s: Pick<CalendarSpanDTO, "start" | "finish">) => (s.finish ? daysBetween(s.start, s.finish) + 1 : null);
