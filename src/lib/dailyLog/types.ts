// Daily site log shapes (Task K). Money guard: none of these has a rate, cost,
// price or budget-hours field - the link gets package names and codes only,
// and the office's hours-vs-budget table (HoursVsBudgetDTO) is hours, never
// dollars. Responses to the link also pass assertNoMoney (lib/moneyGuard).
import type { HoursVsBudgetRow } from "./checks";

// ---------- the supervisor's link ----------

export type CrewPersonDTO = { name: string; company: string | null; in: string | null; out: string | null; hours: number; stillOn: boolean };
export type LogPlantDTO = { resourceId: string; name: string; kind: "PLANT" | "TRUCK"; defaultHours: number | null };
export type SuggestedCodeDTO = { code: string; name: string; source: "BUDGET" | "BEFORE" };

export type LogDetailDTO = {
  id: string; revision: number; submittedBy: string; at: string; atLabel: string; codesVersion: string;
  crewCount: number; labourHours: number; splitHours: number; crewOk: boolean; crewNote: string | null;
  note: string | null; photos: string[]; noDelays: boolean; noDockets: boolean; durationSec: number | null;
  hours: { code: string; label: string; kind: string; resourceId: string | null; resourceName: string | null; hours: number }[];
  delays: { delayCode: string; label: string; hoursLost: number | null; affects: string; note: string | null; photos: string[] }[];
  dockets: { code: string; wasteClass: string; quantity: number; unit: string; docketNo: string | null; facility: string | null; photo: string | null }[];
};

export type LogJobDTO = {
  jobId: string; date: string; shift: string; label: string; closed: boolean;
  crew: { staff: number; staffHours: number; hire: number; hireHours: number; count: number; hours: number; people: CrewPersonDTO[] };
  plant: LogPlantDTO[];
  suggested: SuggestedCodeDTO[];
  latest: LogDetailDTO | null;
  docketsSent: number; // tip dockets sent as receipts for this job (Receipts R1)
};

export type ProgressFormDTO = {
  projectId: string; projectName: string; basis: "BUDGET" | "CODES"; due: boolean; weekStart: string; savedAt: string | null;
  budgetUnavailable: boolean; // Estimating didn't answer - the codes basis is offered meanwhile
  lines: { packageId: string | null; code: string; label: string; last: number | null; thisWeek: number | null }[];
};

export type LinkLogDTO = { jobs: LogJobDTO[]; progress: ProgressFormDTO[]; voice?: boolean }; // voice: the mic is available (29 Oct 2026)

// The home card on the link ("Daily log - not done today" / "Logged 4:52pm").
export type LogCardDTO = { jobs: number; logged: number; lastAt: string | null; progressDue: boolean };

// ---------- the office (Day Review, job pages) ----------

export type HoursVsBudgetDTO =
  | { state: "OK"; budgetRef: string; budgetName: string; logs: number; rows: HoursVsBudgetRow[] }
  | { state: "NO_BUDGET" | "NO_LOGS" | "ESTIMATING_DOWN" };

// "What was said" (30 Oct 2026): one recording the latest log version used - the transcript with every amount
// already taken out, the tidied text it gave, when and how long. Managers and up only.
export type VoiceTranscriptDTO = { id: string; at: string; seconds: number | null; transcript: string; tidied: string | null };

export type DayReviewSiteLogDTO = {
  jobId: string; projectId: string | null; pilot: boolean; ran: boolean; dueAt: string; missing: boolean;
  supervisors: string[]; voiceCount: number; // recordings the latest version used (0 = typed)
  transcripts?: VoiceTranscriptDTO[]; // Manager+ only - absent for a Viewer
  latest: (LogDetailDTO & { logId: string }) | null;
  earlier: { revision: number; submittedBy: string; at: string; labourHours: number; splitHours: number }[];
  signedNow: number; mismatch: boolean; byHand: boolean;
  progress: { weekStart: string; submittedBy: string; at: string; lines: { label: string; code: string; pct: number; last: number | null; reason: string | null }[] } | null;
};

// The written "Daily site report" for the office (29 Oct 2026): one job on one day, print-friendly. Hours, names,
// codes, notes and photos only - no rate, cost or price field exists on it (and the route runs assertNoMoney).
export type SiteReportDTO = {
  jobId: string; projectId: string | null; site: string; jobNo: string | null; date: string; shift: string;
  crew: { count: number; hours: number; staff: number; hire: number; people: CrewPersonDTO[] };
  log: (LogDetailDTO & { logId: string; revisions: number }) | null;
  docketsSent: number;
};
export type SiteReportDayDTO = { jobId: string; date: string; shift: string; revision: number; submittedBy: string };

// The all-logs summary at the top of Day Review (30 Oct 2026): every job that day - who's on it, whether and when
// it was logged (the latest version), by voice or typed. NO_SUPERVISOR: no supervisor with the log is on the job.
export type DayReviewLogSummaryDTO = {
  jobId: string; supervisors: string[]; state: "LOGGED" | "NO_LOG" | "DUE" | "NOT_RUN" | "NO_SUPERVISOR";
  at: string | null; revision: number | null; byVoice: boolean; dueAt: string;
};

export type DayReviewSiteLogsDTO = {
  date: string; pilotOn: boolean; missingCount: number; codesVersion: string;
  jobs: DayReviewSiteLogDTO[];
  summary: DayReviewLogSummaryDTO[]; // every job on the date
  budgets: Record<string, HoursVsBudgetDTO>; // by projectId - Manager+ only (empty for a Viewer)
};
