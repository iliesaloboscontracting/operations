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
};

export type ProgressFormDTO = {
  projectId: string; projectName: string; basis: "BUDGET" | "CODES"; due: boolean; weekStart: string; savedAt: string | null;
  budgetUnavailable: boolean; // Estimating didn't answer - the codes basis is offered meanwhile
  lines: { packageId: string | null; code: string; label: string; last: number | null; thisWeek: number | null }[];
};

export type LinkLogDTO = { jobs: LogJobDTO[]; progress: ProgressFormDTO[] };

// The home card on the link ("Daily log - not done today" / "Logged 4:52pm").
export type LogCardDTO = { jobs: number; logged: number; lastAt: string | null; progressDue: boolean };

// ---------- the office (Day Review, job pages) ----------

export type HoursVsBudgetDTO =
  | { state: "OK"; budgetRef: string; budgetName: string; logs: number; rows: HoursVsBudgetRow[] }
  | { state: "NO_BUDGET" | "NO_LOGS" | "ESTIMATING_DOWN" };

export type DayReviewSiteLogDTO = {
  jobId: string; projectId: string | null; pilot: boolean; ran: boolean; dueAt: string; missing: boolean;
  latest: (LogDetailDTO & { logId: string }) | null;
  earlier: { revision: number; submittedBy: string; at: string; labourHours: number; splitHours: number }[];
  signedNow: number; mismatch: boolean; byHand: boolean;
  progress: { weekStart: string; submittedBy: string; at: string; lines: { label: string; code: string; pct: number; last: number | null; reason: string | null }[] } | null;
};

export type DayReviewSiteLogsDTO = {
  date: string; pilotOn: boolean; missingCount: number; codesVersion: string;
  jobs: DayReviewSiteLogDTO[];
  budgets: Record<string, HoursVsBudgetDTO>; // by projectId - Manager+ only (empty for a Viewer)
};
