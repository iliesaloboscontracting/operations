// Director Insights KPI maths (24 Oct 2026). Plain functions over data the
// loader (lib/insights/load.ts) has already fetched, so each one can be
// tested with a hand-worked example (kpis.test.ts). Costs are never worked
// out here - they come from Project Tracking (lib/trackingData.ts) and are
// only summed with trackingView's helpers. Definitions: lib/insights/dictionary.ts.
import type { AttentionItemDTO, ProjectCostDTO, StartAlertDTO } from "../types";
import { addDays, daysBetween, endOfMonth, parseISO, rangeDays, startOfMonth, startOfWeek } from "../dates";
import { sumProjects } from "../trackingView";
import { THRESHOLDS } from "./dictionary";
import type { DirectorOverviewDTO } from "./load";

export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";
export const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

export type AlertLink = { label: string; detail?: string; href: string };
export type AlertDTO = { priority: Priority; kpi: string; title: string; hint: string; href: string | null; links?: AlertLink[] };

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const whenAway = (d: number) => (d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

// ---------- cost (F1, F3, F5, F7, F8) ----------

export type CostPosition = {
  monthSoFar: { total: number; firm: number; estimated: number };
  lastMonthSameDays: number;
  health: { act: number; watch: number; onTrack: number; cantAssess: number };
  stillToCome: number;
  uncosted: number;
  unconfirmed: number;
  // Last full month, 0-1. Not this month: labour hire only counts once the
  // agency invoices, which lags weeks, so a part month always reads low.
  labourHireShare: number | null;
  labourHireMonth: string; // YYYY-MM-01 of the month it's for
};

// Spend this month so far vs the same days of last month (1st to the same
// day number, or last month's end if it's shorter).
export function costPosition(projects: ProjectCostDTO[], today: string): CostPosition {
  const from = startOfMonth(today);
  const m = sumProjects(projects, { from, to: today, label: "", partial: true });
  const lastStart = startOfMonth(addDays(from, -1));
  const lastEnd = endOfMonth(lastStart);
  const sameDay = addDays(lastStart, daysBetween(from, today));
  const last = sumProjects(projects, { from: lastStart, to: sameDay < lastEnd ? sameDay : lastEnd, label: "", partial: false });
  const lastFull = sumProjects(projects, { from: lastStart, to: lastEnd, label: "", partial: false });
  const active = projects.filter((p) => p.status === "ACTIVE");
  const count = (h: string) => active.filter((p) => p.health === h).length;
  return {
    monthSoFar: { total: m.total, firm: m.locked + m.invoiced, estimated: m.estimated },
    lastMonthSameDays: last.total,
    health: { act: count("ACT"), watch: count("WATCH"), onTrack: count("ON_TRACK"), cantAssess: count("CANT_ASSESS") },
    stillToCome: active.reduce((n, p) => n + p.stillToCome, 0),
    uncosted: projects.reduce((n, p) => n + p.uncostedCount, 0),
    unconfirmed: projects.reduce((n, p) => n + p.unconfirmedCount, 0),
    labourHireShare: labourHireShare(lastFull.cat),
    labourHireMonth: lastStart,
  };
}

// How sure the month's spend is (dictionary "confidence"): HIGH = nearly all
// locked or invoiced with every line priced on a confirmed rate; LOW = lines
// can't be priced, or most of it is still an estimate.
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export function costConfidence(c: Pick<CostPosition, "monthSoFar" | "uncosted" | "unconfirmed">): Confidence {
  const { total, firm } = c.monthSoFar;
  const firmShare = total > 0 ? firm / total : 1;
  if (c.uncosted > 0 || firmShare < 0.5) return "LOW";
  if (c.unconfirmed === 0 && firmShare >= 0.9) return "HIGH";
  return "MEDIUM";
}

export function labourHireShare(cat: { ownCrew?: number; labourHire?: number }): number | null {
  const own = cat.ownCrew ?? 0, hire = cat.labourHire ?? 0;
  return own + hire > 0 ? hire / (own + hire) : null;
}

// Hired plant still out (F6): estimate to date of items not returned plus
// what's still to come to their finish. From Tracking's hire items.
export function hiredPlantOut(projects: ProjectCostDTO[]) {
  let toDate = 0, items = 0;
  for (const p of projects)
    for (const h of p.hireItems)
      if (h.status !== "RETURNED") { items++; toDate += h.costToDate ?? 0; }
  const toCome = projects.reduce((n, p) => n + p.hireToCome, 0);
  return { items, toDate, toCome, total: toDate + toCome };
}

// Tracking's own attention list, in director priorities: Act is a cost
// decision (critical), Watch a heads-up, data gaps information only.
export function trackingAlerts(attention: AttentionItemDTO[]): AlertDTO[] {
  const pr: Record<AttentionItemDTO["level"], Priority> = { act: "CRITICAL", watch: "MEDIUM", data: "INFO" };
  return attention.map((a) => ({
    priority: pr[a.level],
    kpi: a.level === "data" ? "DQ" : "F3",
    title: a.projectId ? `${a.projectName}: ${a.text}` : a.projectName === "Hire" ? `Hire: ${a.text}` : a.text,
    hint: a.hint,
    href: a.projectId ? `/tracking/${a.projectId}` : a.projectName === "Hire" ? "/hire" : "/tracking",
    links: a.jobs?.map((j) => ({ label: j.name, detail: j.detail, href: `/tracking/${j.id}` })),
  }));
}

// ---------- workload (O1, O2, O4) ----------

export type ProjectMeta = {
  id: string; name: string; status: string; archived: boolean;
  startDate: string | null; startDateConfidence: string | null;
  expectedCompletion: string | null; completionConfidence: string | null; completionReviewBy: string | null;
  recentOrFutureJob: boolean; // a running job in the last 14 days or any time ahead
};
export type DatedProject = { id: string; name: string; date: string; confidence: string | null };

export function workload(projects: ProjectMeta[], today: string) {
  const live = projects.filter((p) => p.status === "ACTIVE" && !p.archived);
  const active = live.filter((p) => p.recentOrFutureJob);
  const until = addDays(today, THRESHOLDS.startsWindowDays);
  const within = (d: string | null) => d != null && d >= today && d <= until;
  const starting: DatedProject[] = live.filter((p) => within(p.startDate))
    .map((p) => ({ id: p.id, name: p.name, date: p.startDate!, confidence: p.startDateConfidence }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const completing: DatedProject[] = active.filter((p) => within(p.expectedCompletion))
    .map((p) => ({ id: p.id, name: p.name, date: p.expectedCompletion!, confidence: p.completionConfidence }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    active: active.length,
    starting,
    startingConfirmed: starting.filter((s) => s.confidence === "CONFIRMED").length,
    startingTentative: starting.filter((s) => s.confidence === "TENTATIVE").length,
    completing,
    missingDates: active.filter((p) => !p.startDate || !p.expectedCompletion).map((p) => ({ id: p.id, name: p.name })),
    reviewOverdue: active.filter((p) => p.completionReviewBy != null && p.completionReviewBy < today).map((p) => ({ id: p.id, name: p.name })),
  };
}

export function startAlerts(starts: StartAlertDTO[]): AlertDTO[] {
  return starts.map((s) => ({
    priority: s.level === "critical" ? "CRITICAL" : "HIGH",
    kpi: "O3",
    title: `${s.name} starts ${whenAway(s.daysAway)}: ${s.issues.join(", ").toLowerCase()}`,
    hint: "Put a supervisor or lead on the start day",
    href: "/calendar",
  }));
}

// ---------- people (P1, P2, P3, P4) ----------

export const isLeadRole = (role: string | null | undefined) => role === "Supervisor" || role === "Lead";

export type UpcomingJob = {
  jobId?: string; projectId: string | null; projectName: string; date: string;
  ownCrewIds: string[]; labourHire: number; hasLead: boolean;
};

// Booked crew per day over the look-ahead vs own crew available. Weekdays
// always show; a weekend day only when something's booked on it.
export function crewDemand(jobs: UpcomingJob[], availableCrew: number, today: string) {
  const end = addDays(today, THRESHOLDS.lookaheadDays - 1);
  const byDay = new Map<string, { own: Set<string>; hire: number }>();
  for (const j of jobs) {
    if (j.date < today || j.date > end) continue;
    const d = byDay.get(j.date) ?? { own: new Set<string>(), hire: 0 };
    for (const id of j.ownCrewIds) d.own.add(id);
    d.hire += j.labourHire;
    byDay.set(j.date, d);
  }
  const days = rangeDays(today, end)
    .filter((d) => { const g = parseISO(d).getDay(); return (g !== 0 && g !== 6) || byDay.has(d); })
    .map((date) => {
      const d = byDay.get(date);
      const own = d?.own.size ?? 0;
      return { date, own, hire: d?.hire ?? 0, short: Math.max(0, own - availableCrew) };
    });
  return { available: availableCrew, days, shortDays: days.filter((d) => d.short > 0) };
}

// Running jobs in the look-ahead with crew but nobody in charge. Start days
// are left to the starts alert so a job isn't flagged twice.
export function supervisorGaps(jobs: UpcomingJob[], today: string, startKeys: Set<string>) {
  const end = addDays(today, THRESHOLDS.lookaheadDays - 1);
  return jobs
    .filter((j) => j.date >= today && j.date <= end && j.ownCrewIds.length + j.labourHire > 0 && !j.hasLead)
    .filter((j) => !startKeys.has(`${j.projectId}|${j.date}`))
    .map((j) => ({ jobId: j.jobId ?? null, projectId: j.projectId, name: j.projectName, date: j.date, daysAway: daysBetween(today, j.date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function supervisorAlerts(gaps: ReturnType<typeof supervisorGaps>): AlertDTO[] {
  const soon = gaps.filter((g) => g.daysAway <= 2);
  const later = gaps.filter((g) => g.daysAway > 2);
  const out: AlertDTO[] = soon.map((g) => ({
    priority: "CRITICAL", kpi: "P4",
    title: `${g.name} ${whenAway(g.daysAway)}: crew booked but no supervisor or lead`,
    hint: "Allocate a supervisor or lead", href: `/command?date=${g.date}`,
  }));
  if (later.length) out.push({
    priority: "MEDIUM", kpi: "P4",
    title: `${plural(later.length, "job")} in the next two weeks with crew but no supervisor or lead`,
    hint: "Allocate before the day", href: "/command",
    links: later.map((g) => ({ label: g.name, detail: g.date, href: `/command?date=${g.date}` })),
  });
  return out;
}

// Signed hours per Monday week, staff vs hire workers. Weeks before the
// first full tracked week are marked incomplete (sign-ins began 19 Oct 2026,
// 19-25 Oct was the trial).
export const SIGN_IN_FULL_FROM = "2026-10-26";
export function hoursByWeek(rows: { date: string; hours: number | null; isHire: boolean }[], today: string, weeks: number) {
  const thisMon = startOfWeek(today);
  return Array.from({ length: weeks }, (_, k) => {
    const week = addDays(thisMon, -7 * (weeks - 1 - k));
    const end = addDays(week, 6);
    let staff = 0, hire = 0;
    for (const r of rows) {
      if (r.hours == null || r.date < week || r.date > end) continue;
      if (r.isHire) hire += r.hours; else staff += r.hours;
    }
    return { week, staff: Math.round(staff * 10) / 10, hire: Math.round(hire * 10) / 10, partial: week === thisMon, incomplete: week < SIGN_IN_FULL_FROM };
  });
}

// ---------- plant (PL1, PL2) ----------

// Working days = Mon-Fri, plus any Saturday something ran. Use counts only
// working days, so a Sunday call-out can't push a machine past 100%.
export function workingDays(from: string, to: string, worked: Set<string>) {
  return rangeDays(from, to).filter((d) => {
    const g = parseISO(d).getDay();
    return (g >= 1 && g <= 5) || (g === 6 && worked.has(d));
  });
}

export function plantUse(
  plant: { id: string; name: string; status: string }[],
  allocations: { resourceId: string; date: string }[],
  worked: Set<string>,
  today: string,
) {
  const to = addDays(today, -1);
  const from = addDays(today, -THRESHOLDS.plantWindowDays);
  const wd = new Set(workingDays(from, to, worked));
  const daysOn = new Map<string, Set<string>>();
  for (const a of allocations) {
    if (!wd.has(a.date)) continue;
    const s = daysOn.get(a.resourceId) ?? new Set<string>();
    s.add(a.date);
    daysOn.set(a.resourceId, s);
  }
  const items = plant.map((p) => {
    const days = daysOn.get(p.id)?.size ?? 0;
    const pct = wd.size ? days / wd.size : 0;
    return { id: p.id, name: p.name, days, pct, idle: pct < THRESHOLDS.idlePlantBelow, down: p.status === "DOWN" };
  }).sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
  const used = items.reduce((n, i) => n + i.days, 0);
  const fleetPct = items.length && wd.size ? used / (items.length * wd.size) : null;
  return {
    from, to, workingDays: wd.size, allocatedDays: used,
    fleetPct,
    // Use only counts what's put on the board. Under 10% across the fleet
    // almost always means plant on site isn't being booked day to day
    // (24 Oct 2026 copy: 2 plant allocations in 4 weeks), not idle plant.
    confidence: (fleetPct == null || fleetPct < 0.1 ? "LOW" : "MEDIUM") as Confidence,
    items, idle: items.filter((i) => i.idle).length, down: items.filter((i) => i.down).length,
  };
}

export function offHireAlerts(overdue: { name: string; supplier: string | null; project: string | null }[]): AlertDTO[] {
  if (!overdue.length) return [];
  return [{
    priority: "HIGH", kpi: "PL3",
    title: `${plural(overdue.length, "hired item")} still out past the off-hire date`,
    hint: "Off-hire it, or extend the finish date if it's still needed", href: "/hire",
    links: overdue.map((o) => ({ label: o.name, detail: [o.supplier, o.project].filter(Boolean).join(" · ") || undefined, href: "/hire" })),
  }];
}

// ---------- site requests (O6) ----------

const CLOSED_REQUEST = new Set(["DONE", "DECLINED", "CANCELLED", "CANT_DO"]);
export type RequestRow = { id: string; number: number; priority: string; status: string; neededBy: Date; summary: string; siteLabel: string };

export function requestSummary(rows: RequestRow[], now: Date) {
  const open = rows.filter((r) => !CLOSED_REQUEST.has(r.status));
  const overdue = open.filter((r) => r.neededBy.getTime() < now.getTime());
  const by = (p: string) => open.filter((r) => r.priority === p).length;
  return { open: open.length, urgent: by("URGENT"), high: by("HIGH"), low: by("LOW"), overdue };
}

export function requestAlerts(overdue: RequestRow[], now: Date): AlertDTO[] {
  const out: AlertDTO[] = [];
  const late = (r: RequestRow) => {
    const h = Math.max(1, Math.round((now.getTime() - r.neededBy.getTime()) / 3_600_000));
    return h < 48 ? `${h}h` : `${Math.round(h / 24)} days`;
  };
  const ref = (r: RequestRow) => `R-${String(r.number).padStart(4, "0")}`;
  for (const r of overdue.filter((r) => r.priority === "URGENT"))
    out.push({ priority: "CRITICAL", kpi: "O6", title: `Urgent request ${ref(r)} (${r.siteLabel}) is ${late(r)} past its needed-by: ${r.summary}`, hint: "Decide or action it on Requests", href: "/requests" });
  const rest = overdue.filter((r) => r.priority !== "URGENT");
  if (rest.length) out.push({
    priority: rest.some((r) => r.priority === "HIGH") ? "HIGH" : "MEDIUM", kpi: "O6",
    title: `${plural(rest.length, "site request")} past the needed-by time`,
    hint: "Work through them on Requests", href: "/requests",
    links: rest.map((r) => ({ label: `${ref(r)} ${r.siteLabel}`, detail: late(r), href: "/requests" })),
  });
  return out;
}

// ---------- days not closed (O5) ----------

export function daysNotClosed(jobDates: string[], closed: Set<string>, today: string, cutoff: string) {
  return [...new Set(jobDates)].filter((d) => d > cutoff && d < today && !closed.has(d)).sort();
}

export function daysNotClosedAlert(days: string[]): AlertDTO[] {
  const n = days.length;
  if (n <= THRESHOLDS.daysNotClosedWarn) return [];
  return [{
    priority: n > THRESHOLDS.daysNotClosedCritical ? "HIGH" : "MEDIUM", kpi: "O5",
    title: `${plural(n, "past day")} not closed in Day Review, so their costs can still move`,
    hint: `Close them in Day Review (oldest ${days[0]})`, href: "/day-review",
  }];
}

// ---------- putting it together ----------

export function sortAlerts(alerts: AlertDTO[]) {
  return [...alerts].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

// The weekly snapshot (KpiSnapshot rows) from an overview. A snapshot taken
// on any day but the Monday - e.g. the first deploy mid-week, or the server
// down on Monday - is marked partial so it's never compared as a full week.
export type SnapshotRow = { kpi: string; value: number | null; detail: string; confidence: Confidence | null };
// Every KPI a weekly snapshot holds - snapshotRows writes exactly these (tested).
export const SNAPSHOT_KPIS = [
  "O1", "O2", "O3", "O4", "O5", "O6", "F3_ACT", "F3_WATCH", "F3_ON_TRACK", "F3_CANT_ASSESS", "F2", "F1_LAST_WEEK",
  "F5", "F6", "F7", "F8", "P1_LAST_WEEK", "P2", "PL1", "PL2", "PL3",
] as const;
export function snapshotRows(o: DirectorOverviewDTO, today: string): { weekStart: string; rows: SnapshotRow[] } {
  const weekStart = startOfWeek(today);
  const partial = today !== weekStart;
  const lastFullWeek = o.cost.trend[o.cost.trend.length - 2];
  const lastHours = o.people.hours[o.people.hours.length - 2];
  const detail = (extra: Record<string, unknown> = {}) => JSON.stringify({ partial, takenOn: today, ...extra });
  const row = (kpi: string, value: number | null, confidence: Confidence | null = "HIGH", extra?: Record<string, unknown>): SnapshotRow =>
    ({ kpi, value: value == null || Number.isNaN(value) ? null : Math.round(value * 100) / 100, detail: detail(extra), confidence });
  return {
    weekStart,
    rows: [
      row("O1", o.workload.active),
      row("O2", o.workload.starting.length, "MEDIUM", { confirmed: o.workload.startingConfirmed, tentative: o.workload.startingTentative }),
      row("O3", o.workload.notReady),
      row("O4", o.workload.completing.length, "MEDIUM"),
      row("O5", o.dataQuality.find((d) => d.id === "notClosed")?.count ?? null),
      row("O6", o.requests.open, "HIGH", { urgent: o.requests.urgent, overdue: o.requests.overdue }),
      row("F3_ACT", o.cost.health.act, o.cost.confidence),
      row("F3_WATCH", o.cost.health.watch, o.cost.confidence),
      row("F3_ON_TRACK", o.cost.health.onTrack, o.cost.confidence),
      row("F3_CANT_ASSESS", o.cost.health.cantAssess),
      row("F2", o.cost.stillToCome, "MEDIUM"),
      row("F1_LAST_WEEK", lastFullWeek?.total ?? null, o.cost.confidence, { week: lastFullWeek?.week }),
      row("F5", o.people.labourHireShare, o.cost.confidence),
      row("F6", o.cost.hiredPlant.total, "MEDIUM", { items: o.cost.hiredPlant.items }),
      row("F7", o.cost.uncosted),
      row("F8", o.cost.unconfirmed),
      row("P1_LAST_WEEK", lastHours ? lastHours.staff + lastHours.hire : null, lastHours?.incomplete ? "LOW" : "HIGH", { week: lastHours?.week, staff: lastHours?.staff, hire: lastHours?.hire }),
      row("P2", o.people.activeCrew),
      row("PL1", o.plant.fleetPct, o.plant.confidence, { machines: o.plant.machines, idle: o.plant.idle, allocatedDays: o.plant.allocatedDays }),
      row("PL2", o.plant.down),
      row("PL3", o.plant.overdueOffHire),
    ],
  };
}

// A trend comparison only when the earlier snapshot was a full week - a
// part-week snapshot (first deploy mid-week) is never compared (lead review).
export function trendVs(now: number | null, before: { value: number | null; partial: boolean } | null) {
  if (now == null || !before || before.partial || before.value == null) return null;
  return { before: before.value, diff: now - before.value };
}
