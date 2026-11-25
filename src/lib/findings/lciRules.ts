// LCI Stage 1 rule fixes (Ilies, 25 Nov 2026: "approve all defaults"; plan
// operations-agent-log/reports/LCI full coverage plan (25 Nov 2026).md §1).
// Plain functions over data the findings loader already fetched - no
// database, no server imports. They feed lib/findings/signals.ts only: the
// Directors overview and the Projects page keep their own lists unchanged.
//   - NO_SUPERVISOR looks at the whole project-day (a day/night split with the
//     supervisor on the other shift is covered), never counts the Yard or a
//     test project or a one-off job with no project, and a single worker alone
//     is information ("solo on site"), not a gap (Decision 1).
//   - Restarts: the first booked day after a gap on an inactive project is
//     checked like a start (Decision 3 - DATE_INACTIVE_HAS_JOBS is retired).
//   - Date exceptions: the retired rule is dropped, DATE_START_MISMATCH only
//     past 7 days on a recent project, DATE_NO_START not for the Yard / TEST.
//   - DATA_UNCOSTED grouped by cause: one per resource with no rate, plus one
//     per project for allocations with no hours.
import type { StartAlertDTO, ShiftType } from "../types";
import type { DateException } from "../dateExceptions";
import type { UpcomingJob } from "../insights/kpis";
import { THRESHOLDS } from "../insights/dictionary";
import { addDays, daysBetween } from "../dates";
import { LCI_RULES, RETIRED_RULES, isNotASite } from "./config";

// ---------- NO_SUPERVISOR ----------

export type SupervisorGapLci = { jobId: string | null; projectId: string; name: string; date: string; daysAway: number; crew: number; solo: boolean };

const isLead = (role: string | null | undefined) => role === "Supervisor" || role === "Lead";

export function supervisorGapsLci(jobs: UpcomingJob[], today: string, startKeys: Set<string>): SupervisorGapLci[] {
  const end = addDays(today, THRESHOLDS.lookaheadDays - 1);
  const days = new Map<string, { jobId: string | null; projectId: string; name: string; date: string; crew: Set<string>; hire: number; lead: boolean }>();
  for (const j of jobs) {
    if (!j.projectId) continue; // a one-off job with no project
    if (j.date < today || j.date > end) continue;
    if (isNotASite(j.projectName)) continue; // the Yard, a test project
    const k = `${j.projectId}|${j.date}`;
    const d = days.get(k) ?? { jobId: j.jobId ?? null, projectId: j.projectId, name: j.projectName, date: j.date, crew: new Set<string>(), hire: 0, lead: false };
    for (const id of j.ownCrewIds) d.crew.add(id);
    d.hire += j.labourHire;
    d.lead ||= j.hasLead; // any running job that day with a Supervisor or Lead covers the project-day
    days.set(k, d);
  }
  return [...days.entries()]
    .filter(([k, d]) => !startKeys.has(k) && !d.lead && d.crew.size + d.hire > 0)
    .map(([, d]) => {
      const crew = d.crew.size + d.hire;
      return { jobId: d.jobId, projectId: d.projectId, name: d.name, date: d.date, daysAway: daysBetween(today, d.date), crew, solo: crew === 1 };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// ---------- restarts ----------

export type RestartProject = {
  id: string; name: string; jobNo: string | null; status: string;
  jobs: { iso: string; shift: string; notRunning: boolean; assignments: { role: string | null; resource: { type: string; category: string | null } }[] }[];
};
export type RestartAlert = StartAlertDTO & { restart: true };

export function restartAlerts(projects: RestartProject[], today: string): RestartAlert[] {
  const limit = addDays(today, LCI_RULES.restartWindowDays);
  const out: RestartAlert[] = [];
  for (const p of projects) {
    if (p.status !== "INACTIVE" || isNotASite(p.name)) continue;
    const running = p.jobs.filter((j) => !j.notRunning);
    const days = [...new Set(running.map((j) => j.iso))].sort();
    const restart = days.find((d) => d >= today && d <= limit && !days.some((x) => x < d && x >= addDays(d, -LCI_RULES.restartGapDays)));
    if (!restart) continue;
    const onDay = running.filter((j) => j.iso === restart);
    let crew = 0, plant = 0, hasSupervisor = false;
    for (const j of onDay) for (const a of j.assignments) {
      const t = a.resource.type;
      if (t === "PERSONNEL" || (t === "HIRE" && a.resource.category === "LABOUR")) { crew++; if (isLead(a.role)) hasSupervisor = true; }
      else if (t === "EQUIPMENT" || t === "ATTACHMENT" || t === "VEHICLE") plant++;
    }
    if (hasSupervisor) continue; // someone is in charge on the restart day - nothing to flag (as for a start)
    const issues = [crew === 0 ? "No crew assigned" : "No supervisor", ...(plant === 0 ? ["No plant or vehicles assigned"] : [])];
    const daysAway = daysBetween(today, restart);
    out.push({
      projectId: p.id, name: p.name, jobNo: p.jobNo, startDate: restart, daysAway, shifts: [...new Set(onDay.map((j) => j.shift as ShiftType))],
      crew, plant, hasSupervisor, issues, level: daysAway <= 2 ? "critical" : "warn", noJobYet: false, restart: true,
    });
  }
  return out;
}

// ---------- date exceptions ----------

export type DateRow = { projectId: string; projectName: string; startDate: string | null; firstJobDate: string | null; exceptions: DateException[] };

export function lciDateExceptions(rows: DateRow[], today: string): { projectId: string; projectName: string; exceptions: DateException[] }[] {
  return rows
    .map((r) => ({
      projectId: r.projectId, projectName: r.projectName,
      exceptions: r.exceptions.filter((e) => {
        if (RETIRED_RULES.has(e.code)) return false;
        if (e.code === "DATE_NO_START") return !isNotASite(r.projectName);
        if (e.code === "DATE_START_MISMATCH") {
          if (!r.startDate || !r.firstJobDate) return false;
          return Math.abs(daysBetween(r.startDate, r.firstJobDate)) > LCI_RULES.startMismatchOverDays
            && r.firstJobDate >= addDays(today, -LCI_RULES.startMismatchRecentBoardDays);
        }
        return true;
      }),
    }))
    .filter((r) => r.exceptions.length > 0);
}

// ---------- DATA_UNCOSTED, grouped by cause ----------

export type UncostedLine = {
  resourceId: string; resourceName: string; resourceType: string;
  projectId: string; projectName: string; date: string; status: "RATE_MISSING" | "HOURS_UNKNOWN";
};
export type UncostedRate = { resourceId: string; resourceName: string; resourceType: string; count: number; projects: string[]; lastDate: string };
export type UncostedHours = { projectId: string; projectName: string; count: number; lastDate: string };
export type UncostedInput = { rates: UncostedRate[]; hours: UncostedHours[] };

export function groupUncosted(lines: UncostedLine[]): UncostedInput {
  const rates = new Map<string, UncostedRate & { p: Set<string> }>();
  const hours = new Map<string, UncostedHours>();
  for (const l of lines) {
    if (l.status === "RATE_MISSING") {
      const r = rates.get(l.resourceId) ?? { resourceId: l.resourceId, resourceName: l.resourceName, resourceType: l.resourceType, count: 0, projects: [], lastDate: l.date, p: new Set<string>() };
      r.count++; r.p.add(l.projectName); if (l.date > r.lastDate) r.lastDate = l.date;
      rates.set(l.resourceId, r);
    } else {
      const h = hours.get(l.projectId) ?? { projectId: l.projectId, projectName: l.projectName, count: 0, lastDate: l.date };
      h.count++; if (l.date > h.lastDate) h.lastDate = l.date;
      hours.set(l.projectId, h);
    }
  }
  return {
    rates: [...rates.values()].map(({ p, ...r }) => ({ ...r, projects: [...p].sort() })).sort((a, b) => b.count - a.count || a.resourceName.localeCompare(b.resourceName)),
    hours: [...hours.values()].sort((a, b) => b.count - a.count || a.projectName.localeCompare(b.projectName)),
  };
}

// Which allocations count: after the history cut-off, and from the last 30 days or on a day not yet closed.
export const uncostedDayCounts = (date: string, today: string, closed: boolean, cutoff: string) =>
  date > cutoff && date <= today && (!closed || date >= addDays(today, -LCI_RULES.uncostedRecentDays));
