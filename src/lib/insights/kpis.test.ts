// Director Insights KPI tests (24 Oct 2026) - hand-worked examples for each
// calculation in kpis.ts. Run with `npm test` (tsx --test, no extra packages).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DayCostDTO, ProjectCostDTO, StartAlertDTO } from "../types";
import {
  costConfidence, costPosition, crewDemand, daysNotClosed, daysNotClosedAlert, hiredPlantOut, hoursByWeek, labourHireShare,
  plantUse, requestAlerts, requestSummary, snapshotRows, SNAPSHOT_KPIS, sortAlerts, startAlerts, supervisorAlerts, supervisorGaps,
  trackingAlerts, trendVs, workingDays, workload, type ProjectMeta, type UpcomingJob,
} from "./kpis";
import { weeklyByCategory } from "../trackingView";
import type { DirectorOverviewDTO } from "./load";

const day = (date: string, locked: number, estimated = 0, invoiced = 0, cat: DayCostDTO["cat"] = {}): DayCostDTO =>
  ({ date, locked, estimated, invoiced, cat });
const project = (p: Partial<ProjectCostDTO>): ProjectCostDTO => ({
  id: "p", name: "Job", status: "ACTIVE", health: "ON_TRACK", stillToCome: 0, uncostedCount: 0, unconfirmedCount: 0,
  daily: [], hireItems: [], hireToCome: 0, ...p,
} as ProjectCostDTO);

// ---------- cost ----------

test("month so far vs the same days last month", () => {
  // Today 24 Oct: this month = 1-24 Oct; last month = 1-24 Sep (25 Sep is out).
  const p = project({ daily: [day("2026-10-01", 100), day("2026-10-24", 0, 50), day("2026-09-24", 70), day("2026-09-25", 999), day("2026-10-25", 999)] });
  const c = costPosition([p], "2026-10-24");
  assert.equal(c.monthSoFar.total, 150);
  assert.equal(c.monthSoFar.firm, 100);
  assert.equal(c.monthSoFar.estimated, 50);
  assert.equal(c.lastMonthSameDays, 70);
});

test("labour hire share is for the last full month (agencies invoice late)", () => {
  const p = project({ daily: [
    day("2026-09-10", 300, 0, 0, { ownCrew: 300 }), day("2026-09-30", 0, 0, 100, { labourHire: 100 }),
    day("2026-10-05", 500, 0, 0, { ownCrew: 500 }), // October: no agency invoice yet
  ] });
  const c = costPosition([p], "2026-10-24");
  assert.equal(c.labourHireShare, 0.25);
  assert.equal(c.labourHireMonth, "2026-09-01");
});

test("same days last month stops at a shorter month's end", () => {
  // 31 Mar -> February has 28 days in 2026, so compare 1-28 Feb.
  const p = project({ daily: [day("2026-02-28", 10), day("2026-03-01", 5)] });
  assert.equal(costPosition([p], "2026-03-31").lastMonthSameDays, 10);
});

test("health counts only active jobs; still to come only active", () => {
  const ps = [
    project({ id: "a", health: "ACT", stillToCome: 10 }),
    project({ id: "b", health: "WATCH", stillToCome: 5 }),
    project({ id: "c", health: "CANT_ASSESS" }),
    project({ id: "d", status: "COMPLETED", health: "ACT", stillToCome: 99 }),
  ];
  const c = costPosition(ps, "2026-10-24");
  assert.deepEqual(c.health, { act: 1, watch: 1, onTrack: 0, cantAssess: 1 });
  assert.equal(c.stillToCome, 15);
});

test("labour hire share, including no labour at all", () => {
  assert.equal(labourHireShare({ ownCrew: 300, labourHire: 100 }), 0.25);
  assert.equal(labourHireShare({}), null);
  assert.equal(labourHireShare({ labourHire: 50 }), 1);
});

test("cost confidence", () => {
  assert.equal(costConfidence({ monthSoFar: { total: 100, firm: 95, estimated: 5 }, uncosted: 0, unconfirmed: 0 }), "HIGH");
  assert.equal(costConfidence({ monthSoFar: { total: 100, firm: 95, estimated: 5 }, uncosted: 1, unconfirmed: 0 }), "LOW");
  assert.equal(costConfidence({ monthSoFar: { total: 100, firm: 40, estimated: 60 }, uncosted: 0, unconfirmed: 0 }), "LOW");
  assert.equal(costConfidence({ monthSoFar: { total: 100, firm: 70, estimated: 30 }, uncosted: 0, unconfirmed: 0 }), "MEDIUM");
  assert.equal(costConfidence({ monthSoFar: { total: 0, firm: 0, estimated: 0 }, uncosted: 0, unconfirmed: 0 }), "HIGH");
});

test("hired plant still out leaves returned items' estimate out", () => {
  const p = project({
    hireToCome: 400,
    hireItems: [
      { status: "ON_HIRE", costToDate: 100 }, { status: "RETURNED", costToDate: 900 }, { status: null, costToDate: null },
    ] as ProjectCostDTO["hireItems"],
  });
  assert.deepEqual(hiredPlantOut([p]), { items: 2, toDate: 100, toCome: 400, total: 500 });
});

test("weekly by category: Monday weeks, current week partial", () => {
  const days = [day("2026-10-19", 10, 0, 0, { ownCrew: 10 }), day("2026-10-25", 5, 0, 0, { hire: 5 }), day("2026-10-18", 7, 0, 0, { trucks: 7 })];
  const w = weeklyByCategory(days, "2026-10-24", 2);
  assert.deepEqual(w.map((x) => x.week), ["2026-10-12", "2026-10-19"]);
  assert.equal(w[0].total, 7); // Sun 18 Oct belongs to the week of Mon 12 Oct
  assert.equal(w[1].total, 15); // Mon 19 to Sun 25
  assert.deepEqual(w[1].cat, { ownCrew: 10, hire: 5 });
  assert.equal(w[1].partial, true);
  assert.equal(w[0].partial, false);
});

test("tracking attention maps to director priorities and links", () => {
  const a = trackingAlerts([
    { projectId: "x", projectName: "Smith St", level: "act", text: "Forecast is 104%", hint: "h" },
    { projectId: null, projectName: "2 active jobs have no contract value", level: "data", text: "2 active jobs have no contract value", hint: "h", jobs: [{ id: "j", name: "J", detail: "$3k spent", weight: 1 }] },
  ] as Parameters<typeof trackingAlerts>[0]);
  assert.equal(a[0].priority, "CRITICAL");
  assert.equal(a[0].href, "/tracking/x");
  assert.equal(a[1].priority, "INFO");
  assert.equal(a[1].links?.[0].href, "/tracking/j");
});

// ---------- workload ----------

test("workload: active needs a recent or future job; starts split by confidence", () => {
  const base: ProjectMeta = { id: "", name: "", status: "ACTIVE", archived: false, startDate: null, startDateConfidence: null, expectedCompletion: null, completionConfidence: null, completionReviewBy: null, recentOrFutureJob: true };
  const w = workload([
    { ...base, id: "a", name: "A", startDate: "2026-10-30", startDateConfidence: "CONFIRMED", expectedCompletion: "2026-11-10" },
    { ...base, id: "b", name: "B", startDate: "2026-11-23", startDateConfidence: "TENTATIVE", recentOrFutureJob: false },
    { ...base, id: "c", name: "C", startDate: "2026-11-24" }, // 31 days away - outside the window
    { ...base, id: "d", name: "D", archived: true, startDate: "2026-10-25" },
    { ...base, id: "e", name: "E", status: "ON_HOLD" },
    { ...base, id: "f", name: "F", startDate: "2026-09-01", expectedCompletion: "2026-11-01", completionReviewBy: "2026-10-20" },
  ], "2026-10-24");
  assert.equal(w.active, 3); // a, c, f (b has no recent/future job)
  assert.deepEqual(w.starting.map((s) => s.id), ["a", "b"]);
  assert.equal(w.startingConfirmed, 1);
  assert.equal(w.startingTentative, 1);
  assert.deepEqual(w.completing.map((s) => s.id), ["f", "a"]); // soonest first: 1 Nov, 10 Nov
  assert.deepEqual(w.missingDates.map((s) => s.id), ["c"]);
  assert.deepEqual(w.reviewOverdue.map((s) => s.id), ["f"]);
});

test("start alerts: within 2 days critical, else high", () => {
  const s = (daysAway: number, level: "critical" | "warn") => ({ projectId: "p", name: "P", jobNo: null, startDate: "x", daysAway, shifts: [], crew: 0, plant: 0, hasSupervisor: false, issues: ["No supervisor"], level, noJobYet: false }) as StartAlertDTO;
  const a = startAlerts([s(1, "critical"), s(5, "warn")]);
  assert.equal(a[0].priority, "CRITICAL");
  assert.match(a[0].title, /tomorrow/);
  assert.equal(a[1].priority, "HIGH");
});

// ---------- people ----------

const job = (j: Partial<UpcomingJob>): UpcomingJob => ({ projectId: "p", projectName: "P", date: "2026-10-26", ownCrewIds: [], labourHire: 0, hasLead: false, ...j });

test("crew demand: one person on two shifts counts once; weekends only when booked", () => {
  const d = crewDemand([
    job({ date: "2026-10-26", ownCrewIds: ["a", "b"] }),
    job({ date: "2026-10-26", ownCrewIds: ["b", "c"], labourHire: 2 }), // night shift, b again
    job({ date: "2026-10-31", ownCrewIds: ["a"] }), // Saturday, booked
    job({ date: "2026-11-20", ownCrewIds: ["a"] }), // outside 14 days
  ], 2, "2026-10-26");
  const mon = d.days.find((x) => x.date === "2026-10-26")!;
  assert.equal(mon.own, 3);
  assert.equal(mon.hire, 2);
  assert.equal(mon.short, 1);
  assert.ok(d.days.some((x) => x.date === "2026-10-31"));
  assert.ok(!d.days.some((x) => x.date === "2026-11-01")); // Sunday, nothing booked
  assert.equal(d.days.length, 11); // 10 weekdays + the booked Saturday
  assert.equal(d.shortDays.length, 1);
});

test("supervisor gaps skip start days, jobs with no crew and jobs with a lead", () => {
  const g = supervisorGaps([
    job({ projectId: "a", projectName: "A", date: "2026-10-26", ownCrewIds: ["x"] }), // start day of A - left to starts
    job({ projectId: "b", projectName: "B", date: "2026-10-26", ownCrewIds: ["x"], hasLead: true }),
    job({ projectId: "c", projectName: "C", date: "2026-10-26" }), // nobody booked yet
    job({ projectId: "d", projectName: "D", date: "2026-10-27", labourHire: 1 }),
    job({ projectId: "e", projectName: "E", date: "2026-11-05", ownCrewIds: ["y"] }),
  ], "2026-10-26", new Set(["a|2026-10-26"]));
  assert.deepEqual(g.map((x) => x.name), ["D", "E"]);
  const a = supervisorAlerts(g);
  assert.equal(a[0].priority, "CRITICAL"); // D tomorrow
  assert.equal(a[1].priority, "MEDIUM"); // E grouped
  assert.equal(a[1].links?.length, 1);
});

test("hours by week: staff vs hire, missing sign-out ignored, trial weeks incomplete", () => {
  const w = hoursByWeek([
    { date: "2026-10-20", hours: 8, isHire: false },
    { date: "2026-10-21", hours: 7.5, isHire: true },
    { date: "2026-10-22", hours: null, isHire: false },
    { date: "2026-10-27", hours: 9, isHire: false },
  ], "2026-10-28", 2);
  assert.deepEqual(w[0], { week: "2026-10-19", staff: 8, hire: 7.5, partial: false, incomplete: true });
  assert.deepEqual(w[1], { week: "2026-10-26", staff: 9, hire: 0, partial: true, incomplete: false });
});

// ---------- plant ----------

test("working days: Mon-Fri plus Saturdays worked, never Sundays", () => {
  const wd = workingDays("2026-10-19", "2026-10-25", new Set(["2026-10-24", "2026-10-25"]));
  assert.deepEqual(wd, ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
});

test("plant use: idle below 30%, Sunday allocations don't count, fleet figure", () => {
  // Window for today 2026-10-26 is 28 Sep - 25 Oct: 20 weekdays, no Saturdays worked.
  const alloc = (id: string, dates: string[]) => dates.map((date) => ({ resourceId: id, date }));
  const u = plantUse(
    [{ id: "x", name: "Excavator", status: "AVAILABLE" }, { id: "y", name: "Loader", status: "DOWN" }],
    [...alloc("x", ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"]), ...alloc("y", ["2026-10-05", "2026-10-25"])],
    new Set<string>(),
    "2026-10-26",
  );
  assert.equal(u.workingDays, 20);
  const x = u.items.find((i) => i.id === "x")!;
  const y = u.items.find((i) => i.id === "y")!;
  assert.equal(x.pct, 6 / 20); // 30% - not idle (idle is below 30%)
  assert.equal(x.idle, false);
  assert.equal(y.days, 1); // the Sunday 25 Oct allocation doesn't count
  assert.equal(y.idle, true);
  assert.equal(y.down, true);
  assert.equal(u.fleetPct, 7 / 40);
  assert.equal(u.allocatedDays, 7);
  assert.equal(u.confidence, "MEDIUM");
  assert.equal(u.idle, 1);
  assert.equal(u.down, 1);
});

test("plant use under 10% across the fleet is low confidence (plant not booked on the board)", () => {
  const u = plantUse([{ id: "x", name: "Excavator", status: "AVAILABLE" }], [{ resourceId: "x", date: "2026-10-05" }], new Set<string>(), "2026-10-26");
  assert.equal(u.fleetPct, 1 / 20);
  assert.equal(u.confidence, "LOW");
});

// ---------- requests ----------

test("requests: open, overdue at the needed-by boundary, urgent overdue critical", () => {
  const now = new Date("2026-10-24T10:00:00Z");
  const r = (id: string, priority: string, status: string, neededBy: string) => ({ id, number: Number(id), priority, status, neededBy: new Date(neededBy), summary: "s", siteLabel: "Site" });
  const rows = [
    r("1", "URGENT", "SENT", "2026-10-24T09:00:00Z"), // overdue
    r("2", "HIGH", "TODO", "2026-10-24T10:00:00Z"), // exactly at needed-by - not overdue yet
    r("3", "LOW", "DONE", "2026-10-01T00:00:00Z"), // closed
    r("4", "LOW", "SEEN", "2026-10-22T10:00:00Z"), // overdue
  ];
  const s = requestSummary(rows, now);
  assert.equal(s.open, 3);
  assert.deepEqual(s.overdue.map((x) => x.id), ["1", "4"]);
  const a = requestAlerts(s.overdue, now);
  assert.equal(a[0].priority, "CRITICAL");
  assert.match(a[0].title, /R-0001/);
  assert.equal(a[1].priority, "MEDIUM"); // only a LOW one left
});

// ---------- days not closed ----------

test("days not closed: after the cut-off, before today, not closed, no repeats", () => {
  const d = daysNotClosed(["2026-09-26", "2026-09-27", "2026-09-27", "2026-10-01", "2026-10-24"], new Set(["2026-10-01"]), "2026-10-24", "2026-09-26");
  assert.deepEqual(d, ["2026-09-27"]);
  assert.deepEqual(daysNotClosedAlert(["a", "b", "c"]), []); // 3 is not above the warning
  assert.equal(daysNotClosedAlert(["a", "b", "c", "d"])[0].priority, "MEDIUM");
  assert.equal(daysNotClosedAlert(Array.from({ length: 11 }, (_, i) => String(i)))[0].priority, "HIGH");
});

test("alerts sort critical first", () => {
  const s = sortAlerts([{ priority: "INFO" }, { priority: "CRITICAL" }, { priority: "MEDIUM" }, { priority: "HIGH" }] as Parameters<typeof sortAlerts>[0]);
  assert.deepEqual(s.map((a) => a.priority), ["CRITICAL", "HIGH", "MEDIUM", "INFO"]);
});

// ---------- snapshots and trends ----------

test("trend never compares against a partial week", () => {
  assert.deepEqual(trendVs(14, { value: 12, partial: false }), { before: 12, diff: 2 });
  assert.equal(trendVs(14, { value: 12, partial: true }), null);
  assert.equal(trendVs(14, null), null);
});

test("snapshot rows: partial unless taken on the Monday", () => {
  const o = {
    workload: { active: 5, starting: [], startingConfirmed: 0, startingTentative: 0, completing: [], notReady: 1 },
    dataQuality: [{ id: "notClosed", count: 4 }],
    requests: { open: 2, urgent: 1, overdue: 0 },
    cost: { health: { act: 1, watch: 2, onTrack: 3, cantAssess: 1 }, confidence: "MEDIUM", stillToCome: 10, trend: [{ week: "2026-10-12", total: 100 }, { week: "2026-10-19", total: 50 }], hiredPlant: { total: 9, items: 1 }, uncosted: 0, unconfirmed: 2 },
    people: { labourHireShare: 0.25, hours: [{ week: "2026-10-12", staff: 1, hire: 2, incomplete: true }, { week: "2026-10-19", staff: 0, hire: 0, incomplete: true }], activeCrew: 12 },
    plant: { fleetPct: 0.5, machines: 4, idle: 1, down: 0, overdueOffHire: 0 },
  } as unknown as DirectorOverviewDTO;
  const sat = snapshotRows(o, "2026-10-24");
  assert.equal(sat.weekStart, "2026-10-19");
  assert.ok(sat.rows.every((r) => JSON.parse(r.detail).partial === true));
  const mon = snapshotRows(o, "2026-10-26");
  assert.equal(mon.weekStart, "2026-10-26");
  assert.ok(mon.rows.every((r) => JSON.parse(r.detail).partial === false));
  assert.deepEqual(mon.rows.map((r) => r.kpi).sort(), [...SNAPSHOT_KPIS].sort()); // exactly the listed KPIs, once each
  assert.equal(mon.rows.find((r) => r.kpi === "F1_LAST_WEEK")?.value, 100); // the last full week, not this one
  assert.equal(mon.rows.find((r) => r.kpi === "P1_LAST_WEEK")?.confidence, "LOW"); // trial week
});
