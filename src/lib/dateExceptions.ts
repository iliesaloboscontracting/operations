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

export function dateExceptions(p: ProjectDates, b: ProjectBoardDates | undefined, today: string): string[] {
  if (p.archived) return [];
  const out: string[] = [];
  const board = b ?? { firstJobDate: null, lastJobDate: null, nextJobDate: null, upcomingNoTimes: 0, predatesBoard: false };

  if (p.status !== "ACTIVE") {
    if (board.nextJobDate && p.status !== "COMPLETED") {
      out.push(`Marked Inactive but has jobs from ${short(board.nextJobDate)}`);
    } else if (board.nextJobDate) {
      out.push(`Marked Completed but has jobs from ${short(board.nextJobDate)}`);
    }
    return out;
  }

  if (!p.startDate) {
    out.push(
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
      out.push(`Start date ${short(p.startDate)} but our crew's first day on the board is ${short(board.firstJobDate)}`);
    }
  }

  const completion = p.expectedCompletion && isISODate(p.expectedCompletion) ? p.expectedCompletion : null;
  if (completion && board.lastJobDate && board.lastJobDate > completion) {
    out.push(`Jobs booked after planned completion (${short(completion)})`);
  } else if (completion && completion < today) {
    out.push(`Planned completion ${short(completion)} has passed`);
  }
  if (p.expectedCompletion === COMPLETION_TBC && p.completionReviewBy && p.completionReviewBy <= today) {
    out.push(`Completion TBC - review was due ${short(p.completionReviewBy)}`);
  }

  if (board.upcomingNoTimes > 0) {
    out.push(`${board.upcomingNoTimes} upcoming job${board.upcomingNoTimes === 1 ? "" : "s"} with no start/finish time`);
  }
  return out;
}
