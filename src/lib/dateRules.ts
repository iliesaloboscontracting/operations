// Date checks on save (Operations Analyst brief 12, 19 Oct 2026).
// Hard rules block the save; soft rules are warnings a person can override
// by giving a reason (stored on the job as dateCheckNote).
// All dates here are calendar days as "YYYY-MM-DD" strings.

import { fmtDay, parseISO } from "./dates";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day, not just the right shape (rejects 2026-02-30).
export function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const DATE_CONFIDENCE = ["CONFIRMED", "TENTATIVE"] as const;
export const DATE_CONFIDENCE_LABEL: Record<string, string> = { CONFIRMED: "Confirmed", TENTATIVE: "Tentative" };

const short = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });

type ProjectDates = {
  startDate?: string | null;
  expectedCompletion?: string | null;
  completionReviewBy?: string | null;
  startDateConfidence?: string | null;
  completionConfidence?: string | null;
};

// Hard rules for a project's planned dates. `next` is the project as it will
// be after the save (existing values merged with the change).
export function projectDateError(next: ProjectDates): string | null {
  if (next.startDate && !isISODate(next.startDate)) return "Start date must be a real date (YYYY-MM-DD).";
  if (next.completionReviewBy && !isISODate(next.completionReviewBy)) return "Review-by date must be a real date (YYYY-MM-DD).";
  for (const c of [next.startDateConfidence, next.completionConfidence]) {
    if (c && !(DATE_CONFIDENCE as readonly string[]).includes(c)) return "Date confidence must be Confirmed or Tentative.";
  }
  if (next.startDate && next.expectedCompletion && isISODate(next.expectedCompletion) && next.expectedCompletion < next.startDate) {
    return `Expected completion (${short(next.expectedCompletion)}) is before the start date (${short(next.startDate)}).`;
  }
  return null;
}

// Hard rules for a hired item's on/off-hire dates.
export function hireDateError(next: { onHireDate?: string | null; offHireDate?: string | null }): string | null {
  if (next.onHireDate && !isISODate(next.onHireDate)) return "On-hire date must be a real date (YYYY-MM-DD).";
  if (next.offHireDate && !isISODate(next.offHireDate)) return "Off-hire date must be a real date (YYYY-MM-DD).";
  if (next.onHireDate && next.offHireDate && next.offHireDate < next.onHireDate) {
    return `Off-hire (${short(next.offHireDate)}) is before on-hire (${short(next.onHireDate)}).`;
  }
  return null;
}

// Soft rules for a job's date against its project. Each returned line is a
// warning the person saving must acknowledge with a reason.
export function jobDateWarnings(
  date: string,
  project: { name: string; status: string; startDate: string | null; expectedCompletion: string | null } | null
): string[] {
  const out: string[] = [];
  if (project) {
    if (project.status !== "ACTIVE") {
      out.push(`${project.name} is marked ${project.status === "COMPLETED" ? "Completed" : "Inactive"}.`);
    }
    if (project.startDate && isISODate(project.startDate) && date < project.startDate) {
      out.push(`${short(date)} is before ${project.name}'s start date (${short(project.startDate)}).`);
    }
    if (project.expectedCompletion && isISODate(project.expectedCompletion) && date > project.expectedCompletion) {
      out.push(`${short(date)} is after ${project.name}'s planned completion (${short(project.expectedCompletion)}).`);
    }
  }
  const dow = parseISO(date).getDay();
  if (dow === 0 || dow === 6) out.push(`${short(date)} is a ${dow === 0 ? "Sunday" : "Saturday"}.`);
  return out;
}
