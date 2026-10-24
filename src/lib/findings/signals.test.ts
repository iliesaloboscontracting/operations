// Findings signals tests (24 Oct 2026): every signal kind, dedupeKey
// stability, and the money guard on OPERATIONAL signals. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { StartAlertDTO } from "../types";
import type { DateExceptionCode } from "../dateExceptions";
import {
  buildSignals, costSignals, countByKind, crewSignals, dateSignals, daysNotClosedSignal, dedupeKeyOf, hireSignals,
  operationalIsMoneyFree, plantSignal, startSignals, supervisorSignals,
  type Signal, type SignalInputs, type TrackingProject, type TrackingRules,
} from "./signals";

const RULES: TrackingRules = { watchAt: 0.8, actAt: 1.0, recentDays: 30, noContractMinSpend: 2000, hireUninvoicedDays: 15 };
const TODAY = "2026-10-26";
const proj = (p: Partial<TrackingProject>): TrackingProject => ({
  id: "p1", name: "Myers", status: "ACTIVE", health: "ON_TRACK", healthReason: "Forecast is 49% of the contract value",
  contractValue: 100000, totalCost: 50000, forecastCost: 50000, stillToCome: 0, lockedCost: 40000, estimatedTotal: 5000, invoicedTotal: 5000,
  uncostedCount: 0, lastDate: "2026-10-23", hireItems: [], ...p,
});
const hire = (h: Partial<TrackingProject["hireItems"][number]>): TrackingProject["hireItems"][number] => ({
  id: "h1", name: "2.5T Excavator", supplier: "Mega Hire", status: "ON_HIRE", offHireDate: "2026-11-30", dayRate: 360,
  daysToDate: 20, daysInvoiced: 0, costToDate: 7200, ...h,
});
const kinds = (s: Signal[]) => s.map((x) => x.kind);

// ---------- cost and data gaps ----------

test("COST_VS_CONTRACT: Act critical, Watch medium, on track nothing, keyed per project", () => {
  const s = costSignals([
    proj({ id: "a", health: "ACT", healthReason: "Forecast is 104% of the contract value", forecastCost: 104000 }),
    proj({ id: "b", health: "WATCH", healthReason: "Forecast is 85% of the contract value", forecastCost: 85000 }),
    proj({ id: "c" }),
  ], TODAY, RULES);
  assert.deepEqual(kinds(s), ["COST_VS_CONTRACT", "COST_VS_CONTRACT"]);
  assert.equal(s[0].severity, "CRITICAL");
  assert.equal(s[0].dedupeKey, "COST_VS_CONTRACT:PROJECT:a");
  assert.equal(s[0].values.pctOfContract, 1.04);
  assert.equal(s[0].audience, "COMMERCIAL");
  assert.equal(s[1].severity, "MEDIUM");
});

test("only live jobs: active, or costed in the last 30 days (Tracking's rule)", () => {
  const s = costSignals([
    proj({ id: "old", status: "COMPLETED", health: "ACT", lastDate: "2026-09-01" }),
    proj({ id: "recent", status: "COMPLETED", health: "ACT", lastDate: "2026-10-01" }),
  ], TODAY, RULES);
  assert.deepEqual(s.map((x) => x.subject.id), ["recent"]);
});

test("DATA_NO_CONTRACT_VALUE from $2k spent; DATA_UNCOSTED with the count", () => {
  const s = costSignals([
    proj({ id: "a", health: "CANT_ASSESS", contractValue: null, totalCost: 2000 }),
    proj({ id: "b", health: "CANT_ASSESS", contractValue: null, totalCost: 1999.99 }),
    proj({ id: "c", uncostedCount: 3 }),
  ], TODAY, RULES);
  assert.deepEqual(s.map((x) => `${x.kind}:${x.subject.id}`), ["DATA_NO_CONTRACT_VALUE:a", "DATA_UNCOSTED:c"]);
  assert.ok(s.every((x) => x.severity === "INFO" && x.provisional));
  assert.equal(s[1].values.uncosted, 3);
});

// ---------- hire ----------

test("HIRE_UNINVOICED from 15 working days without an invoice; not returned items, not without an estimate", () => {
  const s = hireSignals([proj({ hireItems: [
    hire({ id: "x", daysToDate: 36, daysInvoiced: 20, costToDate: 5760 }), // 16 open
    hire({ id: "y", daysToDate: 34, daysInvoiced: 20, costToDate: 5000 }), // 14 open - not yet
    hire({ id: "z", status: "RETURNED", daysToDate: 40 }),
    hire({ id: "w", daysToDate: 40, costToDate: null, dayRate: null }), // no rate - nothing to chase
  ] })], [], [], TODAY, RULES).filter((x) => x.kind === "HIRE_UNINVOICED");
  assert.deepEqual(s.map((x) => x.subject.id), ["x"]);
  assert.equal(s[0].values.workingDaysUninvoiced, 16);
  assert.equal(s[0].dedupeKey, "HIRE_UNINVOICED:RESOURCE:x");
});

test("HIRE_NO_FINISH per item, operational, flags a missing rate too", () => {
  const s = hireSignals([proj({ hireItems: [
    hire({ id: "a", offHireDate: null, daysToDate: 0, costToDate: null }),
    hire({ id: "b", offHireDate: "soon", dayRate: null, daysToDate: 0, costToDate: null }),
    hire({ id: "c", daysToDate: 0 }),
    hire({ id: "d", offHireDate: null, status: "RETURNED", daysToDate: 0 }),
  ] })], [], [], TODAY, RULES).filter((x) => x.kind === "HIRE_NO_FINISH");
  assert.deepEqual(s.map((x) => x.subject.id), ["a", "b"]);
  assert.equal(s[1].values.rateMissing, true);
  assert.ok(s.every((x) => x.audience === "OPERATIONAL" && x.severity === "INFO"));
});

test("HIRE_IDLE per item; provisional with no rate", () => {
  const s = hireSignals([], [
    { id: "i1", name: "Scissor lift", agency: "Kennards", overdue: false, idleDays: 6, idleCost: 900, onHireDays: 10, workedDays: 4 },
    { id: "i2", name: "Light tower", agency: null, overdue: true, idleDays: 3, idleCost: null, onHireDays: 3, workedDays: 0 },
  ], [], TODAY, RULES);
  assert.deepEqual(s.map((x) => x.dedupeKey), ["HIRE_IDLE:RESOURCE:i1", "HIRE_IDLE:RESOURCE:i2"]);
  assert.equal(s[1].provisional, true);
  assert.match(s[1].title, /past its finish date/);
});

test("HIRE_OVERDUE high, operational, linked to its project", () => {
  const s = hireSignals([], [], [{ id: "o1", name: "Hook truck", supplier: "Demo Dump", project: "Shellharbour WH1", projectId: "p9", offHireDate: "2026-10-20" }], TODAY, RULES);
  assert.equal(s[0].kind, "HIRE_OVERDUE");
  assert.equal(s[0].severity, "HIGH");
  assert.equal(s[0].projectId, "p9");
  assert.equal(s[0].dedupeKey, "HIRE_OVERDUE:RESOURCE:o1");
});

// ---------- dates ----------

test("every date exception code becomes a signal keyed by code + project", () => {
  const codes: DateExceptionCode[] = ["DATE_INACTIVE_HAS_JOBS", "DATE_COMPLETED_HAS_JOBS", "DATE_NO_START", "DATE_START_MISMATCH", "DATE_JOBS_AFTER_COMPLETION", "DATE_COMPLETION_PASSED", "DATE_TBC_REVIEW_DUE", "DATE_JOBS_NO_TIMES"];
  const s = dateSignals([{ projectId: "p1", projectName: "Myers", exceptions: codes.map((code) => ({ code, text: `text for ${code}` })) }]);
  assert.deepEqual(kinds(s), codes);
  assert.deepEqual(s.map((x) => x.dedupeKey), codes.map((c) => `${c}:PROJECT:p1`));
  assert.equal(s.find((x) => x.kind === "DATE_START_MISMATCH")?.severity, "MEDIUM");
  assert.equal(s.find((x) => x.kind === "DATE_NO_START")?.severity, "INFO");
  assert.ok(s.every((x) => x.audience === "OPERATIONAL"));
  assert.equal(s[0].title, "Myers: text for DATE_INACTIVE_HAS_JOBS");
});

// ---------- readiness and people ----------

const start = (daysAway: number, startDate: string, level: "critical" | "warn"): StartAlertDTO =>
  ({ projectId: "p1", name: "Jannali", jobNo: null, startDate, daysAway, shifts: [], crew: 3, plant: 0, hasSupervisor: false, issues: ["No supervisor"], level, noJobYet: false });

test("START_NOT_READY: the start date is in the key (a moved start is a new problem)", () => {
  const a = startSignals([start(1, "2026-10-27", "critical")]);
  const b = startSignals([start(5, "2026-10-31", "warn")]);
  assert.equal(a[0].severity, "CRITICAL");
  assert.equal(b[0].severity, "HIGH");
  assert.equal(a[0].dedupeKey, "START_NOT_READY:PROJECT:p1:2026-10-27");
  assert.notEqual(a[0].dedupeKey, b[0].dedupeKey);
});

test("NO_SUPERVISOR: project + date, or a one-off job by id; critical within 2 days", () => {
  const s = supervisorSignals([
    { jobId: "j1", projectId: "p1", name: "Myers", date: "2026-10-27", daysAway: 1 },
    { jobId: "j2", projectId: null, name: "One-off clean", date: "2026-11-03", daysAway: 8 },
  ]);
  assert.equal(s[0].dedupeKey, "NO_SUPERVISOR:PROJECT:p1:2026-10-27");
  assert.equal(s[0].severity, "CRITICAL");
  assert.equal(s[1].dedupeKey, "NO_SUPERVISOR:JOB:j2");
  assert.equal(s[1].severity, "MEDIUM");
});

test("CREW_SHORT one per short day", () => {
  const s = crewSignals([{ date: "2026-10-28", own: 45, hire: 2, short: 3 }], 42);
  assert.equal(s[0].dedupeKey, "CREW_SHORT:COMPANY:crew:2026-10-28");
  assert.equal(s[0].values.short, 3);
});

// ---------- company-wide ----------

test("DAYS_NOT_CLOSED above 3 medium, above 10 high (draft), none at 3", () => {
  assert.deepEqual(daysNotClosedSignal(["a", "b", "c"]), []);
  assert.equal(daysNotClosedSignal(["2026-10-01", "b", "c", "d"])[0].severity, "MEDIUM");
  const high = daysNotClosedSignal(Array.from({ length: 11 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`))[0];
  assert.equal(high.severity, "HIGH");
  assert.equal(high.values.oldest, "2026-10-01");
  assert.equal(high.dedupeKey, "DAYS_NOT_CLOSED:COMPANY:days");
});

test("DATA_PLANT_NOT_BOOKED only when plant use is low confidence", () => {
  const p = { fleetPct: 0.01, confidence: "LOW" as const, allocatedDays: 2, machines: 16, workingDays: 20, from: "2026-09-28", to: "2026-10-25" };
  assert.equal(plantSignal(p)[0].kind, "DATA_PLANT_NOT_BOOKED");
  assert.deepEqual(plantSignal({ ...p, confidence: "MEDIUM", fleetPct: 0.4 }), []);
});

// ---------- the whole list ----------

const fullInputs = (): SignalInputs => ({
  today: TODAY, rules: RULES,
  projects: [
    proj({ id: "a", name: "Smith St", health: "ACT", healthReason: "Forecast is 104% of the contract value", forecastCost: 104000, hireItems: [hire({ id: "h1", daysToDate: 36, daysInvoiced: 20, costToDate: 5760, offHireDate: null })] }),
    proj({ id: "b", name: "Vaucluse", health: "CANT_ASSESS", contractValue: null, totalCost: 52000, uncostedCount: 12 }),
  ],
  idleHire: [{ id: "i1", name: "Scissor lift", agency: "Kennards", overdue: false, idleDays: 6, idleCost: 900, onHireDays: 10, workedDays: 4 }],
  overdueHire: [{ id: "o1", name: "Hook truck", supplier: "Demo Dump", project: "Shellharbour WH1", projectId: "p9", offHireDate: "2026-10-20" }],
  dates: [{ projectId: "b", projectName: "Vaucluse", exceptions: [{ code: "DATE_NO_START", text: "No start date" }, { code: "DATE_JOBS_NO_TIMES", text: "2 upcoming jobs with no start/finish time" }] }],
  starts: [start(1, "2026-10-27", "critical")],
  supervisorGaps: [{ jobId: "j1", projectId: "a", name: "Smith St", date: "2026-10-29", daysAway: 3 }],
  crewShortDays: [{ date: "2026-10-28", own: 45, hire: 2, short: 3 }],
  crewAvailable: 42,
  daysNotClosed: Array.from({ length: 13 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
  plant: { fleetPct: 0.01, confidence: "LOW", allocatedDays: 2, machines: 16, workingDays: 20, from: "2026-09-28", to: "2026-10-25" },
});

test("every signal kind appears from one full input; keys are unique; critical first", () => {
  const s = buildSignals(fullInputs());
  const c = countByKind(s);
  for (const k of ["COST_VS_CONTRACT", "DATA_NO_CONTRACT_VALUE", "DATA_UNCOSTED", "HIRE_UNINVOICED", "HIRE_NO_FINISH", "HIRE_IDLE", "HIRE_OVERDUE", "DATE_NO_START", "DATE_JOBS_NO_TIMES", "START_NOT_READY", "NO_SUPERVISOR", "CREW_SHORT", "DAYS_NOT_CLOSED", "DATA_PLANT_NOT_BOOKED"])
    assert.ok(c[k] >= 1, `missing ${k}`);
  assert.equal(new Set(s.map((x) => x.dedupeKey)).size, s.length);
  assert.equal(s[0].severity, "CRITICAL");
  assert.equal(s[s.length - 1].severity, "INFO");
});

test("dedupeKey stability: same input -> same keys; a rename keeps the key; another subject changes it", () => {
  const a = buildSignals(fullInputs()).map((x) => x.dedupeKey);
  const b = buildSignals(structuredClone(fullInputs())).map((x) => x.dedupeKey);
  assert.deepEqual(a, b);
  const renamed = fullInputs();
  renamed.projects[0].name = "Smith Street (renamed)";
  renamed.idleHire[0].name = "Scissor lift 19ft";
  assert.deepEqual(new Set(buildSignals(renamed).map((x) => x.dedupeKey)), new Set(a));
  const other = fullInputs();
  other.projects[0].id = "a2";
  const keysOther = new Set(buildSignals(other).map((x) => x.dedupeKey));
  assert.ok(!keysOther.has("COST_VS_CONTRACT:PROJECT:a") && keysOther.has("COST_VS_CONTRACT:PROJECT:a2"));
  assert.equal(dedupeKeyOf("HIRE_OVERDUE", "RESOURCE", "x"), dedupeKeyOf("HIRE_OVERDUE", "RESOURCE", "x"));
  assert.notEqual(dedupeKeyOf("HIRE_OVERDUE", "RESOURCE", "x"), dedupeKeyOf("HIRE_IDLE", "RESOURCE", "x"));
});

test("money guard: every OPERATIONAL signal is free of dollar figures and money values", () => {
  const s = buildSignals(fullInputs());
  const ops = s.filter((x) => x.audience === "OPERATIONAL");
  assert.ok(ops.length >= 7);
  for (const x of ops) assert.ok(operationalIsMoneyFree(x), `${x.kind} carries money`);
  // And the check really bites.
  assert.equal(operationalIsMoneyFree({ ...ops[0], title: "costs $5,000" }), false);
  assert.equal(operationalIsMoneyFree({ ...ops[0], values: { estimateToDate: 10 } }), false);
  assert.equal(operationalIsMoneyFree({ ...s.find((x) => x.audience === "COMMERCIAL")! }), true); // only OPERATIONAL is checked
});
