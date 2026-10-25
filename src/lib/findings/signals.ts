// Findings signals (Director Insights Phase 2, step 1 - 24 Oct 2026). Today's
// computed checks - Tracking's health and data gaps, hire per item, date
// exceptions, starts not ready, no supervisor, days not closed, crew short
// and the plant data gap - as one typed list. Each signal names its subject
// and carries a stable dedupeKey, so the findings store (step 2) can keep one
// open finding per problem: same problem next run -> same key. Plain
// functions over data already fetched (lib/findings/load.ts), no storage, no
// server imports. Design: director-insights-plan/PHASE2-FINDINGS-DESIGN.md §2.
import type { HireItemCostDTO, JobHealth, StartAlertDTO } from "../types";
import type { DateException, DateExceptionCode } from "../dateExceptions";
import type { Confidence, Priority } from "../insights/kpis";
import { addDays, daysBetween } from "../dates";
import { assertNoMoney } from "../moneyGuard";
import { THRESHOLDS } from "../insights/dictionary";

// Thresholds Tracking itself uses (exported from lib/trackingData.ts, which
// is server-only) - passed in, so these functions stay pure and testable.
export type TrackingRules = {
  watchAt: number; actAt: number; recentDays: number; noContractMinSpend: number; hireUninvoicedDays: number;
};

export type SignalKind =
  | "COST_VS_CONTRACT" | "DATA_NO_CONTRACT_VALUE" | "DATA_UNCOSTED"
  | "HIRE_UNINVOICED" | "HIRE_IDLE" | "HIRE_NO_FINISH" | "HIRE_OVERDUE"
  | DateExceptionCode
  | "START_NOT_READY" | "NO_SUPERVISOR" | "DAYS_NOT_CLOSED" | "CREW_SHORT" | "DATA_PLANT_NOT_BOOKED"
  | "TENDER_WON_NO_PROJECT";

// Who may see it (design §1): OPERATIONAL = Viewer+, never a dollar figure;
// COMMERCIAL = Manager+ (the money Tracking already shows Managers);
// DIRECTOR = directors and the owner (won tenders, G5).
export type Audience = "OPERATIONAL" | "COMMERCIAL" | "DIRECTOR";
export type SubjectType = "PROJECT" | "RESOURCE" | "JOB" | "COMPANY" | "TENDER";
export type EvidenceRef = { recordType: string; recordId: string; label: string };
export type SignalValue = number | string | boolean | null;

export type Signal = {
  kind: SignalKind;
  subject: { type: SubjectType; id: string; name: string };
  projectId: string | null;
  dedupeKey: string;
  severity: Priority;
  audience: Audience;
  title: string;
  provisional: boolean; // something it needs is missing - says what in values.missing
  confidence: Confidence | null;
  evidence: EvidenceRef[];
  values: Record<string, SignalValue>;
  href: string | null;
};

// kind:subjectType:subjectId[:qualifier] - ids only, so a rename never
// changes the key; the qualifier is for problems tied to a date.
export const dedupeKeyOf = (kind: SignalKind, type: SubjectType, id: string, qualifier?: string) =>
  [kind, type, id, ...(qualifier ? [qualifier] : [])].join(":");

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const projectRef = (id: string, name: string): EvidenceRef => ({ recordType: "Project", recordId: id, label: name });

// ---------- inputs (shapes the loader already has) ----------

export type TrackingProject = {
  id: string; name: string; status: string; health: JobHealth; healthReason: string;
  contractValue: number | null; totalCost: number; forecastCost: number; stillToCome: number;
  lockedCost: number; estimatedTotal: number; invoicedTotal: number;
  uncostedCount: number; lastDate: string | null;
  hireItems: Pick<HireItemCostDTO, "id" | "name" | "supplier" | "status" | "offHireDate" | "dayRate" | "daysToDate" | "daysInvoiced" | "costToDate">[];
};
export type IdleHireItem = { id: string; name: string; agency: string | null; overdue: boolean; idleDays: number; idleCost: number | null; onHireDays: number; workedDays: number };
export type OverdueHireItem = { id: string; name: string; supplier: string | null; project: string | null; projectId: string | null; offHireDate: string | null };
export type ProjectDateExceptions = { projectId: string; projectName: string; exceptions: DateException[] };
export type SupervisorGap = { jobId: string | null; projectId: string | null; name: string; date: string; daysAway: number };
export type CrewDay = { date: string; own: number; hire: number; short: number };
export type PlantUse = { fleetPct: number | null; confidence: Confidence; allocatedDays: number; machines: number; workingDays: number; from: string; to: string };

// Tracking's "live" rule for the attention list: active, or costed in the last 30 days.
const isLive = (p: TrackingProject, today: string, rules: TrackingRules) =>
  p.status === "ACTIVE" || (p.lastDate != null && p.lastDate >= addDays(today, -rules.recentDays));

// ---------- Tracking: cost vs contract value, data gaps ----------

export function costSignals(projects: TrackingProject[], today: string, rules: TrackingRules): Signal[] {
  const out: Signal[] = [];
  for (const p of projects) {
    if (!isLive(p, today, rules)) continue;
    const subject = { type: "PROJECT" as const, id: p.id, name: p.name };
    const base = { subject, projectId: p.id, evidence: [projectRef(p.id, p.name)], href: `/tracking/${p.id}` };
    if (p.health === "ACT" || p.health === "WATCH") {
      const pct = p.contractValue ? p.forecastCost / p.contractValue : null;
      out.push({
        ...base, kind: "COST_VS_CONTRACT", dedupeKey: dedupeKeyOf("COST_VS_CONTRACT", "PROJECT", p.id),
        severity: p.health === "ACT" ? "CRITICAL" : "MEDIUM", audience: "COMMERCIAL",
        title: `${p.name}: ${p.healthReason.toLowerCase()} (${p.health === "ACT" ? "Act" : "Watch"})`,
        provisional: false, confidence: null,
        values: { health: p.health, forecast: p.forecastCost, contractValue: p.contractValue, pctOfContract: pct, spent: p.totalCost, stillToCome: p.stillToCome, locked: p.lockedCost, estimated: p.estimatedTotal, invoiced: p.invoicedTotal, watchAt: rules.watchAt, actAt: rules.actAt },
      });
    }
    if (p.health === "CANT_ASSESS" && p.totalCost >= rules.noContractMinSpend) {
      out.push({
        ...base, kind: "DATA_NO_CONTRACT_VALUE", dedupeKey: dedupeKeyOf("DATA_NO_CONTRACT_VALUE", "PROJECT", p.id),
        severity: "INFO", audience: "COMMERCIAL",
        title: `${p.name} has no contract value, so it can't be checked`,
        provisional: true, confidence: null,
        values: { spent: p.totalCost, missing: "contractValue" },
      });
    }
    if (p.uncostedCount > 0) {
      out.push({
        ...base, kind: "DATA_UNCOSTED", dedupeKey: dedupeKeyOf("DATA_UNCOSTED", "PROJECT", p.id),
        severity: "INFO", audience: "COMMERCIAL",
        title: `${p.name}: ${plural(p.uncostedCount, "allocation")} can't be costed (rate or hours missing)`,
        provisional: true, confidence: null,
        values: { uncosted: p.uncostedCount, missing: "rate or hours" },
      });
    }
  }
  return out;
}

// ---------- hire, per item ----------

export function hireSignals(projects: TrackingProject[], idle: IdleHireItem[], overdue: OverdueHireItem[], today: string, rules: TrackingRules): Signal[] {
  const out: Signal[] = [];
  for (const p of projects) {
    if (!isLive(p, today, rules)) continue;
    for (const h of p.hireItems) {
      if (h.status === "RETURNED") continue;
      const subject = { type: "RESOURCE" as const, id: h.id, name: h.name };
      const evidence = [{ recordType: "Resource", recordId: h.id, label: h.name }, projectRef(p.id, p.name)];
      const who = h.supplier && !h.name.toLowerCase().includes(h.supplier.toLowerCase()) ? ` (${h.supplier})` : "";
      const open = h.daysToDate - h.daysInvoiced;
      // Same rule as Tracking's attention line (an estimate to chase).
      if (open >= rules.hireUninvoicedDays && h.costToDate) {
        out.push({
          kind: "HIRE_UNINVOICED", subject, projectId: p.id, dedupeKey: dedupeKeyOf("HIRE_UNINVOICED", "RESOURCE", h.id),
          severity: "MEDIUM", audience: "COMMERCIAL",
          title: `${h.name}${who} on ${p.name}: ${open} working days on hire with no invoice yet`,
          provisional: false, confidence: "MEDIUM", evidence, href: `/tracking/${p.id}`,
          values: { workingDaysUninvoiced: open, daysOnHire: h.daysToDate, daysInvoiced: h.daysInvoiced, estimateToDate: h.costToDate, dayRate: h.dayRate },
        });
      }
      // No expected finish: what's still to come on it can't be known.
      if (!h.offHireDate || !ISO.test(h.offHireDate)) {
        out.push({
          kind: "HIRE_NO_FINISH", subject, projectId: p.id, dedupeKey: dedupeKeyOf("HIRE_NO_FINISH", "RESOURCE", h.id),
          severity: "INFO", audience: "OPERATIONAL",
          title: `${h.name}${who} on ${p.name} has no expected finish date`,
          provisional: true, confidence: null, evidence, href: "/hire",
          values: { missing: "offHireDate", rateMissing: h.dayRate == null },
        });
      }
    }
  }
  // Hired items not on any job (Tracking's idle hire - not charged to a site).
  for (const h of idle) {
    out.push({
      kind: "HIRE_IDLE", subject: { type: "RESOURCE", id: h.id, name: h.name }, projectId: null,
      dedupeKey: dedupeKeyOf("HIRE_IDLE", "RESOURCE", h.id), severity: "MEDIUM", audience: "COMMERCIAL",
      title: `${h.name}${h.agency ? ` (${h.agency})` : ""}: on hire ${plural(h.idleDays, "day")} without being on a job${h.overdue ? ", past its finish date" : ""}`,
      provisional: h.idleCost == null, confidence: "MEDIUM",
      evidence: [{ recordType: "Resource", recordId: h.id, label: h.name }], href: "/hire",
      values: { idleDays: h.idleDays, onHireDays: h.onHireDays, workedDays: h.workedDays, idleCost: h.idleCost, overdue: h.overdue, ...(h.idleCost == null ? { missing: "rate" } : {}) },
    });
  }
  // Still out past the expected finish (the Hire page's off-hire alert).
  for (const h of overdue) {
    out.push({
      kind: "HIRE_OVERDUE", subject: { type: "RESOURCE", id: h.id, name: h.name }, projectId: h.projectId,
      dedupeKey: dedupeKeyOf("HIRE_OVERDUE", "RESOURCE", h.id), severity: "HIGH", audience: "OPERATIONAL",
      title: `${h.name}${h.supplier ? ` (${h.supplier})` : ""}${h.project ? ` on ${h.project}` : ""} is still out past its off-hire date${h.offHireDate ? ` (${h.offHireDate})` : ""}`,
      provisional: false, confidence: "HIGH",
      evidence: [{ recordType: "Resource", recordId: h.id, label: h.name }, ...(h.projectId && h.project ? [projectRef(h.projectId, h.project)] : [])],
      href: "/hire", values: { offHireDate: h.offHireDate },
    });
  }
  return out;
}

// ---------- project dates ----------

// Disagreements with the board are worth a look; missing information is a gap.
const DATE_SEVERITY: Record<DateExceptionCode, Priority> = {
  DATE_INACTIVE_HAS_JOBS: "MEDIUM", DATE_COMPLETED_HAS_JOBS: "MEDIUM", DATE_START_MISMATCH: "MEDIUM",
  DATE_JOBS_AFTER_COMPLETION: "MEDIUM", DATE_COMPLETION_PASSED: "MEDIUM",
  DATE_NO_START: "INFO", DATE_TBC_REVIEW_DUE: "INFO", DATE_JOBS_NO_TIMES: "INFO",
};

export function dateSignals(rows: ProjectDateExceptions[]): Signal[] {
  return rows.flatMap((r) => r.exceptions.map((e): Signal => ({
    kind: e.code, subject: { type: "PROJECT", id: r.projectId, name: r.projectName }, projectId: r.projectId,
    dedupeKey: dedupeKeyOf(e.code, "PROJECT", r.projectId), severity: DATE_SEVERITY[e.code], audience: "OPERATIONAL",
    title: `${r.projectName}: ${e.text}`,
    provisional: e.code === "DATE_NO_START", confidence: null,
    evidence: [projectRef(r.projectId, r.projectName)], href: `/projects/${r.projectId}`,
    values: { code: e.code, ...(e.code === "DATE_NO_START" ? { missing: "startDate" } : {}) },
  })));
}

// ---------- readiness and people ----------

export function startSignals(starts: StartAlertDTO[]): Signal[] {
  return starts.map((s) => ({
    kind: "START_NOT_READY", subject: { type: "PROJECT", id: s.projectId, name: s.name }, projectId: s.projectId,
    // The start date is part of the key: a moved start is a new problem.
    dedupeKey: dedupeKeyOf("START_NOT_READY", "PROJECT", s.projectId, s.startDate),
    severity: s.level === "critical" ? "CRITICAL" : "HIGH", audience: "OPERATIONAL",
    title: `${s.name} starts ${s.startDate}: ${s.issues.join(", ").toLowerCase()}`,
    provisional: false, confidence: "HIGH",
    evidence: [projectRef(s.projectId, s.name)], href: `/command?date=${s.startDate}`,
    values: { startDate: s.startDate, daysAway: s.daysAway, crew: s.crew, plant: s.plant, noJobYet: s.noJobYet },
  }));
}

export function supervisorSignals(gaps: SupervisorGap[]): Signal[] {
  return gaps.map((g) => {
    // A project's day; a one-off job (no project) by its own id.
    const subject = g.projectId
      ? { type: "PROJECT" as const, id: g.projectId, name: g.name }
      : { type: "JOB" as const, id: g.jobId ?? `${g.name}|${g.date}`, name: g.name };
    return {
      kind: "NO_SUPERVISOR", subject, projectId: g.projectId,
      dedupeKey: dedupeKeyOf("NO_SUPERVISOR", subject.type, subject.id, g.projectId ? g.date : undefined),
      severity: g.daysAway <= 2 ? "CRITICAL" : "MEDIUM", audience: "OPERATIONAL",
      title: `${g.name} on ${g.date}: crew booked but no supervisor or lead`,
      provisional: false, confidence: "HIGH",
      evidence: [g.projectId ? projectRef(g.projectId, g.name) : { recordType: "Job", recordId: g.jobId ?? "", label: g.name }],
      href: `/command?date=${g.date}`, values: { date: g.date, daysAway: g.daysAway },
    } satisfies Signal;
  });
}

export function crewSignals(shortDays: CrewDay[], available: number): Signal[] {
  return shortDays.map((d) => ({
    kind: "CREW_SHORT", subject: { type: "COMPANY", id: "crew", name: "Crew" }, projectId: null,
    dedupeKey: dedupeKeyOf("CREW_SHORT", "COMPANY", "crew", d.date), severity: "MEDIUM", audience: "OPERATIONAL",
    title: `${d.date}: ${d.own} own crew booked, ${available} available (${d.short} short)`,
    provisional: false, confidence: "MEDIUM", evidence: [], href: `/command?date=${d.date}`,
    values: { date: d.date, booked: d.own, available, short: d.short, labourHireBooked: d.hire },
  }));
}

// ---------- company-wide ----------

export function daysNotClosedSignal(days: string[]): Signal[] {
  const n = days.length;
  if (n <= THRESHOLDS.daysNotClosedWarn) return [];
  return [{
    kind: "DAYS_NOT_CLOSED", subject: { type: "COMPANY", id: "days", name: "Day Review" }, projectId: null,
    dedupeKey: dedupeKeyOf("DAYS_NOT_CLOSED", "COMPANY", "days"),
    severity: n > THRESHOLDS.daysNotClosedCritical ? "HIGH" : "MEDIUM", audience: "COMMERCIAL",
    title: `${plural(n, "past day")} not closed in Day Review, so their costs can still move`,
    provisional: false, confidence: "HIGH", evidence: [], href: "/day-review",
    values: { days: n, oldest: days[0] ?? null, newest: days[n - 1] ?? null, warnAbove: THRESHOLDS.daysNotClosedWarn, highAbove: THRESHOLDS.daysNotClosedCritical, draftThreshold: true },
  }];
}

export function plantSignal(p: PlantUse): Signal[] {
  if (p.confidence !== "LOW") return [];
  return [{
    kind: "DATA_PLANT_NOT_BOOKED", subject: { type: "COMPANY", id: "plant", name: "Owned plant" }, projectId: null,
    dedupeKey: dedupeKeyOf("DATA_PLANT_NOT_BOOKED", "COMPANY", "plant"), severity: "INFO", audience: "OPERATIONAL",
    title: `Owned plant was on the board for ${plural(p.allocatedDays, "machine-day")} in 4 weeks - plant on site probably isn't being booked`,
    provisional: true, confidence: "LOW", evidence: [], href: "/plant",
    values: { allocatedDays: p.allocatedDays, machines: p.machines, workingDays: p.workingDays, fleetPct: p.fleetPct, from: p.from, to: p.to, missing: "plant bookings on the board" },
  }];
}

// ---------- won tenders (G5) ----------

// A won tender (from Estimating's won-tenders.v1, imported ones already left
// out) that matches no Operations project after a few days. Directors only -
// it carries the awarded value. Matching: lib/insights/pipeline.ts matchWon.
export type WonTenderInput = {
  tender_id: string; quoteNo: string; jobNo: string | null; name: string; builder_awarded: string;
  won_date: string | null; awarded_value_ex_gst: number | null; project: { id: string; name: string } | null;
};

export function wonNoProjectSignals(rows: WonTenderInput[], today: string): Signal[] {
  const grace = THRESHOLDS.wonNoProjectDays;
  return rows
    .filter((r) => !r.project && (r.won_date == null || daysBetween(r.won_date, today) >= grace))
    .map((r) => {
      const days = r.won_date ? daysBetween(r.won_date, today) : null;
      const label = `${r.quoteNo}${r.name ? ` ${r.name}` : ""}`;
      return {
        kind: "TENDER_WON_NO_PROJECT", subject: { type: "TENDER", id: r.tender_id, name: label }, projectId: null,
        dedupeKey: dedupeKeyOf("TENDER_WON_NO_PROJECT", "TENDER", r.tender_id), severity: "MEDIUM", audience: "DIRECTOR",
        title: `Won tender ${label} has no Operations project${days != null ? ` (won ${plural(days, "day")} ago)` : ""}`,
        provisional: r.won_date == null || !r.jobNo,
        confidence: r.jobNo ? "MEDIUM" : "LOW",
        evidence: [{ recordType: "Tender", recordId: r.tender_id, label }],
        href: "/directors/pipeline",
        values: {
          quoteNo: r.quoteNo, jobNo: r.jobNo, wonDate: r.won_date, daysSinceWon: days, builder: r.builder_awarded || null,
          awardedValue: r.awarded_value_ex_gst, graceDays: grace, draftThreshold: true,
          missing: [r.jobNo ? "" : "job number in Estimating", r.won_date ? "" : "won date"].filter(Boolean).join(", ") || null,
        },
      } satisfies Signal;
    });
}

// ---------- all of them ----------

export type SignalInputs = {
  today: string;
  rules: TrackingRules;
  projects: TrackingProject[];
  idleHire: IdleHireItem[];
  overdueHire: OverdueHireItem[];
  dates: ProjectDateExceptions[];
  starts: StartAlertDTO[];
  supervisorGaps: SupervisorGap[];
  crewShortDays: CrewDay[];
  crewAvailable: number;
  daysNotClosed: string[];
  plant: PlantUse;
  // null = Estimating didn't answer: the check wasn't run (see NOT_CHECKED), not "nothing found"
  wonTenders?: WonTenderInput[] | null;
};

// Which signal kinds weren't looked at this run, so the engine leaves their
// findings exactly as they are instead of treating them as cleared.
export function notChecked(i: Pick<SignalInputs, "wonTenders">): SignalKind[] {
  return i.wonTenders == null ? ["TENDER_WON_NO_PROJECT"] : [];
}

const RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

export function buildSignals(i: SignalInputs): Signal[] {
  return [
    ...costSignals(i.projects, i.today, i.rules),
    ...hireSignals(i.projects, i.idleHire, i.overdueHire, i.today, i.rules),
    ...dateSignals(i.dates),
    ...startSignals(i.starts),
    ...supervisorSignals(i.supervisorGaps),
    ...crewSignals(i.crewShortDays, i.crewAvailable),
    ...daysNotClosedSignal(i.daysNotClosed),
    ...plantSignal(i.plant),
    ...(i.wonTenders ? wonNoProjectSignals(i.wonTenders, i.today) : []),
  ].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.dedupeKey.localeCompare(b.dedupeKey));
}

// Money guard for the OPERATIONAL audience (Viewer+): no dollar figure in the
// words, and no money-named value. Tested over every signal kind.
const MONEY_KEYS = /cost|rate|forecast|spent|invoic|contract|estimate|locked|stillToCome/i;
export function operationalIsMoneyFree(s: Signal): boolean {
  if (s.audience !== "OPERATIONAL") return true;
  const keys = Object.keys(s.values).filter((k) => k !== "rateMissing");
  return assertNoMoney(s.title) && assertNoMoney(JSON.stringify(s.values)) && !keys.some((k) => MONEY_KEYS.test(k));
}

export const countByKind = (signals: Signal[]) =>
  signals.reduce<Record<string, number>>((m, s) => { m[s.kind] = (m[s.kind] ?? 0) + 1; return m; }, {});
