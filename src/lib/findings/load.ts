// Findings signals loader (24 Oct 2026): fetches what lib/findings/signals.ts
// needs - through the Directors loader (so a signal and the Directors page
// read the same figures) plus the Projects page's date exceptions - and
// builds the list. Read-only; nothing is stored yet (that's step 2).
import { prisma } from "../prisma";
import { boardDatesByProject, dateExceptionList } from "../dateExceptions";
import { ACT_AT, ATTENTION_RECENT_DAYS, HIRE_UNINVOICED_DAYS, NO_CONTRACT_MIN_SPEND, WATCH_AT } from "../trackingData";
import { gatherDirectorInputs } from "../insights/load";
import { loadWonMatches } from "../insights/pipelineFeed";
import { loadXeroHealth } from "../xero/imports";
import { approvedBudgetFor, hoursVsBudgetFor } from "../dailyLog/store";
import { buildSignals, notChecked, type LabourVsBudgetInput, type TrackingRules } from "./signals";
import { tipMismatches } from "../receipts/tipStore";
import { addDays } from "../dates";
import { costAllocation } from "../costAllocation";
import { LABOUR_BACKFILL_CUTOFF } from "../trackingData";
import { LCI_RULES, isTestProject, rulesOff } from "./config";
import { groupUncosted, lciDateExceptions, restartAlerts, supervisorGapsLci, uncostedDayCounts, type UncostedInput, type UncostedLine } from "./lciRules";

export const TRACKING_RULES: TrackingRules = {
  watchAt: WATCH_AT, actAt: ACT_AT, recentDays: ATTENTION_RECENT_DAYS,
  noContractMinSpend: NO_CONTRACT_MIN_SPEND, hireUninvoicedDays: HIRE_UNINVOICED_DAYS,
};

export async function loadSignals() {
  const d = await gatherDirectorInputs();
  // Date exceptions as the Projects page works them out (not archived), then
  // LCI Stage 1's findings rules on top (lib/findings/lciRules.ts) - the
  // Projects page's own list is unchanged.
  const [projects, board] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true, status: true, archived: true, startDate: true, expectedCompletion: true, completionReviewBy: true },
    }),
    boardDatesByProject(d.today),
  ]);
  const dates = lciDateExceptions(projects.map((p) => ({
    projectId: p.id, projectName: p.name, startDate: p.startDate, firstJobDate: board.get(p.id)?.firstJobDate ?? null,
    exceptions: dateExceptionList(p, board.get(p.id), d.today),
  })), d.today);
  // Restarts on inactive projects, checked like starts; supervisor gaps per project-day.
  const restarts = await loadRestarts(d.today);
  const starts = [...d.starts, ...restarts];
  const supervisorGaps = supervisorGapsLci(d.upcoming, d.today, new Set(starts.map((s) => `${s.projectId}|${s.startDate}`)));
  const uncosted = await loadUncosted(d.today);
  // Won tenders from Estimating (G5); null when it didn't answer - then that check is skipped this run.
  // The current Xero invoice upload (G2) for the "not tied to a job" finding.
  const [won, xero, xeroConn] = await Promise.all([
    loadWonMatches(), loadXeroHealth(d.today),
    prisma.xeroConnection.findFirst({ orderBy: { updatedAt: "desc" }, select: { status: true, tenantName: true, lastError: true, lastSyncAt: true } }),
  ]);
  const wonTenders = won ? won.rows : null;
  const labourVsBudget = await loadLabourVsBudget();
  const tips = await tipMismatches(d.today); // Receipts R3

  // LCI_RULES_OFF=<codes>: those rules aren't run, and their findings are left as they are.
  const off = rulesOff();
  const all = buildSignals({
      today: d.today,
      rules: TRACKING_RULES,
      projects: d.projects,
      idleHire: d.tracking.idleHire.items,
      overdueHire: d.overdueHire,
      dates,
      starts,
      supervisorGaps,
      uncosted,
      crewShortDays: d.capacity.shortDays,
      crewAvailable: d.capacity.available,
      daysNotClosed: d.open,
      plant: { ...d.plant, machines: d.plant.items.length },
      wonTenders,
      xeroUnmatched: xero.invoices,
      xeroConnection: xeroConn ? { ...xeroConn, lastSyncAt: xeroConn.lastSyncAt?.toISOString() ?? null } : null,
      labourVsBudget,
      tipMismatches: tips,
  });
  return {
    today: d.today,
    asAt: d.now.toISOString(),
    notChecked: [...notChecked({ wonTenders, labourVsBudget }), ...off],
    signals: all.filter((s) => !off.has(s.kind)),
  };
}

// Inactive projects with a booked day in the restart window, plus the gap before it (lib/findings/lciRules.ts).
async function loadRestarts(today: string) {
  const from = new Date(addDays(today, -LCI_RULES.restartGapDays) + "T00:00:00.000Z");
  const to = new Date(addDays(today, LCI_RULES.restartWindowDays + 1) + "T00:00:00.000Z");
  const rows = await prisma.project.findMany({
    where: { archived: false, status: "INACTIVE", jobs: { some: { cancelledAt: null, notRunning: false, date: { gte: new Date(today + "T00:00:00.000Z"), lt: to } } } },
    select: {
      id: true, name: true, jobNo: true, status: true,
      jobs: {
        where: { cancelledAt: null, date: { gte: from, lt: to } },
        select: { date: true, shift: true, notRunning: true, assignments: { select: { role: true, resource: { select: { type: true, category: true } } } } },
      },
    },
  });
  return restartAlerts(rows.map((p) => ({ ...p, jobs: p.jobs.map((j) => ({ ...j, iso: j.date.toISOString().slice(0, 10) })) })), today);
}

// Allocations that can't be costed, by cause: the same costing as Tracking (lib/costAllocation.ts, the frozen
// ledger's status on a closed day), counted only after the history cut-off and from the last 30 days or on a day
// not yet closed. Registered hire is costed by its hire period - its missing rate comes from the hire register.
async function loadUncosted(today: string): Promise<UncostedInput> {
  const closedRows = await prisma.dayClose.findMany({ where: { status: "CLOSED" }, select: { date: true } });
  const closed = new Set(closedRows.map((r) => r.date));
  const jobs = await prisma.job.findMany({
    where: { notRunning: false, cancelledAt: null, projectId: { not: null }, project: { archived: false }, date: { gt: new Date(LABOUR_BACKFILL_CUTOFF + "T00:00:00.000Z"), lte: new Date(today + "T00:00:00.000Z") } },
    select: {
      id: true, date: true, shift: true, startTime: true, endTime: true,
      project: { select: { id: true, name: true, unpaidBreakMinutes: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: {
        select: {
          id: true,
          resource: {
            select: {
              id: true, type: true, category: true, name: true, dailyRateExGst: true, hireProjectId: true,
              payRateBasis: true, ordinaryRate: true, nightRate: true, saturdayRate: true, sundayRate: true, payRateConfirmed: true, hireRate: true, hireRateUnit: true,
            },
          },
        },
      },
    },
  });
  const counted = jobs.filter((j) => uncostedDayCounts(j.date.toISOString().slice(0, 10), today, closed.has(j.date.toISOString().slice(0, 10)), LABOUR_BACKFILL_CUTOFF));
  const closedDays = [...new Set(counted.map((j) => j.date.toISOString().slice(0, 10)).filter((x) => closed.has(x)))];
  const frozen = closedDays.length
    ? await prisma.allocationCost.findMany({ where: { date: { in: closedDays }, supersededAt: null }, select: { assignmentId: true, status: true } })
    : [];
  const frozenStatus = new Map(frozen.map((f) => [f.assignmentId, f.status]));
  const lines: UncostedLine[] = [];
  for (const j of counted) {
    const date = j.date.toISOString().slice(0, 10);
    for (const a of j.assignments) {
      const r = a.resource;
      if (r.type === "HIRE" && r.category !== "LABOUR" && r.hireProjectId) continue; // registered hire: costed by hire period
      if (isTestProject(j.project!.name)) continue; // an internal test project is never a cost gap
      const status = closed.has(date) && frozenStatus.has(a.id)
        ? frozenStatus.get(a.id)
        : costAllocation(date, j.shift as "DAY" | "NIGHT", j.startTime, j.endTime, j.project!, r).status;
      if (status !== "RATE_MISSING" && status !== "HOURS_UNKNOWN") continue;
      lines.push({ resourceId: r.id, resourceName: r.name, resourceType: r.type, projectId: j.project!.id, projectName: j.project!.name, date, status });
    }
  }
  // Registered hire with days on hire and no rate (Tracking's hire estimate can't be worked out).
  const hire = await prisma.resource.findMany({
    where: { type: "HIRE", NOT: { category: "LABOUR" }, hireProjectId: { not: null }, hireRate: null, dailyRateExGst: null, active: true, offHiredOn: null, OR: [{ hireStatus: null }, { hireStatus: { not: "RETURNED" } }] },
    select: { id: true, name: true, type: true, onHireDate: true, hireProject: { select: { id: true, name: true, archived: true } } },
  });
  for (const h of hire) {
    if (!h.hireProject || h.hireProject.archived || isTestProject(h.hireProject.name) || !h.onHireDate || h.onHireDate > today) continue;
    lines.push({ resourceId: h.id, resourceName: h.name, resourceType: h.type, projectId: h.hireProject.id, projectName: h.hireProject.name, date: today, status: "RATE_MISSING" });
  }
  return groupUncosted(lines);
}

// Task K: labour hours vs the approved budget, for the projects that have
// daily logs (none -> nothing to check, and Estimating isn't asked). Null when
// Estimating didn't answer for one of them - that check is skipped this run.
async function loadLabourVsBudget(): Promise<LabourVsBudgetInput[] | null> {
  const logged = await prisma.dailyLog.findMany({ where: { projectId: { not: null } }, distinct: ["projectId"], select: { projectId: true } });
  if (!logged.length) return [];
  const projects = await prisma.project.findMany({ where: { id: { in: logged.map((l) => l.projectId!) }, archived: false }, select: { id: true, name: true, jobNo: true, quoteNo: true } });
  const out: LabourVsBudgetInput[] = [];
  for (const p of projects) {
    const budget = await approvedBudgetFor(p);
    if (budget.state === "DOWN") return null;
    if (budget.state === "NONE") continue;
    const t = await hoursVsBudgetFor(p, null, budget);
    if (t.state === "OK") out.push({ projectId: p.id, projectName: p.name, budgetRef: t.budgetRef, rows: t.rows });
  }
  return out;
}
