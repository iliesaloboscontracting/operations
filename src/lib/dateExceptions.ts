// Date exceptions (Operations Analyst brief 12, 19 Oct 2026): the daily list
// of project dates that disagree with the board or are missing. Shown as
// reasons on the existing "Needs attention" filter - this is the control
// that catches whatever the save-time checks (lib/dateRules.ts) let through.
//
// D12-1 (decided 19 Oct 2026, clarified by Ilies the same day): "start date"
// means the Lobos demo crew's first day on site - not another trade's, not a
// walk-through or set-out, and not an empty booking. So "first day on site"
// below only counts a running job with our own crew (staff or labour hire)
// assigned. A mismatch is listed for a person to fix, never auto-corrected.

import { prisma } from "./prisma";
import { addDays, fmtDay } from "./dates";
import { isISODate } from "./dateRules";
import { COMPLETION_TBC } from "./projectFile";

const short = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface ProjectBoardDates {
  firstJobDate: string | null; // first running job with our crew on it (the demo crew's first day on site)
  lastJobDate: string | null; // last running job with our crew on it (the actual finish once COMPLETED)
  nextJobDate: string | null; // first running job today or later
  upcomingNoTimes: number; // running jobs in the next 14 days with no start or finish time
  // The first job is on the board's very first day (22 Sep 2026, when
  // Operations started being used), so the project was already running and
  // its real first day on site is earlier - the board can't tell us.
  predatesBoard: boolean;
}

// The board's view of every project's dates (or just one project's), in
// three grouped queries.
export async function boardDatesByProject(today: string, projectId?: string): Promise<Map<string, ProjectBoardDates>> {
  const todayDate = new Date(today + "T00:00:00.000Z");
  const horizon = new Date(addDays(today, 14) + "T00:00:00.000Z");
  const running = { notRunning: false, projectId: projectId ?? { not: null } };
  // Our own crew on the job: staff, or labour hire working for us.
  const crewed = {
    assignments: {
      some: { resource: { OR: [{ type: "PERSONNEL" }, { type: "HIRE", category: "LABOUR" }] } },
    },
  };
  const [boardStart, firstAny, span, next, noTimes] = await Promise.all([
    // The board's very first day, and each project's first booking of any
    // kind - a project booked on day one was already running before the
    // board existed (crew names weren't recorded on the earliest days).
    prisma.job.aggregate({ _min: { date: true } }),
    prisma.job.groupBy({ by: ["projectId"], where: { projectId: projectId ?? { not: null } }, _min: { date: true } }),
    prisma.job.groupBy({ by: ["projectId"], where: { ...running, ...crewed }, _min: { date: true }, _max: { date: true } }),
    prisma.job.groupBy({ by: ["projectId"], where: { ...running, date: { gte: todayDate } }, _min: { date: true } }),
    prisma.job.groupBy({
      by: ["projectId"],
      where: {
        ...running,
        date: { gte: todayDate, lt: horizon },
        status: { not: "COMPLETED" },
        OR: [{ startTime: null }, { endTime: null }, { startTime: "" }, { endTime: "" }],
      },
      _count: { _all: true },
    }),
  ]);
  const out = new Map<string, ProjectBoardDates>();
  const get = (id: string) => {
    let v = out.get(id);
    if (!v) out.set(id, (v = { firstJobDate: null, lastJobDate: null, nextJobDate: null, upcomingNoTimes: 0, predatesBoard: false }));
    return v;
  };
  for (const r of span) {
    if (!r.projectId) continue;
    const v = get(r.projectId);
    v.firstJobDate = r._min.date ? iso(r._min.date) : null;
    v.lastJobDate = r._max.date ? iso(r._max.date) : null;
  }
  const boardDay1 = boardStart._min.date ? iso(boardStart._min.date) : null;
  for (const r of firstAny) {
    if (r.projectId && boardDay1 && r._min.date && iso(r._min.date) === boardDay1) get(r.projectId).predatesBoard = true;
  }
  for (const r of next) if (r.projectId && r._min.date) get(r.projectId).nextJobDate = iso(r._min.date);
  for (const r of noTimes) if (r.projectId) get(r.projectId).upcomingNoTimes = r._count._all;
  return out;
}

type ProjectDates = {
  status: string;
  archived?: boolean;
  startDate: string | null;
  expectedCompletion: string | null;
  completionReviewBy?: string | null;
};

// Each exception with a stable code (Director Insights signals, 24 Oct 2026),
// so a finding can be keyed on the rule rather than its wording. The text is
// exactly what the Projects page has always shown.
export type DateExceptionCode =
  | "DATE_INACTIVE_HAS_JOBS" | "DATE_COMPLETED_HAS_JOBS" | "DATE_NO_START" | "DATE_START_MISMATCH"
  | "DATE_JOBS_AFTER_COMPLETION" | "DATE_COMPLETION_PASSED" | "DATE_TBC_REVIEW_DUE" | "DATE_JOBS_NO_TIMES";
export type DateException = { code: DateExceptionCode; text: string };

export function dateExceptions(p: ProjectDates, b: ProjectBoardDates | undefined, today: string): string[] {
  return dateExceptionList(p, b, today).map((e) => e.text);
}

export function dateExceptionList(p: ProjectDates, b: ProjectBoardDates | undefined, today: string): DateException[] {
  if (p.archived) return [];
  const out: DateException[] = [];
  const add = (code: DateExceptionCode, text: string) => out.push({ code, text });
  const board = b ?? { firstJobDate: null, lastJobDate: null, nextJobDate: null, upcomingNoTimes: 0, predatesBoard: false };

  if (p.status !== "ACTIVE") {
    if (board.nextJobDate && p.status !== "COMPLETED") {
      add("DATE_INACTIVE_HAS_JOBS", `Marked Inactive but has jobs from ${short(board.nextJobDate)}`);
    } else if (board.nextJobDate) {
      add("DATE_COMPLETED_HAS_JOBS", `Marked Completed but has jobs from ${short(board.nextJobDate)}`);
    }
    return out;
  }

  if (!p.startDate) {
    add(
      "DATE_NO_START",
      board.predatesBoard
        ? "No start date (started before the board - take it from the handover)"
        : board.firstJobDate
        ? `No start date (our crew's first day on the board: ${short(board.firstJobDate)})`
        : "No start date"
    );
  } else if (board.firstJobDate && board.firstJobDate !== p.startDate) {
    // An earlier start than the board's first day is expected for a project
    // that was already running when the board began - not a mismatch.
    if (!(board.predatesBoard && p.startDate < board.firstJobDate)) {
      add("DATE_START_MISMATCH", `Start date ${short(p.startDate)} but our crew's first day on the board is ${short(board.firstJobDate)}`);
    }
  }

  const completion = p.expectedCompletion && isISODate(p.expectedCompletion) ? p.expectedCompletion : null;
  if (completion && board.lastJobDate && board.lastJobDate > completion) {
    add("DATE_JOBS_AFTER_COMPLETION", `Jobs booked after planned completion (${short(completion)})`);
  } else if (completion && completion < today) {
    add("DATE_COMPLETION_PASSED", `Planned completion ${short(completion)} has passed`);
  }
  if (p.expectedCompletion === COMPLETION_TBC && p.completionReviewBy && p.completionReviewBy <= today) {
    add("DATE_TBC_REVIEW_DUE", `Completion TBC - review was due ${short(p.completionReviewBy)}`);
  }

  if (board.upcomingNoTimes > 0) {
    add("DATE_JOBS_NO_TIMES", `${board.upcomingNoTimes} upcoming job${board.upcomingNoTimes === 1 ? "" : "s"} with no start/finish time`);
  }
  return out;
}
