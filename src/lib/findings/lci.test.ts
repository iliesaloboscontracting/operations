// LCI Stage 1 tests (25 Nov 2026, Ilies: "approve all defaults"): the rule fixes (lib/findings/lciRules.ts) and
// the "Needs attention" card (lib/findings/card.ts) - sorting, grouping, capping, who sees what, no money for the
// coordinator. The engine's auto-close and the cleanup are in engine.test.ts. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { UpcomingJob } from "../insights/kpis";
import type { DateException } from "../dateExceptions";
import { groupUncosted, lciDateExceptions, restartAlerts, supervisorGapsLci, uncostedDayCounts, type RestartProject } from "./lciRules";
import { buildCard, cardIsMoneyFree, cardVariant, onCard, type CardFinding } from "./card";
import { CARD, COORDINATOR_KINDS, DIRECTOR_KINDS, isNotASite, isTestProject, rulesOff, screenFor } from "./config";
import { applyFindingAction, coordinatorMayAct, type Actor } from "./actions";
import { alertsDue, cleanupDue, closeReason, datedDay, planRun, pushMessages, type FindingState, type Op } from "./engine";
import { applyOps, type FindingsTx } from "./apply";
import { actionedOnQuery } from "./queries";
import type { CardDTO, CardLine } from "./card";

const lines = (c: CardDTO): CardLine[] => [...c.top, ...c.more].flatMap((e) => (e.kind === "ONE" ? [e.line] : e.items));
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
  assert.equal(by.p1.kind, "NO_SUPERVISOR");
  assert.equal(by.p1.crew, 2);
  for (const p of ["p2", "p3", "p7"]) assert.equal(by[p].kind, "LONE_WORKER", p); // LS-005
  const s = supervisorSignals(gaps);
  assert.equal(s.find((x) => x.projectId === "p1")!.severity, "CRITICAL"); // tomorrow
  for (const p of ["p2", "p3", "p7"]) {
    const x = s.find((y) => y.projectId === p)!;
    assert.equal(x.kind, "LONE_WORKER");
    assert.equal(x.severity, "MEDIUM", "a lone worker is MEDIUM - on the card, never pushed (even tomorrow)");
    assert.equal(x.dedupeKey, `LONE_WORKER:PROJECT:${p}:2026-11-26`);
    assert.match(x.title, /: one person alone on site$/);
  }
  assert.ok(s.every((x) => operationalIsMoneyFree(x)));
  // Further out: MEDIUM, keyed by project + day.
  const later = supervisorSignals(supervisorGapsLci([job({ date: "2026-12-04", ownCrewIds: ["x", "y"] })], TODAY, new Set()));
  assert.equal(later[0].severity, "MEDIUM");
  assert.equal(later[0].dedupeKey, "NO_SUPERVISOR:PROJECT:p1:2026-12-04");
});

test("LS-005 + LS-009: each shift checked when the day and night shifts split - DAY_NO_LEAD / NIGHT_NO_LEAD; one person alone (lead or not) is LONE_WORKER", () => {
  const gaps = supervisorGapsLci([
    job({ jobId: "d", projectId: "n1", projectName: "Mascot", shift: "DAY", ownCrewIds: ["a", "b"], hasLead: true }),
    job({ jobId: "n", projectId: "n1", projectName: "Mascot", shift: "NIGHT", ownCrewIds: ["c"], labourHire: 2 }), // night crew of 3, no lead
    job({ jobId: "d5", projectId: "n5", projectName: "Day gap", shift: "DAY", ownCrewIds: ["b", "c"] }), // LS-009 a: day crew of 2, no lead,
    job({ jobId: "n5", projectId: "n5", projectName: "Day gap", shift: "NIGHT", ownCrewIds: ["d", "e"], hasLead: true }), //   the lead on the night
    job({ jobId: "d3", projectId: "n3", projectName: "Covered", shift: "DAY", ownCrewIds: ["a", "f"], hasLead: true }),
    job({ jobId: "n3", projectId: "n3", projectName: "Covered", shift: "NIGHT", ownCrewIds: ["b", "c"], hasLead: true }), // both shifts led
    job({ jobId: "n4", projectId: "n4", projectName: "Night only", shift: "NIGHT", ownCrewIds: ["b", "c"] }), // no lead at all: NO_SUPERVISOR as before
    job({ jobId: "d6", projectId: "n6", projectName: "Night alone", shift: "DAY", ownCrewIds: ["a", "b"], hasLead: true }),
    job({ jobId: "n6", projectId: "n6", projectName: "Night alone", shift: "NIGHT", ownCrewIds: ["z"] }), // one person alone at night
    job({ jobId: "s", projectId: "n7", projectName: "Supervisor alone", ownCrewIds: ["s"], hasLead: true }), // LS-009 b: a lead alone on site
    job({ jobId: "s8", projectId: "n8", projectName: "Lead alone at night", shift: "DAY", ownCrewIds: ["a", "b"], hasLead: true }),
    job({ jobId: "n8", projectId: "n8", projectName: "Lead alone at night", shift: "NIGHT", ownCrewIds: ["l"], hasLead: true }), // a lead alone on the night
    job({ jobId: "y", projectId: "yard", projectName: "Yard", shift: "NIGHT", ownCrewIds: ["a", "b"] }), // not a site
    job({ jobId: "y2", projectId: "yard", projectName: "Yard", ownCrewIds: ["q"], hasLead: true }), // not a site
  ], TODAY, new Set());
  assert.deepEqual(gaps.map((g) => `${g.projectId}:${g.kind}:${g.crew}:${g.shift}`).sort(), [
    "n1:NIGHT_NO_LEAD:3:NIGHT", "n4:NO_SUPERVISOR:2:null", "n5:DAY_NO_LEAD:2:DAY", "n6:LONE_WORKER:1:NIGHT", "n7:LONE_WORKER:1:DAY", "n8:LONE_WORKER:1:NIGHT",
  ]);
  const s = supervisorSignals(gaps);
  const by = (k: string) => s.find((x) => x.kind === k)!;
  for (const k of ["NIGHT_NO_LEAD", "DAY_NO_LEAD", "LONE_WORKER"]) assert.equal(by(k).severity, "MEDIUM", `${k}: tomorrow, but never CRITICAL - never a push`);
  assert.equal(by("NIGHT_NO_LEAD").dedupeKey, "NIGHT_NO_LEAD:PROJECT:n1:2026-11-26");
  assert.equal(by("DAY_NO_LEAD").dedupeKey, "DAY_NO_LEAD:PROJECT:n5:2026-11-26");
  assert.match(by("NIGHT_NO_LEAD").title, /^Mascot 2026-11-26: night shift crew of 3 with no supervisor or lead \(the day shift has one\)$/);
  assert.match(by("DAY_NO_LEAD").title, /^Day gap 2026-11-26: day shift crew of 2 with no supervisor or lead \(the night shift has one\)$/);
  assert.equal(s.find((x) => x.projectId === "n6")!.title, "Night alone 2026-11-26: one person alone on site on the night shift");
  assert.equal(s.find((x) => x.projectId === "n7")!.title, "Supervisor alone 2026-11-26: one person alone on site");
  assert.equal(by("NO_SUPERVISOR").severity, "CRITICAL");
  // None of the new ones ever pushes; all close as LAPSED when the day passes (dated key).
  for (const k of ["NIGHT_NO_LEAD", "DAY_NO_LEAD", "LONE_WORKER"]) assert.equal(datedDay(by(k).dedupeKey), "2026-11-26");
  const planned = planRun(s, new Map(), { now: new Date(), today: TODAY, sydneyDay: () => TODAY });
  const pushed = alertsDue(planned, true).map((o) => o.key);
  assert.deepEqual(pushed, ["NO_SUPERVISOR:PROJECT:n4:2026-11-26"]);
  // On the Operations card, each its own group label; never the coordinator's card or the Directors' screen.
  const rows = planned.filter((o) => o.type === "create").map((o, i) => f({ id: `p${i}`, ruleCode: String(o.data.ruleCode), severity: String(o.data.severity), title: String(o.data.title) }));
  assert.deepEqual([...new Set(lines(buildCard(rows, "OPERATIONS")).map((l) => l.label))].sort(), ["Crew with no supervisor or lead", "Day shift with no lead", "Night shift with no lead", "One person alone on site"]);
  assert.equal(lines(buildCard(rows, "COORDINATOR")).length, 0);
  for (const k of ["LONE_WORKER", "DAY_NO_LEAD", "NIGHT_NO_LEAD"]) assert.ok(!COORDINATOR_KINDS.has(k) && !DIRECTOR_KINDS.has(k) && screenFor({ ruleCode: k, audience: "OPERATIONAL" }) === "OPERATIONS", k);
});

test("LS-009 b: the same person on both shifts is one person alone; two people each alone on a split day (one a lead) is one LONE_WORKER for each shift", () => {
  const same = supervisorGapsLci([job({ projectId: "a", shift: "DAY", ownCrewIds: ["x"], hasLead: true }), job({ projectId: "a", shift: "NIGHT", ownCrewIds: ["x"], hasLead: true })], TODAY, new Set());
  assert.deepEqual(same.map((g) => `${g.kind}:${g.crew}`), ["LONE_WORKER:1"]);
  const two = supervisorGapsLci([job({ projectId: "b", shift: "DAY", ownCrewIds: ["x"], hasLead: true }), job({ projectId: "b", shift: "NIGHT", ownCrewIds: ["y"] })], TODAY, new Set());
  assert.deepEqual(two.map((g) => `${g.kind}:${g.crew}:${g.shift}`), ["LONE_WORKER:2:BOTH"]);
  assert.match(supervisorSignals(two)[0].title, /one person alone on site on each shift$/);
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

// ---------- security fixes (Ilies approved LS-001..LS-004, 25 Nov 2026) ----------

const actor: Actor = { id: "u1", name: "Pat", email: "pat@x", role: "MANAGER", directorAccess: false };
const openF = { status: "OPEN", severity: "HIGH", dedupeKey: "HIRE_OVERDUE:RESOURCE:h", signalClearedAt: null, resolvedBy: null, resolvedWhileFiring: false, ownerUserId: null };
const snooze = (until: string, maxSnoozeDays?: number) =>
  applyFindingAction(openF, "DISMISS", { kind: "ACCEPTED_RISK", reason: "waiting on the supplier", until }, { actor, now: new Date(), today: TODAY, maxSnoozeDays });

test("LS-001: a snooze is a real date, at most 90 days ahead (14 for the coordinator)", () => {
  const err = (r: ReturnType<typeof snooze>) => ("error" in r ? r.error : null);
  assert.equal(err(snooze("9999-12-31")), "Snooze for at most 90 days.");
  assert.equal(err(snooze("2026-02-31")), "That date doesn't exist - pick another.");
  assert.equal(err(snooze("2027-02-29")), "That date doesn't exist - pick another.");
  assert.equal(err(snooze("2027-02-24")), "Snooze for at most 90 days."); // today + 91
  assert.equal(err(snooze("2027-02-23")), null); // today + 90
  assert.equal(err(snooze("2026-12-09")), null); // today + 14
  assert.equal(err(snooze("2026-12-09", 14)), null); // coordinator: today + 14
  assert.equal(err(snooze("2026-12-10", 14)), "Snooze for at most 14 days."); // coordinator: today + 15
  assert.equal(err(snooze(TODAY)), "Pick a date after today.");
});

test("LS-002: the store writes an engine update only if the finding still has the status it was planned from", async () => {
  const status: Record<string, string> = { a: "OPEN", b: "DISMISSED" }; // b: a person snoozed it after the plan was made
  const events: unknown[] = [], evidence: unknown[] = [];
  const tx: FindingsTx = {
    finding: {
      create: async () => ({ id: "new" }),
      updateMany: async ({ where }) => ({ count: where.status === undefined || status[where.id] === where.status ? 1 : 0 }),
    },
    findingEvent: { createMany: async ({ data }) => { events.push(...data); } },
    findingEvidence: { createMany: async ({ data }) => { evidence.push(...data); } },
  };
  const close = (id: string): Op => ({ type: "update", key: `K:${id}`, id, fromStatus: "OPEN", data: { status: "RESOLVED" }, events: [{ action: "AUTO_RESOLVED" }], evidence: [{ kind: "METRIC", label: "x" }], alert: false });
  const written = await applyOps(tx, [close("a"), close("b")], new Date());
  assert.deepEqual(written.map((o) => (o.type === "update" ? o.id : "")), ["a"]);
  assert.equal(events.length, 1, "the skipped op's events aren't written");
  assert.equal(evidence.length, 1, "nor its evidence");
  // planKey carries the status it planned from.
  const fs: FindingState = { id: "x", dedupeKey: "HIRE_OVERDUE:RESOURCE:x", ruleCode: "HIRE_OVERDUE", severity: "HIGH", status: "ACKNOWLEDGED", currentValue: null, signalClearedAt: null, clearRuns: 0, resolvedWhileFiring: false, resolvedAt: null, verifiedAt: null, dismissKind: null, suppressUntil: null, seenCount: 1 };
  const op = planRun([], new Map([[fs.dedupeKey, fs]]), { now: new Date(), today: TODAY, sydneyDay: () => TODAY })[0];
  assert.ok(op.type === "update" && op.fromStatus === "ACKNOWLEDGED");
});

const crit = (k: string, ruleCode = "NO_SUPERVISOR", audience = "OPERATIONAL", title = `Crew at ${k}`): Op =>
  ({ type: "create", key: `${ruleCode}:PROJECT:${k}`, data: { ruleCode, audience, title, severity: "CRITICAL" }, events: [], evidence: [], alert: true });

test("LS-003: at most 3 Operations CRITICAL pushes a run, then one money-free summary; Directors pushes as before", () => {
  const m = pushMessages([crit("a"), crit("b"), crit("c"), crit("d"), crit("e"), crit("x", "COST_VS_CONTRACT", "COMMERCIAL", "Job X at $120,000")], TODAY);
  const ops = m.filter((x) => x.url === "/command");
  assert.equal(ops.length, 4, "3 individual + 1 summary");
  assert.deepEqual(ops.slice(0, 3).map((x) => x.tag), ["finding-NO_SUPERVISOR:PROJECT:a", "finding-NO_SUPERVISOR:PROJECT:b", "finding-NO_SUPERVISOR:PROJECT:c"]);
  assert.match(ops[3].title, /2 critical items need attention on your board/);
  assert.ok(ops.every((x) => !/\$\s?\d/.test(x.title + x.body)));
  assert.deepEqual(m.filter((x) => x.url === "/directors").length, 1);
  assert.equal(pushMessages([crit("a"), crit("b"), crit("c")], TODAY).length, 3, "3 due: no summary");
  assert.match(pushMessages([crit("a", "START_NOT_READY", "OPERATIONAL", "Costs $5,000")], TODAY)[0].title, /Something needs attention on your board/);
});

const stale = (ruleCode: string, cleared: boolean, severity: FindingState["severity"] = "MEDIUM"): FindingState => ({
  id: ruleCode, dedupeKey: `${ruleCode}:PROJECT:p`, ruleCode, severity, status: "OPEN", currentValue: null,
  signalClearedAt: cleared ? new Date("2026-11-24T00:00:00Z") : null, clearRuns: 0, resolvedWhileFiring: false, resolvedAt: null, verifiedAt: null,
  dismissKind: null, suppressUntil: null, seenCount: 1, audience: "OPERATIONAL",
});

test("LS-004: the cleanup runs only within 7 days of its label date; its 'no longer flags it' close only for the rules Stage 1 changed", () => {
  assert.equal(cleanupDue("2026-11-25", false, true), "RUN");
  assert.equal(cleanupDue("2026-12-02", false, true), "RUN");
  assert.equal(cleanupDue("2026-12-03", false, true), "LATE");
  assert.equal(cleanupDue("2026-11-26", true, true), "DONE");
  assert.equal(cleanupDue("2026-11-26", false, false), "OFF");
  const ctx = { now: new Date(), today: TODAY, sydneyDay: () => TODAY, cleanup: true };
  // A changed rule still firing until now: closed straight away.
  assert.equal(closeReason(stale("DATE_START_MISMATCH", false), ctx, 0)?.outcome, "RULE_CHANGED");
  assert.equal(closeReason(stale("NO_SUPERVISOR", false), ctx, 0)?.outcome, "RULE_CHANGED");
  // Any other rule: the normal path - not closed until its window has passed, and never as RULE_CHANGED.
  assert.equal(closeReason(stale("HIRE_OVERDUE", false, "HIGH"), ctx, 0), null);
  assert.equal(closeReason(stale("HIRE_OVERDUE", true, "HIGH"), ctx, 1), null); // 1 day of hire's 2
  assert.equal(closeReason(stale("HIRE_OVERDUE", true, "HIGH"), ctx, 2)?.outcome, "EFFECTIVE");
  assert.equal(closeReason(stale("DATE_COMPLETED_HAS_JOBS", false), ctx, 0), null);
  assert.equal(closeReason(stale("DATE_JOBS_NO_TIMES", false, "INFO"), ctx, 0)?.short, "the problem had already gone"); // INFO closes as it always did
});
test("LS-008: a query raised from a stale view never reopens a resolved finding - it only moves OPEN / ACKNOWLEDGED to ACTIONED", () => {
  const rows = new Map<string, { status: string }>([["f1", { status: "OPEN" }], ["f2", { status: "ACKNOWLEDGED" }], ["f3", { status: "OPEN" }]]);
  // What prisma.finding.updateMany does with the where clause.
  const updateMany = (a: ReturnType<typeof actionedOnQuery>) => {
    const r = rows.get(a.where.id);
    if (!r || !a.where.status.in.includes(r.status)) return { count: 0 };
    r.status = a.data.status;
    return { count: 1 };
  };
  // Someone resolves f3 after Pat loaded it as OPEN; Pat then raises a query from that stale view.
  rows.get("f3")!.status = "RESOLVED";
  assert.deepEqual(updateMany(actionedOnQuery("f3")), { count: 0 });
  assert.equal(rows.get("f3")!.status, "RESOLVED", "it stays resolved (the query itself is kept)");
  assert.deepEqual(updateMany(actionedOnQuery("f1")), { count: 1 });
  assert.equal(rows.get("f1")!.status, "ACTIONED");
  updateMany(actionedOnQuery("f2"));
  assert.equal(rows.get("f2")!.status, "ACTIONED");
  for (const st of ["RESOLVED", "DISMISSED", "VERIFIED", "ACTIONED"]) assert.ok(!actionedOnQuery("x").where.status.in.includes(st), st);
});