// Stored findings as the Directors page shows them (Phase 2 step 3, 24 Oct
// 2026). No server imports - the page and the overview loader both use it.
import type { Priority } from "../insights/kpis";

// The KPI-dictionary entry each rule's "?" opens.
const KPI_OF: { prefix: string; kpi: string }[] = [
  { prefix: "COST_VS_CONTRACT", kpi: "F3" },
  { prefix: "LABOUR_HOURS_VS_BUDGET", kpi: "O7" },
  { prefix: "HIRE_OVERDUE", kpi: "PL3" },
  { prefix: "HIRE_", kpi: "F6" },
  { prefix: "START_NOT_READY", kpi: "O3" },
  { prefix: "NO_SUPERVISOR", kpi: "P4" },
  { prefix: "CREW_SHORT", kpi: "P3" },
  { prefix: "DAYS_NOT_CLOSED", kpi: "O5" },
  { prefix: "DATA_PLANT_NOT_BOOKED", kpi: "PL1" },
];
export const kpiOfRule = (rule: string) => KPI_OF.find((k) => rule.startsWith(k.prefix))?.kpi ?? "DQ";

// How each rule reads as a group heading when its INFO findings are bundled.
export const RULE_LABEL: Record<string, string> = {
  DATA_UNCOSTED: "jobs with allocations that can't be costed",
  DATA_NO_CONTRACT_VALUE: "active jobs with no contract value",
  HIRE_NO_FINISH: "hired items with no expected finish date",
  DATE_NO_START: "projects with no start date",
  DATE_TBC_REVIEW_DUE: "projects whose TBC completion is due for review",
  DATE_JOBS_NO_TIMES: "projects with upcoming jobs missing times",
  DATA_PLANT_NOT_BOOKED: "data gap: owned plant isn't being booked on the board",
  XERO_UNMATCHED: "Xero upload: sales invoices not tied to a job",
};

export type FindingDTO = {
  id: string; ruleCode: string; kpi: string; severity: Priority; audience: string; status: string; title: string;
  href: string | null; subjectName: string; projectId: string | null; provisional: boolean;
  firstSeenAt: string; lastSeenAt: string; signalClearedAt: string | null; ownerName: string | null;
  lesson?: { id: string; title: string; lesson: string }; // phase 5a: a published lesson from last time (same rule and subject) - only when there is one
};

const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

export function toFindingDTO(f: {
  id: string; ruleCode: string; severity: string; audience: string; status: string; title: string; href: string | null; subjectName: string;
  projectId: string | null; provisional: boolean; firstSeenAt: Date; lastSeenAt: Date; signalClearedAt: Date | null; ownerName: string | null;
}): FindingDTO {
  return {
    id: f.id, ruleCode: f.ruleCode, kpi: kpiOfRule(f.ruleCode), severity: f.severity as Priority, audience: f.audience, status: f.status,
    title: f.title, href: f.href, subjectName: f.subjectName, projectId: f.projectId, provisional: f.provisional,
    firstSeenAt: f.firstSeenAt.toISOString(), lastSeenAt: f.lastSeenAt.toISOString(),
    signalClearedAt: f.signalClearedAt?.toISOString() ?? null, ownerName: f.ownerName,
  };
}

// Worst first; within a severity, still-firing before "signal cleared",
// then the longest-standing first.
export function sortFindings(list: FindingDTO[]): FindingDTO[] {
  return [...list].sort((a, b) =>
    RANK[a.severity] - RANK[b.severity]
    || Number(!!a.signalClearedAt) - Number(!!b.signalClearedAt)
    || a.firstSeenAt.localeCompare(b.firstSeenAt)
    || a.title.localeCompare(b.title));
}

// CRITICAL / HIGH / MEDIUM one by one; INFO bundled per rule.
export function groupForDisplay(list: FindingDTO[]) {
  const sorted = sortFindings(list);
  const singles = sorted.filter((f) => f.severity !== "INFO");
  const groups = new Map<string, FindingDTO[]>();
  for (const f of sorted.filter((x) => x.severity === "INFO")) groups.set(f.ruleCode, [...(groups.get(f.ruleCode) ?? []), f]);
  return {
    singles,
    infoGroups: [...groups.entries()].map(([rule, items]) => ({ rule, kpi: kpiOfRule(rule), label: RULE_LABEL[rule] ?? rule.toLowerCase().replace(/_/g, " "), items }))
      .sort((a, b) => b.items.length - a.items.length),
  };
}
