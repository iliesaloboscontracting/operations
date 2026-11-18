// One list per project (Ilies, 18 Nov 2026: "approve all" - the project-lists review). Plain rules only, no server or
// React imports, so the Projects page, the Completed page, the board and `npm test` (projectLists.test.ts) read the
// same answer.
//
// - Every project is on exactly one list: Current (ACTIVE), Stand down (INACTIVE - shown as "Stand down", the stored
//   value stays INACTIVE), Completed, or Archived. Archived wins whatever the status (shown with a status badge).
// - The board gives a stood-down project a placeholder row on every day it has no job (with "Starts <date>" when its
//   start is still to come); an Active project only from its start date on (Ilies, 18 Oct 2026, unchanged).
// - The Completed page lists each completed project once, and a completed job-day separately only when its project
//   isn't Completed or it has no project.

export type ProjectStatusValue = "ACTIVE" | "INACTIVE" | "COMPLETED";
export const PROJECT_STATUSES: readonly ProjectStatusValue[] = ["ACTIVE", "INACTIVE", "COMPLETED"];

// What a person sees for each stored status - the one place the words live.
export const PROJECT_STATUS_LABEL: Record<ProjectStatusValue, string> = {
  ACTIVE: "Active",
  INACTIVE: "Stand down",
  COMPLETED: "Completed",
};

// Anything that isn't ACTIVE or COMPLETED reads as Stand down - never hidden (older values, e.g. ON_HOLD).
export function statusLabel(status: string | null | undefined): string {
  if (status === "ACTIVE" || status === "COMPLETED") return PROJECT_STATUS_LABEL[status];
  return PROJECT_STATUS_LABEL.INACTIVE;
}

export const isProjectStatus = (s: unknown): s is ProjectStatusValue =>
  typeof s === "string" && (PROJECT_STATUSES as readonly string[]).includes(s);

export type ProjectList = "CURRENT" | "STAND_DOWN" | "COMPLETED" | "ARCHIVED";
export const LIST_LABEL: Record<ProjectList, string> = {
  CURRENT: "Current",
  STAND_DOWN: "Stand down",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

type ListProject = { status?: string | null; archived?: boolean | null };

export function listOf(p: ListProject): ProjectList {
  if (p.archived) return "ARCHIVED";
  if (p.status === "COMPLETED") return "COMPLETED";
  if (p.status === "ACTIVE") return "CURRENT";
  return "STAND_DOWN";
}

// The board's placeholder row for a project with no job on `date` (YYYY-MM-DD): null = no row. A stood-down
// project always gets one (startsOn = its start date while that's still ahead), an Active one from its start date on,
// a Completed or archived one never. The caller checks whether the project already has a job that day.
export function boardPlaceholder(
  p: ListProject & { startDate?: string | null },
  date: string,
): { startsOn: string | null } | null {
  const list = listOf(p);
  if (list === "ARCHIVED" || list === "COMPLETED") return null;
  const future = !!p.startDate && date < p.startDate;
  if (list === "CURRENT") return future ? null : { startsOn: null };
  return { startsOn: future ? p.startDate! : null };
}

// The Completed page (one row per completed project; loose completed job-days only when their project isn't
// Completed or they have none). `projects` is the page's project list; `jobs` is GET /api/jobs/completed, each with
// its project's status (projectStatus) so a job on an archived Completed project isn't listed as a loose day either.
export type CompletedRow<P> = { project: P; lastDay: string | null; completedDays: number };

export function completedPageRows<
  P extends ListProject & { id: string; lastJobDate?: string | null },
  J extends { id: string; projectId: string | null; projectStatus?: string | null; date: string },
>(projects: readonly P[], jobs: readonly J[]): { projects: CompletedRow<P>[]; jobs: J[] } {
  const days = new Map<string, Set<string>>();
  const lastCompleted = new Map<string, string>();
  const loose: J[] = [];
  const seenJob = new Set<string>();
  for (const j of jobs) {
    if (seenJob.has(j.id)) continue;
    seenJob.add(j.id);
    if (j.projectId && j.projectStatus === "COMPLETED") {
      const d = j.date.slice(0, 10);
      (days.get(j.projectId) ?? days.set(j.projectId, new Set()).get(j.projectId)!).add(d);
      if (d > (lastCompleted.get(j.projectId) ?? "")) lastCompleted.set(j.projectId, d);
    } else {
      loose.push(j);
    }
  }
  const seen = new Set<string>();
  const rows: CompletedRow<P>[] = [];
  for (const p of projects) {
    if (seen.has(p.id) || listOf(p) !== "COMPLETED") continue;
    seen.add(p.id);
    const a = p.lastJobDate ?? null;
    const b = lastCompleted.get(p.id) ?? null;
    rows.push({ project: p, lastDay: a && b ? (a > b ? a : b) : a ?? b, completedDays: days.get(p.id)?.size ?? 0 });
  }
  return { projects: rows, jobs: loose };
}

// Completing a project that still has bookings from today on (Ilies, 18 Nov 2026: "when a project is said completed
// but has bookings further ahead, let's prompt it to say, do you mean stand down or inactive for now?"). The PATCH
// answers 409 { code: "has-bookings" } until the body carries one of these decisions.
export type BookingsDecision = "STAND_DOWN" | "CANCEL_BOOKINGS";
export const HAS_BOOKINGS = "has-bookings";
export type Booking = { id: string; date: string; shift: string; signIns: number; dailyLogs: number };
export const bookingCancellable = (b: Booking) => b.signIns === 0 && b.dailyLogs === 0;
