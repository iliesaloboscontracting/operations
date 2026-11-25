// LCI Stage 1 tests (25 Nov 2026, Ilies: "approve all defaults"): the rule fixes (lib/findings/lciRules.ts) and
// the "Needs attention" card (lib/findings/card.ts) - sorting, grouping, capping, who sees what, no money for the
// coordinator. The engine's auto-close and the cleanup are in engine.test.ts. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { UpcomingJob } from "../insights/kpis";
import type { DateException } from "../dateExceptions";
import { groupUncosted, lciDateExceptions, restartAlerts, supervisorGapsLci, uncostedDayCounts, type RestartProject } from "./lciRules";
import { buildCard, cardIsMoneyFree, cardVariant, onCard, type CardFinding } from "./card";
import { CARD, isNotASite, isTestProject, rulesOff } from "./config";
import { coordinatorMayAct } from "./actions";
import { supervisorSignals, uncostedSignals, operationalIsMoneyFree, startSignals } from "./signals";

const TODAY = "2026-11-25";
const job = (j: Partial<UpcomingJob>): UpcomingJob => ({ jobId: "j", projectId: "p1", projectName: "Mosman", date: "2026-11-26", ownCrewIds: [], labourHire: 0, hasLead: false, ...j });

// ---------- NO_SUPERVISOR ----------

test("NO_SUPERVISOR: only a crew of 2+ with no Supervisor or Lead on the whole project-day is a gap", () => {
  const gaps = supervisorGapsLci([
    job({ jobId: "a", projectId: "p1", ownCrewIds: ["x", "y"] }), // real gap
    job({ jobId: "b", projectId: "p2", projectName: "Bronte", labourHire: 1 }), // one labour-hire worker alone
    job({ jobId: "c", projectId: "p3", projectName: "Carlingford", ownCrewIds: ["z"] }), // one own worker alone
    job({ jobId: "d1", projectId: "p4", projectName: "Shellharbour", ownCrewIds: ["a", "b"] }), // day shift, no lead ...
    job({ jobId: "d2", projectId: "p4", projectName: "Shellharbour", ownCrewIds: ["c"], hasLead: true }), // ... night shift has one
    job({ jobId: "e", projectId: "yard", projectName: "Yard", ownCrewIds: ["a", "b", "c"] }), // not a site
    job({ jobId: "f", projectId: "test", projectName: "TEST – Ilies link testing", ownCrewIds: ["a", "b"] }), // not a site
    job({ jobId: "g", projectId: null, projectName: "One-off clean", ownCrewIds: ["a", "b"] }), // no project
    job({ jobId: "h", projectId: "p5", projectName: "Past", date: "2026-11-24", ownCrewIds: ["a", "b"] }), // gone
    job({ jobId: "i", projectId: "p6", projectName: "Starting", date: "2026-11-27", ownCrewIds: ["a", "b"] }), // the start alert has it
    job({ jobId: "k", projectId: "p7", projectName: "Two jobs", ownCrewIds: ["a"] }), job({ jobId: "k2", projectId: "p7", projectName: "Two jobs", ownCrewIds: ["a"] }), // the same person twice = solo
  ], TODAY, new Set(["p6|2026-11-27"]));
  const by = Object.fromEntries(gaps.map((g) => [g.projectId, g]));
  assert.deepEqual(Object.keys(by).sort(), ["p1", "p2", "p3", "p7"]);
  assert.equal(by.p1.solo, false);
  assert.equal(by.p1.crew, 2);
  for (const p of ["p2", "p3", "p7"]) assert.equal(by[p].solo, true, p);
  const s = supervisorSignals(gaps);
  assert.equal(s.find((x) => x.projectId === "p1")!.severity, "CRITICAL"); // tomorrow
  for (const p of ["p2", "p3", "p7"]) {
    const x = s.find((y) => y.projectId === p)!;
    assert.equal(x.severity, "INFO", "solo on site is information only - never on the card");
    assert.match(x.title, /solo on site/);
  }
  assert.ok(s.every((x) => operationalIsMoneyFree(x)));
  // Further out: MEDIUM, keyed by project + day.
  const later = supervisorSignals(supervisorGapsLci([job({ date: "2026-12-04", ownCrewIds: ["x", "y"] })], TODAY, new Set()));
  assert.equal(later[0].severity, "MEDIUM");
  assert.equal(later[0].dedupeKey, "NO_SUPERVISOR:PROJECT:p1:2026-12-04");
});

test("not a site: the Yard and TEST projects, by name; a test project's allocations are never a cost gap", () => {
  assert.ok(isNotASite("Yard") && isNotASite(" yard ") && isNotASite("TEST – Ilies link testing") && isNotASite("Test job"));
  assert.ok(!isNotASite("New Yard - Warwick Farm") && !isNotASite("Testing Rd - Mosman") && !isNotASite("Mosman") && !isNotASite(null));
  assert.ok(isTestProject("TEST – Ilies link testing") && !isTestProject("Yard"));
});

// ---------- restarts ----------

const rp = (p: Partial<RestartProject>): RestartProject => ({ id: "h", name: "Hills Hospital", jobNo: null, status: "INACTIVE", jobs: [], ...p });
const rjob = (iso: string, people: { type: string; role?: string | null; category?: string | null }[] = [], notRunning = false) =>
  ({ iso, shift: "DAY", notRunning, assignments: people.map((x) => ({ role: x.role ?? null, resource: { type: x.type, category: x.category ?? null } })) });

test("restarts: the first booked day after a 14-day gap on an inactive project is checked like a start", () => {
  const crew = [{ type: "PERSONNEL" }, { type: "PERSONNEL" }];
  const a = restartAlerts([
    rp({ id: "h1", jobs: [rjob("2026-11-27", crew)] }), // restart, no supervisor, no plant
    rp({ id: "h2", jobs: [rjob("2026-11-27", [...crew, { type: "PERSONNEL", role: "Lead" }])] }), // has a lead - fine
    rp({ id: "h3", jobs: [rjob("2026-11-20", crew), rjob("2026-11-27", crew)] }), // worked a week ago - not a restart
    rp({ id: "h4", status: "ACTIVE", jobs: [rjob("2026-11-27", crew)] }), // active: the ordinary start check
    rp({ id: "h5", status: "COMPLETED", jobs: [rjob("2026-11-27", crew)] }), // completed: its own date rule
    rp({ id: "h6", jobs: [rjob("2026-12-10", crew)] }), // beyond the 7-day window
    rp({ id: "h7", jobs: [rjob("2026-11-26", crew, true)] }), // stood down
    rp({ id: "h8", name: "Yard", jobs: [rjob("2026-11-26", crew)] }), // not a site
  ], TODAY);
  assert.deepEqual(a.map((x) => x.projectId), ["h1"]);
  assert.equal(a[0].startDate, "2026-11-27");
  assert.equal(a[0].level, "critical");
  assert.deepEqual(a[0].issues, ["No supervisor", "No plant or vehicles assigned"]);
  const s = startSignals(a);
  assert.equal(s[0].dedupeKey, "START_NOT_READY:PROJECT:h1:2026-11-27");
  assert.match(s[0].title, /^Hills Hospital restarts 2026-11-27: no supervisor/);
  assert.equal(s[0].values.restart, true);
});

// ---------- date exceptions ----------

const ex = (code: DateException["code"]): DateException => ({ code, text: code });

test("dates: inactive-with-jobs retired; start mismatch only over 7 days on a recent project; no start date not for the Yard / TEST", () => {
  const rows = lciDateExceptions([
    { projectId: "a", projectName: "Hills", startDate: null, firstJobDate: null, exceptions: [ex("DATE_INACTIVE_HAS_JOBS")] },
    { projectId: "b", projectName: "Staged", startDate: "2026-11-10", firstJobDate: "2026-11-16", exceptions: [ex("DATE_START_MISMATCH")] }, // 6 days
    { projectId: "c", projectName: "Late", startDate: "2026-11-01", firstJobDate: "2026-11-12", exceptions: [ex("DATE_START_MISMATCH")] }, // 11 days, recent
    { projectId: "d", projectName: "Old", startDate: "2026-08-01", firstJobDate: "2026-09-10", exceptions: [ex("DATE_START_MISMATCH")] }, // first board day > 60 days ago
    { projectId: "e", projectName: "Future", startDate: "2026-12-01", firstJobDate: "2026-12-15", exceptions: [ex("DATE_START_MISMATCH")] }, // booked later than planned
    { projectId: "f", projectName: "Yard", startDate: null, firstJobDate: "2026-09-22", exceptions: [ex("DATE_NO_START"), ex("DATE_JOBS_NO_TIMES")] },
    { projectId: "g", projectName: "TEST – Ilies link testing", startDate: null, firstJobDate: null, exceptions: [ex("DATE_NO_START")] },
    { projectId: "h", projectName: "BUPA Dental", startDate: null, firstJobDate: "2026-11-18", exceptions: [ex("DATE_NO_START"), ex("DATE_JOBS_AFTER_COMPLETION")] },
  ], TODAY);
  const got = Object.fromEntries(rows.map((r) => [r.projectId, r.exceptions.map((e) => e.code)]));
  assert.deepEqual(got, {
    c: ["DATE_START_MISMATCH"], e: ["DATE_START_MISMATCH"],
    f: ["DATE_JOBS_NO_TIMES"],
    h: ["DATE_NO_START", "DATE_JOBS_AFTER_COMPLETION"],
  });
});

// ---------- DATA_UNCOSTED by cause ----------

test("DATA_UNCOSTED: one finding per resource with no rate (across jobs), one per project with no hours", () => {
  const line = (resourceId: string, projectId: string, date: string, status: "RATE_MISSING" | "HOURS_UNKNOWN") =>
    ({ resourceId, resourceName: `R ${resourceId}`, resourceType: resourceId === "t" ? "VEHICLE" : "PERSONNEL", projectId, projectName: `P ${projectId}`, date, status });
  const u = groupUncosted([
    line("t", "a", "2026-11-20", "RATE_MISSING"), line("t", "b", "2026-11-21", "RATE_MISSING"), line("t", "a", "2026-11-22", "RATE_MISSING"),
    line("w", "a", "2026-11-20", "RATE_MISSING"),
    line("x", "c", "2026-11-19", "HOURS_UNKNOWN"), line("y", "c", "2026-11-23", "HOURS_UNKNOWN"),
  ]);
  assert.deepEqual(u.rates.map((r) => [r.resourceId, r.count, r.projects.join("|"), r.lastDate]), [["t", 3, "P a|P b", "2026-11-22"], ["w", 1, "P a", "2026-11-20"]]);
  assert.deepEqual(u.hours.map((h) => [h.projectId, h.count, h.lastDate]), [["c", 2, "2026-11-23"]]);
  const s = uncostedSignals(u);
  assert.deepEqual(s.map((x) => x.dedupeKey), ["DATA_UNCOSTED:RESOURCE:t", "DATA_UNCOSTED:RESOURCE:w", "DATA_UNCOSTED:PROJECT:c:HOURS"]);
  assert.ok(s.every((x) => x.severity === "INFO" && x.audience === "COMMERCIAL"));
  assert.equal(s[0].href, "/vehicles");
  assert.match(s[0].title, /^R t has no rate, so 3 allocations on P a, P b can't be costed$/);
  // Which days count: after the cut-off; the last 30 days, or a day not yet closed.
  assert.equal(uncostedDayCounts("2026-11-20", TODAY, true, "2026-09-26"), true);
  assert.equal(uncostedDayCounts("2026-10-01", TODAY, true, "2026-09-26"), false); // closed and older than 30 days
  assert.equal(uncostedDayCounts("2026-10-01", TODAY, false, "2026-09-26"), true); // not closed - still counts
  assert.equal(uncostedDayCounts("2026-09-20", TODAY, false, "2026-09-26"), false); // before the cut-off
  assert.equal(uncostedDayCounts("2026-11-26", TODAY, false, "2026-09-26"), false); // the future
});

// ---------- the card ----------

let n = 0;
const f = (x: Partial<CardFinding>): CardFinding => ({
  id: `f${++n}`, ruleCode: "NO_SUPERVISOR", severity: "MEDIUM", audience: "OPERATIONAL", status: "OPEN", title: `Finding ${n}`, href: "/command",
  firstSeenAt: new Date(Date.UTC(2026, 10, 1 + (n % 20))), signalClearedAt: null, resolvedWhileFiring: false, currentValue: null, ...x,
});

test("card: who gets which card - the owner, Admins, Managers; the coordinator his own; nobody else", () => {
  assert.equal(cardVariant({ email: "iliesa@loboscontracting.com.au", role: "ADMIN" }), "OPERATIONS");
  assert.equal(cardVariant({ email: "a@x", role: "ADMIN", directorAccess: true }), "OPERATIONS");
  assert.equal(cardVariant({ email: "m@x", role: "MANAGER" }), "OPERATIONS");
  assert.equal(cardVariant({ email: "c@x", role: "COORDINATOR" }), "COORDINATOR");
  for (const role of ["VIEWER", "DIRECTOR", "ACCOUNTS", "TIMESHEETS", "YARD"]) assert.equal(cardVariant({ email: "x@x", role }), null, role);
});

test("card: worst first, then the longest-standing; INFO only in data gaps; capped with + N more", () => {
  const rows = [
    f({ ruleCode: "DATE_JOBS_AFTER_COMPLETION", severity: "MEDIUM", firstSeenAt: new Date("2026-11-03") }),
    f({ ruleCode: "HIRE_IDLE", severity: "MEDIUM", audience: "COMMERCIAL", firstSeenAt: new Date("2026-11-01") }),
    f({ ruleCode: "DAYS_NOT_CLOSED", severity: "HIGH", audience: "COMMERCIAL", firstSeenAt: new Date("2026-11-10") }),
    f({ ruleCode: "NO_SUPERVISOR", severity: "CRITICAL", firstSeenAt: new Date("2026-11-24") }),
    f({ ruleCode: "DATA_UNCOSTED", severity: "INFO", audience: "COMMERCIAL" }),
    ...Array.from({ length: 9 }, (_, i) => f({ ruleCode: `DATE_${i}_X`, severity: "MEDIUM", firstSeenAt: new Date(`2026-11-${String(10 + i).padStart(2, "0")}`) })),
  ];
  const c = buildCard(rows, "OPERATIONS");
  const first = c.top.map((e) => (e.kind === "ONE" ? e.line.rule : e.rule));
  assert.deepEqual(first.slice(0, 4), ["NO_SUPERVISOR", "DAYS_NOT_CLOSED", "HIRE_IDLE", "DATE_JOBS_AFTER_COMPLETION"]);
  assert.equal(c.top.length, CARD.maxLines);
  assert.equal(c.top.length + c.more.length, 13);
  assert.deepEqual(c.dataGaps.map((l) => l.rule), ["DATA_UNCOSTED"]);
  assert.deepEqual(c.counts, { urgent: 2, toDo: 11, dataGaps: 1 });
});

test("card: a rule with 3+ items is one line that expands, where its worst / oldest item would be", () => {
  const rows = [
    f({ ruleCode: "HIRE_OVERDUE", severity: "HIGH", firstSeenAt: new Date("2026-11-05") }),
    f({ ruleCode: "NO_SUPERVISOR", severity: "MEDIUM", firstSeenAt: new Date("2026-11-20") }),
    f({ ruleCode: "NO_SUPERVISOR", severity: "MEDIUM", firstSeenAt: new Date("2026-11-21") }),
    f({ ruleCode: "NO_SUPERVISOR", severity: "CRITICAL", firstSeenAt: new Date("2026-11-22") }),
    f({ ruleCode: "DATE_COMPLETION_PASSED", severity: "MEDIUM", firstSeenAt: new Date("2026-11-01") }),
    f({ ruleCode: "DATE_COMPLETION_PASSED", severity: "MEDIUM", firstSeenAt: new Date("2026-11-02") }),
  ];
  const c = buildCard(rows, "OPERATIONS");
  assert.equal(c.top.length, 4);
  assert.equal(c.top[0].kind, "GROUP");
  if (c.top[0].kind !== "GROUP") return;
  assert.equal(c.top[0].rule, "NO_SUPERVISOR");
  assert.equal(c.top[0].items.length, 3);
  assert.equal(c.top[0].severity, "CRITICAL");
  assert.equal(c.top[0].since, new Date("2026-11-20").toISOString());
  assert.deepEqual(c.top.slice(1).map((e) => (e.kind === "ONE" ? e.line.rule : "G")), ["HIRE_OVERDUE", "DATE_COMPLETION_PASSED", "DATE_COMPLETION_PASSED"]); // 2 of a rule stay single
});

test("card: never a Directors-only item, never a closed or snoozed one, never a plain start (the board's strip has it); a restart is on it", () => {
  const rows = [
    f({ ruleCode: "COST_VS_CONTRACT", severity: "CRITICAL", audience: "COMMERCIAL" }),
    f({ ruleCode: "XERO_UNMATCHED", severity: "INFO", audience: "DIRECTOR" }),
    f({ ruleCode: "NO_SUPERVISOR", status: "RESOLVED" }),
    f({ ruleCode: "NO_SUPERVISOR", status: "DISMISSED" }),
    f({ ruleCode: "NO_SUPERVISOR", status: "VERIFIED" }),
    f({ ruleCode: "START_NOT_READY", severity: "CRITICAL", currentValue: JSON.stringify({ startDate: "2026-11-26" }) }),
    f({ id: "restart", ruleCode: "START_NOT_READY", severity: "CRITICAL", currentValue: JSON.stringify({ startDate: "2026-11-26", restart: true }) }),
    f({ id: "done-firing", ruleCode: "DAYS_NOT_CLOSED", severity: "HIGH", status: "RESOLVED", resolvedWhileFiring: true }),
    f({ id: "done-cleared", ruleCode: "DAYS_NOT_CLOSED", severity: "HIGH", status: "RESOLVED", resolvedWhileFiring: true, signalClearedAt: new Date() }),
    f({ id: "off", ruleCode: "HIRE_IDLE", audience: "COMMERCIAL" }),
  ];
  const c = buildCard(rows, "OPERATIONS", rulesOff("HIRE_IDLE, xyz"));
  const ids = [...c.top, ...c.more].flatMap((e) => (e.kind === "ONE" ? [e.line] : e.items));
  assert.deepEqual(ids.map((l) => l.id).sort(), ["done-firing", "restart"]);
  assert.equal(ids.find((l) => l.id === "done-firing")!.doneButStillShowing, true);
});

test("card, coordinator: only his kinds, operational, money-free - no commercial, no INFO, no data gaps", () => {
  const rows = [
    f({ id: "hire", ruleCode: "HIRE_OVERDUE", severity: "HIGH", title: "Hook truck (Demo Dump) on Mosman is still out past its off-hire date (2026-11-20)", href: "/hire" }),
    f({ id: "money", ruleCode: "HIRE_OVERDUE", severity: "HIGH", title: "Excavator at $360 a day is still out", href: "/hire" }),
    f({ ruleCode: "HIRE_IDLE", severity: "MEDIUM", audience: "COMMERCIAL" }),
    f({ ruleCode: "HIRE_UNINVOICED", severity: "MEDIUM", audience: "COMMERCIAL" }),
    f({ ruleCode: "NO_SUPERVISOR", severity: "CRITICAL" }),
    f({ ruleCode: "DAYS_NOT_CLOSED", severity: "HIGH", audience: "COMMERCIAL" }),
    f({ ruleCode: "HIRE_NO_FINISH", severity: "INFO" }),
    f({ ruleCode: "DATA_UNCOSTED", severity: "INFO", audience: "COMMERCIAL" }),
  ];
  const c = buildCard(rows, "COORDINATOR");
  const lines = [...c.top, ...c.more].flatMap((e) => (e.kind === "ONE" ? [e.line] : e.items));
  assert.deepEqual(lines.map((l) => l.id), ["hire"]);
  assert.deepEqual(c.dataGaps, []);
  assert.ok(cardIsMoneyFree(c));
  assert.equal(onCard(rows[1], "COORDINATOR"), false);
  // He marks Done / Snooze (to a date) on those kinds only - never false alarm, never another kind or action.
  const hire = { ruleCode: "HIRE_OVERDUE", audience: "OPERATIONAL" };
  assert.ok(coordinatorMayAct({ role: "COORDINATOR" }, hire, "RESOLVE"));
  assert.ok(coordinatorMayAct({ role: "COORDINATOR" }, hire, "DISMISS", { kind: "ACCEPTED_RISK" }));
  assert.ok(!coordinatorMayAct({ role: "COORDINATOR" }, hire, "DISMISS", { kind: "FALSE_ALARM" }));
  for (const a of ["ACKNOWLEDGE", "ASSIGN", "COMMENT", "VERIFY"]) assert.ok(!coordinatorMayAct({ role: "COORDINATOR" }, hire, a), a);
  assert.ok(!coordinatorMayAct({ role: "COORDINATOR" }, { ruleCode: "NO_SUPERVISOR", audience: "OPERATIONAL" }, "RESOLVE"));
  assert.ok(!coordinatorMayAct({ role: "COORDINATOR" }, { ruleCode: "HIRE_IDLE", audience: "COMMERCIAL" }, "RESOLVE"));
  assert.ok(!coordinatorMayAct({ role: "MANAGER" }, hire, "RESOLVE")); // Managers go the ordinary way
});

test("kill switch LCI_RULES_OFF parses codes, any case, ignoring blanks", () => {
  assert.deepEqual([...rulesOff(" no_supervisor, ,HIRE_IDLE ")], ["NO_SUPERVISOR", "HIRE_IDLE"]);
  assert.deepEqual([...rulesOff("")], []);
  assert.deepEqual([...rulesOff(undefined)], []);
});
