// Findings signals loader (24 Oct 2026): fetches what lib/findings/signals.ts
// needs - through the Directors loader (so a signal and the Directors page
// read the same figures) plus the Projects page's date exceptions - and
// builds the list. Read-only; nothing is stored yet (that's step 2).
import { prisma } from "../prisma";
import { boardDatesByProject, dateExceptionList } from "../dateExceptions";
import { ACT_AT, ATTENTION_RECENT_DAYS, HIRE_UNINVOICED_DAYS, NO_CONTRACT_MIN_SPEND, WATCH_AT } from "../trackingData";
import { gatherDirectorInputs } from "../insights/load";
import { buildSignals, type TrackingRules } from "./signals";

export const TRACKING_RULES: TrackingRules = {
  watchAt: WATCH_AT, actAt: ACT_AT, recentDays: ATTENTION_RECENT_DAYS,
  noContractMinSpend: NO_CONTRACT_MIN_SPEND, hireUninvoicedDays: HIRE_UNINVOICED_DAYS,
};

export async function loadSignals() {
  const d = await gatherDirectorInputs();
  // Date exceptions exactly as the Projects page works them out (not archived).
  const [projects, board] = await Promise.all([
    prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true, status: true, archived: true, startDate: true, expectedCompletion: true, completionReviewBy: true },
    }),
    boardDatesByProject(d.today),
  ]);
  const dates = projects
    .map((p) => ({ projectId: p.id, projectName: p.name, exceptions: dateExceptionList(p, board.get(p.id), d.today) }))
    .filter((r) => r.exceptions.length > 0);

  return {
    today: d.today,
    asAt: d.now.toISOString(),
    signals: buildSignals({
      today: d.today,
      rules: TRACKING_RULES,
      projects: d.projects,
      idleHire: d.tracking.idleHire.items,
      overdueHire: d.overdueHire,
      dates,
      starts: d.starts,
      supervisorGaps: d.gaps,
      crewShortDays: d.capacity.shortDays,
      crewAvailable: d.capacity.available,
      daysNotClosed: d.open,
      plant: { ...d.plant, machines: d.plant.items.length },
    }),
  };
}
