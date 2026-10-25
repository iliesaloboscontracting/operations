// Director Insights loader (24 Oct 2026): fetches what the Directors
// overview needs and runs it through the plain KPI functions in ./kpis.ts.
// Read-only - nothing here writes. Costs come from Project Tracking's own
// loader, so a Directors number and a Tracking number can't disagree.
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { addDays, startOfWeek } from "../dates";
import { upcomingStarts } from "../alerts";
import { offHireAlert } from "../hireEstimate";
import { POINT_BREAK_MINUTES, signedHours } from "../signin";
import { weeklyByCategory } from "../trackingView";
import { LABOUR_BACKFILL_CUTOFF, loadTracking } from "../trackingData";
import type { ProjectCostDTO } from "../types";
import { NOT_YET_AVAILABLE, THRESHOLDS } from "./dictionary";
import { toFindingDTO, sortFindings } from "../findings/view";
import { lessonHints } from "../lessons/store";
import { companyHealth } from "./health";
import { screenFor } from "../findings/config";
import { pipelineTile } from "./pipeline";
import { OFFICE_KINDS } from "../requestTypes";
import { loadPipelineState } from "./pipelineFeed";
import { loadXeroHealth } from "../xero/imports";
import {
  costConfidence, costPosition, crewDemand, daysNotClosed, daysNotClosedAlert, hiredPlantOut, hoursByWeek,
  isLeadRole, offHireAlerts, plantUse, requestAlerts, requestSummary, sortAlerts, startAlerts, supervisorAlerts,
  supervisorGaps, trackingAlerts, trendVs, workload, type UpcomingJob,
} from "./kpis";

const dayStart = (iso: string) => new Date(iso + "T00:00:00.000Z"); // Job.date is UTC midnight of the calendar day
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

// Everything the overview and the findings signals (lib/findings/signals.ts)
// both read, fetched once and worked through the same KPI functions - so a
// signal and the Directors page can't disagree.
export async function gatherDirectorInputs() {
  const today = todaySydney();
  const now = new Date();
  // Past jobs are needed from the plant-use window or the day after the
  // history cut-off (days-not-closed), whichever is earlier.
  const windowFrom = addDays(today, -THRESHOLDS.plantWindowDays);
  const afterCutoff = addDays(LABOUR_BACKFILL_CUTOFF, 1);
  const pastFrom = windowFrom < afterCutoff ? windowFrom : afterCutoff;

  // Costs: Project Tracking, project-level only (no per-person pay lines).
  const tracking = await loadTracking({ withPeople: false });
  // Same shape the Tracking page reads from /api/tracking.
  const projects = tracking.projects as unknown as ProjectCostDTO[];

  const [projectRows, starts, ahead, crewCount, ownedPlant, hireOut, requests, pastJobs, closes, attendance, invoicesWaiting, hireGaps, snapshots] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false },
      select: {
        id: true, name: true, status: true, archived: true, startDate: true, startDateConfidence: true,
        expectedCompletion: true, completionConfidence: true, completionReviewBy: true,
        jobs: { where: { notRunning: false, date: { gte: dayStart(addDays(today, -14)) } }, select: { id: true }, take: 1 },
      },
    }),
    upcomingStarts(today, 7),
    prisma.job.findMany({
      where: { notRunning: false, date: { gte: dayStart(today), lt: dayStart(addDays(today, THRESHOLDS.lookaheadDays)) } },
      select: {
        id: true, projectId: true, title: true, date: true, project: { select: { name: true } },
        assignments: { select: { role: true, resourceId: true, resource: { select: { type: true, category: true } } } },
      },
    }),
    prisma.resource.count({ where: { type: "PERSONNEL", active: true, NOT: [{ status: "LEAVE" }, { category: "Office" }] } }),
    prisma.resource.findMany({ where: { type: "EQUIPMENT", ownership: "OWNED", active: true }, select: { id: true, name: true, status: true } }),
    prisma.resource.findMany({
      where: { type: "HIRE", active: true, offHireDate: { not: null }, OR: [{ hireStatus: null }, { hireStatus: { not: "RETURNED" } }] },
      select: { id: true, name: true, agency: true, offHireDate: true, hireStatus: true, onHireDate: true, hireRate: true, hireRateUnit: true, dailyRateExGst: true, hireProject: { select: { id: true, name: true } } },
    }),
    prisma.siteRequest.findMany({
      // Site requests only - directors' and accounts' queries and actions have their own board.
      where: { status: { notIn: ["DONE", "DECLINED", "CANCELLED", "CANT_DO"] }, kind: { notIn: OFFICE_KINDS } },
      select: { id: true, number: true, priority: true, status: true, neededBy: true, summary: true, siteLabel: true },
    }),
    // Past running jobs with allocations: plant use window and days not closed.
    prisma.job.findMany({
      where: { notRunning: false, date: { lt: dayStart(today), gte: dayStart(pastFrom) }, assignments: { some: {} } },
      select: { date: true, assignments: { select: { resourceId: true } } },
    }),
    prisma.dayClose.findMany({ where: { status: "CLOSED" }, select: { date: true } }),
    prisma.siteAttendance.findMany({
      where: { date: { gte: addDays(startOfWeek(today), -7 * 7) }, status: { not: "REJECTED" } },
      select: { date: true, signInAt: true, signOutAt: true, resource: { select: { type: true } }, job: { select: { project: { select: { unpaidBreakMinutes: true } } } } },
    }),
    prisma.invoiceDraft.count({ where: { status: { in: ["NEEDS_REVIEW", "NO_JOB"] } } }),
    prisma.resource.findMany({
      where: { type: "HIRE", active: true, NOT: { category: "LABOUR" }, OR: [{ hireStatus: null }, { hireStatus: { not: "RETURNED" } }] },
      select: { offHireDate: true, hireEnd: true, hireRate: true, dailyRateExGst: true },
    }),
    prisma.kpiSnapshot.findMany({ where: { weekStart: { gte: addDays(startOfWeek(today), -7 * 5) } } }),
  ]);

  // ---- workload ----
  const wl = workload(projectRows.map((p) => ({ ...p, recentOrFutureJob: p.jobs.length > 0 })), today);

  // ---- people: booked crew and supervisor coverage ----
  const upcoming: UpcomingJob[] = ahead.map((j) => {
    const own = j.assignments.filter((a) => a.resource.type === "PERSONNEL" && a.resource.category !== "Office");
    const hire = j.assignments.filter((a) => a.resource.type === "HIRE" && a.resource.category === "LABOUR");
    return {
      jobId: j.id, projectId: j.projectId, projectName: j.project?.name ?? j.title, date: isoOf(j.date),
      ownCrewIds: own.map((a) => a.resourceId), labourHire: hire.length,
      hasLead: j.assignments.some((a) => isLeadRole(a.role)),
    };
  });
  const capacity = crewDemand(upcoming, crewCount, today);
  const gaps = supervisorGaps(upcoming, today, new Set(starts.map((s) => `${s.projectId}|${s.startDate}`)));

  // ---- plant ----
  const plantIds = new Set(ownedPlant.map((p) => p.id));
  const allocations: { resourceId: string; date: string }[] = [];
  const worked = new Set<string>();
  for (const j of pastJobs) {
    const d = isoOf(j.date);
    if (d < windowFrom) continue;
    worked.add(d);
    for (const a of j.assignments) if (plantIds.has(a.resourceId)) allocations.push({ resourceId: a.resourceId, date: d });
  }
  const plant = plantUse(ownedPlant, allocations, worked, today);
  const overdueHire = hireOut
    .filter((r) => offHireAlert(r, today)?.level === "OVERDUE")
    .map((r) => ({ id: r.id, name: r.name, supplier: r.agency, project: r.hireProject?.name ?? null, projectId: r.hireProject?.id ?? null, offHireDate: r.offHireDate }));

  // ---- days not closed ----
  const open = daysNotClosed(pastJobs.map((j) => isoOf(j.date)), new Set(closes.map((c) => c.date)), today, LABOUR_BACKFILL_CUTOFF);

  return {
    today, now, tracking, projects, starts, crewCount, attendance, requests, invoicesWaiting, hireGaps, snapshots,
    wl, upcoming, capacity, gaps, plant, overdueHire, open,
  };
}

export type DirectorInputs = Awaited<ReturnType<typeof gatherDirectorInputs>>;

export async function loadDirectorOverview() {
  const {
    today, now, tracking, projects, starts, crewCount, attendance, requests, invoicesWaiting, hireGaps, snapshots,
    wl, capacity, gaps, plant, overdueHire, open,
  } = await gatherDirectorInputs();
  const hire = hiredPlantOut(projects);

  // ---- hours ----
  const hours = hoursByWeek(
    attendance.map((a) => ({
      date: a.date,
      hours: signedHours(a.signInAt, a.signOutAt, a.job ? a.job.project?.unpaidBreakMinutes ?? 0 : POINT_BREAK_MINUTES),
      isHire: a.resource?.type !== "PERSONNEL",
    })),
    today, 8,
  );

  // ---- requests ----
  const req = requestSummary(requests, now);

  // ---- cost ----
  const cost = costPosition(projects, today);

  // ---- trend vs the snapshot four weeks back ----
  const fourBack = addDays(startOfWeek(today), -28);
  const snap = (k: string) => {
    const s = snapshots.find((x) => x.weekStart === fourBack && x.kpi === k);
    if (!s) return null;
    let partial = false;
    try { partial = !!JSON.parse(s.detail ?? "{}").partial; } catch { /* not JSON - treat as full */ }
    return { value: s.value, partial };
  };
  const firstSnapshot = snapshots.reduce<string | null>((m, s) => (m == null || s.weekStart < m ? s.weekStart : m), null);

  // Stored findings (Phase 2 step 3): the open ones, and when the engine last
  // looked (its latest sighting). The computed alerts stay alongside.
  // Estimating's pipeline (G5) is fetched alongside; it never holds the page up past its timeout.
  // Xero exports uploaded by accounts (G2) feed the revenue and cash tiles.
  const [openFindings, lastSeen, closedThisWeek, pipelineState, xero] = await Promise.all([
    prisma.finding.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED", "ACTIONED"] } } }),
    prisma.finding.aggregate({ _max: { lastSeenAt: true } }),
    prisma.finding.findMany({ where: { status: { in: ["RESOLVED", "VERIFIED"] }, resolvedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, select: { ruleCode: true, audience: true } }),
    loadPipelineState(),
    loadXeroHealth(today),
  ]);
  // Task J: the directors' box shows director-level findings only; the rest are on Operations -> Attention.
  const directorFindings = openFindings.filter((f) => screenFor(f) === "DIRECTORS");
  // Lessons (phase 5a): "last time on this ..." - added only to findings that have one.
  const hints = await lessonHints(directorFindings);
  const findings = sortFindings(directorFindings.map((f) => { const d = toFindingDTO(f); const h = hints.get(f.id); return h ? { ...d, lesson: h } : d; }));

  const alerts = sortAlerts([
    ...trackingAlerts(tracking.attention),
    ...startAlerts(starts),
    ...supervisorAlerts(gaps),
    ...offHireAlerts(overdueHire),
    ...requestAlerts(req.overdue, now),
    ...daysNotClosedAlert(open),
  ]);

  const activeNoContract = projects.filter((p) => p.status === "ACTIVE" && p.health === "CANT_ASSESS").length;
  const hireNoFinish = hireGaps.filter((h) => !h.offHireDate && !h.hireEnd).length;
  const hireNoRate = hireGaps.filter((h) => h.hireRate == null && h.dailyRateExGst == null).length;

  return {
    today,
    asAt: now.toISOString(),
    alerts,
    cost: {
      ...cost,
      confidence: costConfidence(cost),
      hiredPlant: hire,
      trend: weeklyByCategory(projects.flatMap((p) => p.daily), today, 12),
    },
    workload: {
      ...wl,
      notReady: starts.length,
      activeTrend: trendVs(wl.active, snap("O1")),
    },
    capacity: { ...capacity, supervisorGaps: gaps.length },
    plant: {
      fleetPct: plant.fleetPct, workingDays: plant.workingDays, from: plant.from, to: plant.to,
      allocatedDays: plant.allocatedDays, confidence: plant.confidence,
      machines: plant.items.length, idle: plant.idle, down: plant.down,
      idleItems: plant.items.filter((i) => i.idle).map((i) => ({ name: i.name, pct: i.pct, down: i.down })),
      overdueOffHire: overdueHire.length,
    },
    people: { activeCrew: crewCount, hours, labourHireShare: cost.labourHireShare, labourHireMonth: cost.labourHireMonth },
    requests: { open: req.open, urgent: req.urgent, high: req.high, low: req.low, overdue: req.overdue.length },
    dataQuality: [
      { id: "noContract", label: "Active jobs with no contract value", count: activeNoContract, href: "/tracking" },
      { id: "noDates", label: "Active jobs missing a start or completion date", count: wl.missingDates.length, href: "/projects" },
      { id: "uncosted", label: "Allocations that can't be costed, all jobs (rate or hours missing)", count: cost.uncosted, href: "/tracking" },
      { id: "unconfirmed", label: "Allocations on unconfirmed (TBC) rates, all jobs", count: cost.unconfirmed, href: "/labour" },
      { id: "notClosed", label: "Past days not closed in Day Review", count: open.length, href: "/day-review" },
      { id: "invoices", label: "Invoices waiting for a person in the inbox", count: invoicesWaiting, href: "/invoices" },
      { id: "hireNoFinish", label: "Hired items with no expected finish date", count: hireNoFinish, href: "/hire" },
      { id: "hireNoRate", label: "Hired items with no rate", count: hireNoRate, href: "/hire" },
    ],
    notYetAvailable: NOT_YET_AVAILABLE,
    snapshotsSince: firstSnapshot,
    // Company health band (G1): the same figures as the sections below, summed up.
    health: companyHealth({
      asAt: now.toISOString(), projects, workload: wl, cost, costConfidence: costConfidence(cost),
      capacity, supervisorGaps: gaps.length, activeCrew: crewCount, hours, pipeline: pipelineTile(pipelineState),
      revenue: xero.revenue, cash: xero.cash,
    }),
    findings,
    findingsMeta: {
      checkedAt: lastSeen._max.lastSeenAt?.toISOString() ?? null,
      open: findings.length,
      bySeverity: findings.reduce<Record<string, number>>((m, f) => { m[f.severity] = (m[f.severity] ?? 0) + 1; return m; }, {}),
      signalCleared: findings.filter((f) => f.signalClearedAt).length,
      closedThisWeek: closedThisWeek.filter((f) => screenFor(f) === "DIRECTORS").length,
    },
  };
}

export type DirectorOverviewDTO = Awaited<ReturnType<typeof loadDirectorOverview>>;
