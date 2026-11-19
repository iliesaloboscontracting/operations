import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  overlapsSignIn, startRefusal, TIP_BLOCK_REASON, TIP_CAP_HOURS, TIP_OFFER_HOURS, tipBlocks, tipCorrectionError, tipHours, tipRunOn, tipShifts, tipStillOpen,
} from "./rules";
import { makeTravelPass, readTravelPass } from "../signin";
import { approvalBlockers, peopleOf, timesheetCsv, tipRunIssues, type TipRunLine } from "../timesheets";
import { fileIsSafe } from "../payroll/rules";

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
  assert.match(store, /startRefusal\(\{ on: tipRunOn\(\)/, "the start route refuses when off");
  assert.match(store, /enabled: tipRunOn\(\)/, "the phone hides the button when off");
  assert.doesNotMatch(store.slice(store.indexOf("export async function finishTipRun"), store.indexOf("export async function endTipRunOnSignIn")), /tipRunOn/, "an open run can still be finished");
});

test("never over a sign-in: overlap check, and office corrections refuse one", () => {
  const signIns = [{ in: at(9), out: at(17) }];
  assert.equal(overlapsSignIn(at(17), at(18), signIns), false, "starts as the shift ends");
  assert.equal(overlapsSignIn(at(16), at(18), signIns), true);
  assert.equal(overlapsSignIn(at(18), null, [{ in: at(19), out: null }], at(20)), true, "an open sign-in runs to now");
  assert.equal(tipCorrectionError(at(18), at(19), signIns), null);
  assert.match(tipCorrectionError(at(16), at(18), signIns)!, /overlap/);
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
  assert.ok(csv.includes("Unpaid break (min),Hours,Tip run (h),Travel (h),Status,Notes"));
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
  assert.match(route, /const snapshot: TimesheetSnapshot = \{ weekStart, lines, travel, tipRuns \}/);
});

test("Day Review and every sign-in: a sign-in ends an open run; Day Review adds finished runs' hours", () => {
  const overlap = readFileSync(new URL("../signinOverlap.ts", import.meta.url), "utf8");
  assert.match(overlap, /endTipRunOnSignIn\(o\.who\.resourceId, o\.at/);
  const actuals = readFileSync(new URL("../signInActuals.ts", import.meta.url), "utf8");
  assert.match(actuals, /tipRunHoursForJobs\(open\)/);
  assert.doesNotMatch(actuals, /hoursSource: "TIP/, "typed hours still never overwritten - the same SIGN_IN source");
});
