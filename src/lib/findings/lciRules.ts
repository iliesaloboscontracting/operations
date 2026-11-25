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

// LS-005 (Ilies, 25 Nov 2026: "Show both on the card") and LS-009 (approved 25 Nov 2026) - each its own rule code so
// the card groups them apart and the dated "lapsed" close works (key KIND:PROJECT:<id>:<date>):
//   NO_SUPERVISOR  a crew of 2+ with nobody marked Supervisor or Lead anywhere on the project-day (as before)
//   LONE_WORKER    one person alone on site, counted by crew size only - a Supervisor or Lead on their own counts too
//                  (LS-009 b): the whole project-day is one person, or, when the day and night shifts split, one
//                  person alone on a shift (MEDIUM)
//   DAY_NO_LEAD    a day-shift crew of 2+ with no Supervisor or Lead on the day shift, the only lead being on the
//                  night shift (LS-009 a, MEDIUM)
//   NIGHT_NO_LEAD  a night-shift crew of 2+ with no Supervisor or Lead on the night shift, the lead being on the day
//                  shift (MEDIUM)
// A job with no shift counts as day. The Yard, TEST projects and one-off jobs with no project never count; a start
// day is left to the start check.
export type GapKind = "NO_SUPERVISOR" | "LONE_WORKER" | "DAY_NO_LEAD" | "NIGHT_NO_LEAD";
export type GapShift = "DAY" | "NIGHT" | "BOTH";
export type SupervisorGapLci = { kind: GapKind; jobId: string | null; projectId: string; name: string; date: string; daysAway: number; crew: number; shift: GapShift | null; split: boolean };

const isLead = (role: string | null | undefined) => role === "Supervisor" || role === "Lead";
type Crew = { crew: Set<string>; hire: number; lead: boolean };
const emptyCrew = (): Crew => ({ crew: new Set<string>(), hire: 0, lead: false });
const addCrew = (c: Crew, j: UpcomingJob) => { for (const id of j.ownCrewIds) c.crew.add(id); c.hire += j.labourHire; c.lead ||= j.hasLead; };
const size = (c: Crew) => c.crew.size + c.hire;

export function supervisorGapsLci(jobs: UpcomingJob[], today: string, startKeys: Set<string>): SupervisorGapLci[] {
  const end = addDays(today, THRESHOLDS.lookaheadDays - 1);
  const days = new Map<string, { jobId: string | null; projectId: string; name: string; date: string; all: Crew; day: Crew; night: Crew }>();
  for (const j of jobs) {
    if (!j.projectId) continue; // a one-off job with no project
    if (j.date < today || j.date > end) continue;
    if (isNotASite(j.projectName)) continue; // the Yard, a test project
    const k = `${j.projectId}|${j.date}`;
    const d = days.get(k) ?? { jobId: j.jobId ?? null, projectId: j.projectId, name: j.projectName, date: j.date, all: emptyCrew(), day: emptyCrew(), night: emptyCrew() };
    addCrew(d.all, j); // any running job that day with a Supervisor or Lead covers the project-day
    addCrew(j.shift === "NIGHT" ? d.night : d.day, j);
    days.set(k, d);
  }
  const out: SupervisorGapLci[] = [];
  for (const [k, d] of days) {
    if (startKeys.has(k)) continue;
    const base = { jobId: d.jobId, projectId: d.projectId, name: d.name, date: d.date, daysAway: daysBetween(today, d.date) };
    const total = size(d.all);
    if (total === 0) continue;
    const split = size(d.day) > 0 && size(d.night) > 0;
    // One person on the whole project-day: alone on site, lead or not (LS-009 b).
    if (total === 1) { out.push({ ...base, kind: "LONE_WORKER", crew: 1, shift: size(d.night) ? "NIGHT" : "DAY", split: false }); continue; }
    // Nobody in charge all day: the existing gap.
    if (!d.all.lead) { out.push({ ...base, kind: "NO_SUPERVISOR", crew: total, shift: null, split }); continue; }
    if (!split) continue; // one shift with a lead on it - covered
    // The shifts split and the lead is on one of them: the other shift on its own.
    const alone: ("DAY" | "NIGHT")[] = [];
    for (const [shift, c] of [["DAY", d.day], ["NIGHT", d.night]] as const) {
      if (size(c) === 1) alone.push(shift); // one person alone on that shift, lead or not
      else if (!c.lead) out.push({ ...base, kind: shift === "DAY" ? "DAY_NO_LEAD" : "NIGHT_NO_LEAD", crew: size(c), shift, split: true });
    }
    if (alone.length) out.push({ ...base, kind: "LONE_WORKER", crew: alone.length, shift: alone.length === 2 ? "BOTH" : alone[0], split: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
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
