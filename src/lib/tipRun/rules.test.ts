import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCKED_WEEK_RUN, overlapsSignIn, parseOfficeTime, SAME_SHIFT_RUN, startDecision, startRefusal, TIP_BLOCK_REASON, TIP_CAP_HOURS, TIP_FLAG_LABEL,
  TIP_OFFER_HOURS, tipBlocks, tipCorrectionError, tipHours, tipNeedsOffice, tipRunOn, tipShifts, tipStillOpen, tipVerdict,
} from "./rules";
import { makeTravelPass, readTravelPass } from "../signin";
import { approvalBlockers, peopleOf, timesheetCsv, tipRunIssues, type TipRunLine } from "../timesheets";
import { EXPORT_COLUMNS, fileIsSafe, payRunRows, toCsv } from "../payroll/rules";
import { rankAtLeast } from "../roleRank";

// Regional tip run (19 Nov 2026, Ilies: shift rollover): "Start tip run" -> "Tipped – finished" on the worker's own
// phone after a regional shift; worked hours on the shift's date in their own column.
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 19, h, m));

test("hours: start to end, nearest quarter hour, no break", () => {
  assert.deepEqual(tipHours(at(21), at(22, 7)), { hours: 1, flag: null }, "1h07 -> 1");
  assert.deepEqual(tipHours(at(21), at(22, 8)), { hours: 1.25, flag: null }, "1h08 -> 1.25");
  assert.deepEqual(tipHours(at(21), at(21, 52)), { hours: 0.75, flag: null });
  assert.deepEqual(tipHours(at(21), at(21)), { hours: 0, flag: null });
});

test(`never ended, or over ${TIP_CAP_HOURS}h: no hours, flagged, and it blocks the week's approval`, () => {
  assert.equal(TIP_CAP_HOURS, 6);
  assert.deepEqual(tipHours(at(1), at(1 + TIP_CAP_HOURS)), { hours: 6, flag: null }, "exactly 6 h counts");
  assert.deepEqual(tipHours(at(1), at(1 + TIP_CAP_HOURS, 1)), { hours: null, flag: "OVER_CAP" });
  assert.deepEqual(tipHours(at(1), null, at(3)), { hours: null, flag: "ON_THE_GO" });
  assert.equal(tipStillOpen(at(1), null, at(1 + TIP_CAP_HOURS)), true);
  assert.deepEqual(tipHours(at(1), null, at(1 + TIP_CAP_HOURS, 1)), { hours: null, flag: "NOT_ENDED" });
  assert.equal(tipStillOpen(at(1), null, at(1 + TIP_CAP_HOURS, 1)), false, "the phone can't finish it any more - the office does");
  for (const f of ["NOT_ENDED", "OVER_CAP", "ON_THE_GO"] as const) assert.equal(tipBlocks(f), true, f);
  assert.equal(tipBlocks(null), false);
  assert.equal(TIP_BLOCK_REASON.OVER_CAP, "tip run over 6h");
});

test("who may start one: a regional shift signed out within 12 hours, the latest first", () => {
  assert.equal(TIP_OFFER_HOURS, 12);
  const now = at(22);
  const s = (id: string, o: Partial<{ regional: boolean; out: Date | null }> = {}) => ({ attendanceId: id, regional: o.regional ?? true, signOutAt: o.out === undefined ? at(19) : o.out });
  assert.deepEqual(tipShifts([s("a")], now).map((x) => x.attendanceId), ["a"]);
  assert.deepEqual(tipShifts([s("a", { regional: false })], now), [], "regional projects only");
  assert.deepEqual(tipShifts([s("a", { out: null })], now), [], "worked it = signed in AND signed out");
  assert.deepEqual(tipShifts([s("a", { out: at(22 - TIP_OFFER_HOURS) })], now).length, 1, "exactly 12 h after");
  assert.deepEqual(tipShifts([s("a", { out: at(22 - TIP_OFFER_HOURS, -1) })], now), [], "more than 12 h after");
  assert.deepEqual(tipShifts([s("a", { out: at(23) })], now), [], "not a future sign-out");
  assert.deepEqual(tipShifts([s("old", { out: at(15) }), s("new", { out: at(20) })], now).map((x) => x.attendanceId), ["new", "old"]);
});

test("start refusals: switched off, no shift, signed in, one open at a time, travelling", () => {
  const now = at(22);
  const shift = { attendanceId: "a", regional: true, signOutAt: at(19) };
  const ok = { on: true, shift, now, signedIn: false, openRun: false, travelling: false };
  assert.equal(startRefusal(ok), null);
  assert.match(startRefusal({ ...ok, on: false })!, /switched off/, "TIP_RUN=off");
  assert.match(startRefusal({ ...ok, shift: undefined })!, /after you sign out of a regional shift/);
  assert.match(startRefusal({ ...ok, shift: { ...shift, regional: false } })!, /regional shift/);
  assert.match(startRefusal({ ...ok, shift: { ...shift, signOutAt: at(9) } })!, /within 12 hours/);
  assert.match(startRefusal({ ...ok, signedIn: true })!, /signed in right now/);
  assert.match(startRefusal({ ...ok, openRun: true })!, /already got a tip run/);
  assert.match(startRefusal({ ...ok, travelling: true })!, /travel on the go/);
});

test("the kill switch reads TIP_RUN", () => {
  assert.equal(tipRunOn({}), true);
  assert.equal(tipRunOn({ TIP_RUN: "off" }), false);
  assert.equal(tipRunOn({ TIP_RUN: " OFF " }), false);
  assert.equal(tipRunOn({ TIP_RUN: "on" }), true);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /startDecision\(\{\r?\n\s+active: [^\n]*, on: tipRunOn\(\),/, "the start route refuses when off"); // \r?: CRLF checkouts too (KI-2)
  assert.match(store, /enabled: tipRunOn\(\)/, "the phone hides the button when off");
  assert.doesNotMatch(store.slice(store.indexOf("export async function finishTipRun"), store.indexOf("export async function endTipRunOnSignIn")), /tipRunOn/, "an open run can still be finished");
});

test("never over a sign-in: overlap check, and office corrections refuse one", () => {
  const signIns = [{ in: at(9), out: at(17) }];
  assert.equal(overlapsSignIn(at(17), at(18), signIns), false, "starts as the shift ends");
  assert.equal(overlapsSignIn(at(16), at(18), signIns), true);
  assert.equal(overlapsSignIn(at(18), null, [{ in: at(19), out: null }], at(20)), true, "an open sign-in runs to now");
  assert.equal(tipCorrectionError(at(18), at(19), signIns, at(20)), null);
  assert.match(tipCorrectionError(at(16), at(18), signIns, at(20))!, /overlap/);
  assert.match(tipCorrectionError(at(19), at(18), [])!, /after the start/);
  assert.match(tipCorrectionError(new Date("x"), null, [])!, /start time/);
});

test("the travel pass is the phone's proof (own phone only)", () => {
  process.env.AUTH_SECRET ??= "test-secret-for-unit-tests-only";
  const pass = makeTravelPass("r1", "dev1", 1_000);
  assert.equal(readTravelPass(pass, "dev1", 2_000), "r1");
  assert.equal(readTravelPass(pass, "dev2", 2_000), null);
  const route = readFileSync(new URL("../../app/api/site/in/tip/route.ts", import.meta.url), "utf8");
  assert.match(route, /readTravelPass\(body\.pass, deviceId\)/, "nobody starts a tip run for someone else");
  assert.match(route, /assertNoMoney\(JSON\.stringify\(x\)\)/, "no $ on the link");
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /assertNoMoney\(JSON\.stringify\(out\)\)/);
  assert.doesNotMatch(store, /prisma\.(jobActual|assignment|allocationCost|siteAttendance|job|project|travelLeg)\.(create|update|upsert|delete)/, "tip runs write TipRun / TipRunEdit only - never a sign-in, allocation, cost or travel");
  assert.doesNotMatch(store, /gps/i, "no location (Ilies didn't ask)");
});

const tr = (o: Partial<TipRunLine>): TipRunLine => ({
  tipRunId: "t1", date: "2026-11-16", resourceId: "r1", name: "Sam Smith", role: "Truck Driver", jobId: "j1", site: "Calwell (night)",
  start: "8:15 am", end: "9:45 am", startAt: "", endAt: null, hours: 1.5, flag: null, changedByOffice: null, ...o,
});
const line = { attendanceId: "a1", date: "2026-11-16", resourceId: "r1", name: "Sam Smith", role: "Truck Driver", site: "Calwell (night)", in: "9:00 pm", out: "5:00 am", breakMinutes: 30, hours: 7.5, status: "CONFIRMED", allocated: true, changedByOffice: null };

test("timesheets: worked hours in the total, their own Tip run column; a flagged run counts nothing", () => {
  const [p] = peopleOf("2026-11-16", [line], [], [tr({}), tr({ tipRunId: "t2", end: null, hours: null, flag: "NOT_ENDED" })]);
  assert.equal(p.total, 9, "7.5 shift + 1.5 tip run");
  assert.equal(p.tipRunTotal, 1.5);
  assert.equal(p.tipRuns!["2026-11-16"].length, 2, "on the shift's date");
  assert.equal(p.travelTotal, 0, "not travel");
  const csv = timesheetCsv("2026-11-16", [line], null, [], { tipRuns: [tr({})] });
  assert.ok(csv.includes("Unpaid break (min),Hours,Of which tip run (h),Travel (h),Status,Notes"));
  assert.ok(csv.includes("Tip run - Calwell (night),8:15 am,9:45 am,0,1.5,1.5,,Tip run"), "Hours and Tip run (h)");
  assert.ok(csv.includes("WEEK TOTAL,,,,,9,1.5,0,,"));
  assert.ok(fileIsSafe(csv));
});

test("approval: blocked by a run never ended, over 6h or still on the go - not by a finished one", () => {
  assert.deepEqual(approvalBlockers([line], [], [tr({})]), []);
  assert.deepEqual(approvalBlockers([line], [], [tr({ flag: "NOT_ENDED", hours: null })]), ["Sam Smith (2026-11-16: tip run never ended)"]);
  assert.deepEqual(approvalBlockers([line], [], [tr({ flag: "OVER_CAP", hours: null })]), ["Sam Smith (2026-11-16: tip run over 6h)"]);
  assert.deepEqual(approvalBlockers([line], [], [tr({ flag: "ON_THE_GO", hours: null })]), ["Sam Smith (2026-11-16: still on a tip run)"]);
  assert.equal(tipRunIssues([tr({}), tr({ flag: "NOT_ENDED" }), tr({ flag: "ON_THE_GO" })]), 2);
  // The approval route locks them into the snapshot and counts them in the week's hours.
  const route = readFileSync(new URL("../../app/api/timesheets/route.ts", import.meta.url), "utf8");
  assert.match(route, /approvalBlockers\(lines, travel, tipRuns\)/);
  assert.match(route, /const snapshot: TimesheetSnapshot = \{ weekStart, lines, travel, tipRuns(, absences)? \}/); // + Sick / Not in marks (23 Nov 2026)
});

test("Day Review and every sign-in: a sign-in ends an open run; Day Review adds finished runs' hours", () => {
  const overlap = readFileSync(new URL("../signinOverlap.ts", import.meta.url), "utf8");
  assert.match(overlap, /endTipRunOnSignIn\(o\.who\.resourceId, o\.at/);
  const actuals = readFileSync(new URL("../signInActuals.ts", import.meta.url), "utf8");
  assert.match(actuals, /tipRunHoursForJobs\(open\)/);
  assert.doesNotMatch(actuals, /hoursSource: "TIP/, "typed hours still never overwritten - the same SIGN_IN source");
});

// ---------- the security review fixes (Ilies approved SR-001..008, 19 Nov 2026) ----------

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const store = src("./store.ts");
const fn = (code: string, name: string) => { const i = code.indexOf(`export async function ${name}`); return code.slice(i, code.indexOf("\nexport ", i + 10)); };
const go = { active: true, on: true, shift: { attendanceId: "a", regional: true, signOutAt: at(19) }, now: at(22), signedIn: false, openRun: false, travelling: false, runForShift: false, lockedWeek: false };

test("SR-001 (a): start → finish → start again on the same shift is refused (409) - runs can't be chained past the cap", () => {
  assert.equal(startDecision(go), null);
  assert.deepEqual(startDecision({ ...go, runForShift: true }), { error: SAME_SHIFT_RUN, status: 409 });
  assert.match(SAME_SHIFT_RUN, /already a tip run for this shift/);
  const start = fn(store, "startTipRun");
  // Counted over every run for the shift (finished ones too), before and inside the transaction (a race rolls back).
  assert.match(start, /prisma\.tipRun\.count\(\{ where: \{ resourceId, jobId: shift\.job!\.id \} \}\)/);
  assert.match(start, /tx\.tipRun\.count\(\{ where: \{ resourceId, jobId: job\.id \} \}\)\) > 1\) throw new SameShift\(\)/);
  assert.match(start, /if \(e instanceof SameShift\) return \{ error: SAME_SHIFT_RUN, status: 409 \}/);
});

test("SR-011: one run per person per shift's job - counted by resourceId + jobId, never by job only or by sign-in row", () => {
  const start = fn(store, "startTipRun");
  const counts = [...start.matchAll(/tipRun\.count\(\{ where: \{ ([^}]*) \}/g)].map((m) => m[1]);
  // The open-run count is per person; both shift counts are per person AND job.
  assert.deepEqual(counts.filter((w) => w.includes("jobId")), ["resourceId, jobId: shift.job!.id", "resourceId, jobId: job.id"]);
  assert.ok(counts.every((w) => w.startsWith("resourceId")), "every count is for this person");
  assert.doesNotMatch(start, /count\(\{ where: \{ shiftAttendanceId/, "a second sign-in row on the same job (\"Back on the same shift\") can't open a second run");
  // Locked week is checked before the run-per-shift refusal (both 409).
  assert.deepEqual(startDecision({ ...go, runForShift: true, lockedWeek: true }), { error: LOCKED_WEEK_RUN, status: 409 });
});

test("SR-002 (b): a start in a locked week is 409 before anything is written; finish too", () => {
  assert.deepEqual(startDecision({ ...go, lockedWeek: true }), { error: LOCKED_WEEK_RUN, status: 409 });
  const start = fn(store, "startTipRun");
  assert.ok(start.indexOf("lockedWeekFor(shift.date)") > 0 && start.indexOf("lockedWeekFor(shift.date)") < start.indexOf("tx.tipRun.create"), "checked before the create");
  assert.ok(start.indexOf("if (stop) return stop") < start.indexOf("prisma.$transaction"), "refused before the transaction");
  const finish = fn(store, "finishTipRun");
  assert.ok(finish.indexOf("lockedWeekFor(run.date)") > 0 && finish.indexOf("lockedWeekFor(run.date)") < finish.indexOf("prisma.tipRun.update"), "finish refuses a locked week before writing");
});

test("SR-003 (c): a run overlapping a sign-in (e.g. one the office added) counts nothing and blocks approval", () => {
  const shift = { status: "CONFIRMED", removedAt: null };
  assert.deepEqual(tipVerdict({ startAt: at(8), endAt: at(9, 30) }, shift, [{ in: at(0), out: at(6) }], at(12)), { hours: 1.5, flag: null }, "after the shift: counts");
  assert.deepEqual(tipVerdict({ startAt: at(8), endAt: at(9, 30) }, shift, [{ in: at(0), out: at(6) }, { in: at(9), out: at(15) }], at(16)), { hours: null, flag: "OVERLAPS_SIGN_IN" });
  assert.deepEqual(approvalBlockers([line], [], [tr({ flag: "OVERLAPS_SIGN_IN", hours: null })]), ["Sam Smith (2026-11-16: tip run overlaps a sign-in)"]);
  const [p] = peopleOf("2026-11-16", [line], [], [tr({ flag: "OVERLAPS_SIGN_IN", hours: null })]);
  assert.equal(p.tipRunTotal, 0);
  assert.equal(p.total, 7.5, "no hours from it");
  assert.equal(TIP_FLAG_LABEL.OVERLAPS_SIGN_IN, "overlaps a sign-in - not counted");
  // A run never finished long ago is NOT_ENDED - only its 6 h window is checked for an overlap, not up to today.
  assert.deepEqual(tipVerdict({ startAt: at(1), endAt: null }, shift, [{ in: at(8), out: at(16) }], at(20)), { hours: null, flag: "NOT_ENDED" });
  assert.deepEqual(tipVerdict({ startAt: at(1), endAt: null }, shift, [{ in: at(6), out: at(16) }], at(20)), { hours: null, flag: "OVERLAPS_SIGN_IN" }, "inside its window");
  assert.equal(tipNeedsOffice("OVERLAPS_SIGN_IN"), true);
  // Every place hours are read uses the check: Sign-ins / Timesheets, Day Review and the payroll files.
  assert.match(store, /const verdicts = await tipRunVerdicts\(runs\);\r?\n  return runs\.map\(\(r\) => lineOf\(r, roles, verdicts\.get\(r\.id\)!\)\)/);
  assert.match(fn(store, "tipRunHoursForJobs"), /tipRunVerdicts\(runs, now\)/);
  assert.match(src("../payroll/store.ts"), /hours: verdicts\.get\(r\.id\)\?\.hours \?\? null/);
  assert.match(fn(store, "tipRunVerdicts"), /status: \{ not: "REJECTED" \}, removedAt: null/, "only sign-ins that still count");
});

test("SR-004 (d): the shift sign-in rejected or removed: the run counts nothing and blocks approval", () => {
  const run = { startAt: at(8), endAt: at(9) };
  assert.deepEqual(tipVerdict(run, { status: "REJECTED", removedAt: null }, []), { hours: null, flag: "SHIFT_REMOVED" });
  assert.deepEqual(tipVerdict(run, { status: "REJECTED", removedAt: at(10) }, []), { hours: null, flag: "SHIFT_REMOVED" });
  assert.deepEqual(tipVerdict(run, { status: "CONFIRMED", removedAt: at(10) }, []), { hours: null, flag: "SHIFT_REMOVED" });
  assert.deepEqual(tipVerdict(run, null, []), { hours: null, flag: "SHIFT_REMOVED" }, "not found");
  assert.deepEqual(approvalBlockers([line], [], [tr({ flag: "SHIFT_REMOVED", hours: null })]), ["Sam Smith (2026-11-16: tip run's shift sign-in was removed)"]);
  for (const f of ["SHIFT_REMOVED", "OVERLAPS_SIGN_IN", "NOT_ENDED", "OVER_CAP", "ON_THE_GO"] as const) assert.equal(tipBlocks(f), true, f);
});

test("SR-003 (e): travel out (and home) can't start while a tip run is open", () => {
  const travel = src("../travel/store.ts");
  const out = fn(travel, "startOut");
  assert.ok(out.indexOf("tipRunOpen(resourceId)") > 0 && out.indexOf("tipRunOpen(resourceId)") < out.indexOf("prisma.travelLeg.create"), "refused before the leg is written");
  assert.match(out, /return \{ error: TIP_RUN_OPEN, status: 409 \}/);
  assert.match(fn(travel, "startHome"), /tipRunOpen\(resourceId\)\) return \{ error: TIP_RUN_OPEN, status: 409 \}/);
});

test("(f) correcting a tip run is Manager+ only - TIMESHEETS, ACCOUNTS, COORDINATOR, YARD, DIRECTOR and VIEWER are refused", () => {
  const route = src("../../app/api/attendance/tip-runs/[id]/route.ts");
  assert.deepEqual([...route.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]), ["PATCH"]);
  assert.ok(route.indexOf('await guard("MANAGER")') > 0 && route.indexOf('await guard("MANAGER")') < route.indexOf("editTipRun("), "guarded before anything");
  for (const role of ["TIMESHEETS", "ACCOUNTS", "COORDINATOR", "YARD", "DIRECTOR", "VIEWER"]) assert.equal(rankAtLeast(role, "MANAGER"), false, role);
  assert.equal(rankAtLeast("MANAGER", "MANAGER"), true);
});

test("SR-001 (g): a person who isn't active on the Labour register can't start a tip run", () => {
  assert.deepEqual(startDecision({ ...go, active: false }), { error: "You're not on the active Labour register - ask the office.", status: 403 });
  assert.match(fn(store, "startTipRun"), /active: !!person && person\.type === "PERSONNEL" && person\.active/);
});

test("SR-006 (h): the columns say 'Of which tip run' - staff, labour hire and payroll files - and fileIsSafe passes", () => {
  const csv = timesheetCsv("2026-11-16", [line], null, [], { tipRuns: [tr({})] });
  assert.ok(csv.includes(",Hours,Of which tip run (h),Travel (h),"));
  assert.ok(timesheetCsv("2026-11-16", [], null, [], { head: ["Labour hire", "x"] }).includes(",Hours,Of which tip run (h),Travel (h),"), "labour hire: the same header");
  assert.ok(fileIsSafe(csv));
  assert.deepEqual(EXPORT_COLUMNS.slice(-2), ["Travel hours", "Of which tip run hours"]);
  const run = toCsv(payRunRows([], new Set(), new Map()));
  assert.ok(run.includes("Of which tip run hours") && fileIsSafe(run));
  assert.match(src("../payroll/store.ts"), /"Travel hours", "Of which tip run hours"\]/, "the summary file");
});

test("SR-008: office corrections - not a time is 400 (never a 500), no future end, no overlap with their other tip runs", () => {
  assert.equal(parseOfficeTime("garbage"), undefined);
  assert.equal(parseOfficeTime(42), undefined);
  assert.equal(parseOfficeTime(""), null);
  assert.equal(parseOfficeTime(null), null);
  assert.equal(parseOfficeTime("2026-11-19T06:00:00.000Z")?.toISOString(), "2026-11-19T06:00:00.000Z");
  const edit = fn(store, "editTipRun");
  assert.match(edit, /if \(!startAt\) return \{ error: "The start time isn't valid\.", status: 400 \}/);
  assert.match(edit, /if \(endAt === undefined\) return \{ error: "The end time isn't valid\.", status: 400 \}/);
  assert.ok(edit.indexOf("endAt === undefined") < edit.indexOf("prisma.tipRun.findMany"), "checked before any query");
  assert.match(tipCorrectionError(at(8), at(23), [], at(22))!, /hasn't happened yet/);
  assert.match(tipCorrectionError(at(8), at(9), [], at(22), [{ in: at(8, 30), out: at(10) }])!, /another of their tip runs/);
  assert.equal(tipCorrectionError(at(8), at(9), [], at(22), [{ in: at(9), out: at(10) }]), null, "back to back is fine");
  // The Sign-ins page shows the same-shift answer.
  assert.match(src("../attendanceView.ts"), /shiftAnswer: a\.shiftAnswer \?\? null/);
  assert.match(src("../../components/attendance/AttendanceJobCard.tsx"), /r\.shiftAnswer === "SAME" \? "Same shift" : "New shift"/);
});
