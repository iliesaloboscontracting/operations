// Daily site log (Task K, 25 Oct 2026): the pinned codes, what a log needs
// (the split within 0.5 h, real codes and waste classes, an ACM docket's
// photo), weekly % (a drop needs a reason), revisions, the missing-log rule
// and the 19:00 reminder's timing, the split-mismatch check, hours vs budget
// and its one Directors finding, the pilot list and the kill switch, and that
// nothing the link gets can carry money. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { BY_CODE, CODES, VERSION, WASTE_CLASSES } from "../activityCodes";
import { DOCKET_CODES, linkSafe, nextRevision, parseLog, parseProgress, pilotLinkIds, progressKey, reminderEnabled, splitFits, type LogContext } from "./rules";
import { hoursVsBudget, isMissingLog, logDueAt, pickApprovedBudget, progressDue, reminderDue, reminderWindow, splitMismatch, sydneyDay, weekStartOf } from "./checks";
import { DIRECTOR_KINDS, screenFor } from "../findings/config";
import { buildSignals, labourVsBudgetSignals, notChecked } from "../findings/signals";

test("activity codes v0.2 are pinned: 61 codes, 7 waste classes, stable shape, no prices", () => {
  assert.equal(VERSION, "activity-codes.v0.2");
  assert.equal(CODES.length, 61);
  assert.deepEqual([...WASTE_CLASSES], ["GSW", "VENM / ENM", "Asbestos (ACM)", "Mixed C&D", "Clean heavy (concrete / brick)", "Metal", "Recyclable"]);
  assert.equal(new Set(CODES.map((c) => c.code)).size, 61, "no code twice");
  for (const c of CODES) {
    assert.match(c.code, /^(GEN|HAZ|STR|DEM|CIV|MKG)-\d{2}$/);
    assert.deepEqual(Object.keys(c).filter((k) => !["code", "group", "name", "units", "siteReport", "wasteClasses"].includes(k)), [], c.code);
  }
  assert.deepEqual(DOCKET_CODES, ["DEM-10", "CIV-02"]);
  assert.equal(BY_CODE["STR-02"].name, "Ceiling removal (grid, plasterboard, insulation)");
  // The same list Estimating has (a mechanical copy) - when its reference copy is on this machine.
  const ref = "C:/Users/ilies/Documents/estimating-ref/lib/activity-codes.js";
  if (fs.existsSync(ref)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const est = require(ref) as { VERSION: string; CODES: { code: string; name: string; units: string[]; siteReport: string }[] };
    assert.equal(est.VERSION, VERSION);
    assert.deepEqual(est.CODES.map((c) => [c.code, c.name, c.units, c.siteReport]), CODES.map((c) => [c.code, c.name, c.units, c.siteReport]));
  }
});

const ctx = (x: Partial<LogContext> = {}): LogContext => ({ signedHours: 46.5, signedCrew: 6, plant: new Map([["exc5t", "PLANT"], ["tipper", "TRUCK"]]), ...x });
const good = (x: Record<string, unknown> = {}) => ({
  jobId: "j1", hours: [{ code: "STR-02", hours: 24 }, { code: "STR-03", hours: 14.5 }, { code: "DEM-10", hours: 8 }],
  plant: [{ resourceId: "exc5t", code: "STR-03", hours: 8 }, { resourceId: "tipper", code: "DEM-10", hours: 0 }],
  noDelays: true, noDockets: true, durationSec: 58, ...x,
});

test("the split must land within 0.5 h of the crew's signed hours; codes must be real", () => {
  const ok = parseLog(good(), ctx());
  if ("error" in ok) assert.fail(ok.error);
  assert.deepEqual([ok.crewCount, ok.labourHours, ok.splitHours, ok.crewOk], [6, 46.5, 46.5, true]);
  assert.deepEqual(ok.hours.map((h) => [h.code, h.kind, h.hours]), [["STR-02", "LABOUR", 24], ["STR-03", "LABOUR", 14.5], ["DEM-10", "LABOUR", 8], ["STR-03", "PLANT", 8]], "a machine with 0 h is left out");
  assert.ok(!("error" in parseLog(good({ hours: [{ code: "STR-02", hours: 46 }] }), ctx())), "0.5 h short is fine");
  assert.match((parseLog(good({ hours: [{ code: "STR-02", hours: 45.75 }] }), ctx()) as { error: string }).error, /0\.75 h still to place/);
  assert.match((parseLog(good({ hours: [{ code: "STR-02", hours: 47.25 }] }), ctx()) as { error: string }).error, /0\.75 h more/);
  assert.match((parseLog(good({ hours: [{ code: "XYZ-01", hours: 46.5 }] }), ctx()) as { error: string }).error, /isn't an activity code/);
  assert.match((parseLog(good({ hours: [{ code: "STR-02", hours: 20 }, { code: "STR-02", hours: 26.5 }] }), ctx()) as { error: string }).error, /twice/);
  assert.match((parseLog(good({ hours: [] }), ctx()) as { error: string }).error, /Split/);
  assert.match((parseLog(good({ plant: [{ resourceId: "someone-elses", code: "STR-03", hours: 8 }] }), ctx()) as { error: string }).error, /isn't on this job's board/);
  assert.equal(splitFits(46, 46.5), true);
  assert.equal(splitFits(45.9, 46.5), false);
});

test("nobody signed in: the log needs a crew count and hours typed by hand, flagged as such", () => {
  const none = ctx({ signedHours: 0, signedCrew: 0 });
  assert.match((parseLog(good(), none) as { error: string }).error, /Nobody signed in/);
  assert.match((parseLog(good({ crewOk: false, handHours: 16, handCrew: 2 }), none) as { error: string }).error, /what's wrong/);
  const byHand = parseLog(good({ crewOk: false, crewNote: "Sign-in phone flat", handHours: 16, handCrew: 2, hours: [{ code: "STR-01", hours: 16 }] }), none);
  if ("error" in byHand) assert.fail(byHand.error);
  assert.deepEqual([byHand.crewOk, byHand.crewCount, byHand.labourHours, byHand.crewNote], [false, 2, 16, "Sign-in phone flat"]);
});

test("delays and dockets: real codes and waste classes; an asbestos docket needs its photo", () => {
  const photo = "data:image/jpeg;base64,AAAA";
  const withBoth = parseLog(good({
    noDelays: false, delays: [{ delayCode: "WEATHER", hoursLost: 1.5, affects: "BOTH", note: "Storm 2-3:30" }],
    noDockets: false, dockets: [{ wasteClass: "Mixed C&D", quantity: 6.2, unit: "t", docketNo: "A12345", photo }, { code: "CIV-02", wasteClass: "VENM / ENM", quantity: 3, unit: "m3" }],
  }), ctx());
  if ("error" in withBoth) assert.fail(withBoth.error);
  assert.deepEqual(withBoth.dockets.map((d) => [d.code, d.wasteClass, d.quantity, d.unit]), [["DEM-10", "Mixed C&D", 6.2, "t"], ["CIV-02", "VENM / ENM", 3, "m3"]]);
  assert.deepEqual([withBoth.noDelays, withBoth.noDockets, withBoth.delays[0].hoursLost], [false, false, 1.5]);
  const bad = (x: Record<string, unknown>) => (parseLog(good({ noDockets: false, dockets: [{ wasteClass: "Mixed C&D", quantity: 1, unit: "t", ...x }] }), ctx()) as { error: string }).error;
  assert.match(bad({ wasteClass: "Rubbish" }), /waste class/);
  assert.match(bad({ unit: "kg" }), /t, m³, loads or bins/);
  assert.match(bad({ quantity: 0 }), /amount/);
  assert.match(bad({ code: "STR-02" }), /DEM-10 or CIV-02/);
  assert.match(bad({ wasteClass: "Asbestos (ACM)" }), /asbestos docket needs a photo/);
  assert.ok(!("error" in parseLog(good({ noDockets: false, dockets: [{ wasteClass: "Asbestos (ACM)", quantity: 2, unit: "bins", photo }] }), ctx())));
  assert.match((parseLog(good({ noDelays: false, delays: [{ delayCode: "LUNCH" }] }), ctx()) as { error: string }).error, /held you up/);
  assert.match((parseLog(good({ noDelays: false, delays: [{ delayCode: "OTHER" }] }), ctx()) as { error: string }).error, /Say what held you up/);
  assert.match((parseLog(good({ photos: [photo, photo, photo, photo, photo] }), ctx()) as { error: string }).error, /At most 4 photos/);
});

test("revisions count up per job; a correction is a new version", () => {
  assert.equal(nextRevision([]), 1);
  assert.equal(nextRevision([1]), 2);
  assert.equal(nextRevision([3, 1, 2]), 4);
});

test("weekly %: 0 to 100, only the job's lines, going down needs a reason", () => {
  const allowed = new Map([
    [progressKey({ packageId: "p1", code: "STR-01" }), { packageId: "p1", code: "STR-01", label: "Level 2 soft strip (STR-01)" }],
    [progressKey({ packageId: "p2", code: "STR-02" }), { packageId: "p2", code: "STR-02", label: "Ceilings (STR-02)" }],
  ]);
  const last = new Map([["pkg:p1", 60]]);
  const ok = parseProgress({ lines: [{ packageId: "p1", code: "STR-01", pct: 65 }, { packageId: "p2", code: "STR-02", pct: 35 }] }, allowed, last);
  assert.ok(Array.isArray(ok) && ok.length === 2);
  assert.match((parseProgress({ lines: [{ packageId: "p1", code: "STR-01", pct: 50 }] }, allowed, last) as { error: string }).error, /went down from 60%/);
  assert.ok(Array.isArray(parseProgress({ lines: [{ packageId: "p1", code: "STR-01", pct: 50, reason: "Rework after client change" }] }, allowed, last)));
  assert.match((parseProgress({ lines: [{ packageId: "p9", code: "STR-09", pct: 10 }] }, allowed, last) as { error: string }).error, /isn't one of this job's/);
  assert.match((parseProgress({ lines: [{ packageId: "p2", code: "STR-02", pct: 101 }] }, allowed, last) as { error: string }).error, /0 to 100/);
  assert.match((parseProgress({ lines: [] }, allowed, last) as { error: string }).error, /Nothing/);
});

test("weekly % is due Friday to Sunday, or on Monday-Thursday when last week's was missed", () => {
  assert.equal(weekStartOf("2026-10-30"), "2026-10-26"); // Friday -> Monday
  assert.equal(weekStartOf("2026-10-26"), "2026-10-26");
  assert.equal(weekStartOf("2026-11-01"), "2026-10-26"); // Sunday belongs to the week before
  assert.equal(progressDue("2026-10-30", { thisWeek: false, lastWeek: true, workedLastWeek: true }), true);
  assert.equal(progressDue("2026-10-30", { thisWeek: true, lastWeek: true, workedLastWeek: true }), false);
  assert.equal(progressDue("2026-10-27", { thisWeek: false, lastWeek: true, workedLastWeek: true }), false);
  assert.equal(progressDue("2026-10-27", { thisWeek: false, lastWeek: false, workedLastWeek: true }), true);
  assert.equal(progressDue("2026-10-27", { thisWeek: false, lastWeek: false, workedLastWeek: false }), false);
});

// Tuesday 27 Oct 2026 - Sydney is on daylight time (UTC+11): 19:00 = 08:00 UTC.
const at = (iso: string) => new Date(iso);
const dayJob = { date: "2026-10-27", shift: "DAY", finish: at("2026-10-27T04:30:00Z") };
const nightJob = { date: "2026-10-27", shift: "NIGHT", finish: at("2026-10-27T19:00:00Z") }; // 6am Wed Sydney

test("the reminder: 19:00 to 21:00 for a day shift; a night shift 2 h after it finishes; once the window passes, none", () => {
  assert.equal(logDueAt(dayJob).toISOString(), "2026-10-27T08:00:00.000Z");
  const w = reminderWindow(dayJob)!;
  assert.deepEqual([w.from.toISOString(), w.until.toISOString()], ["2026-10-27T08:00:00.000Z", "2026-10-27T10:00:00.000Z"]);
  assert.equal(reminderDue(dayJob, at("2026-10-27T07:59:00Z")), false, "18:59");
  assert.equal(reminderDue(dayJob, at("2026-10-27T08:00:00Z")), true, "19:00");
  assert.equal(reminderDue(dayJob, at("2026-10-27T09:59:00Z")), true, "20:59");
  assert.equal(reminderDue(dayJob, at("2026-10-27T10:00:00Z")), false, "21:00 - none after");
  assert.equal(logDueAt(nightJob).toISOString(), "2026-10-27T21:00:00.000Z", "8am Wednesday");
  assert.equal(reminderDue(nightJob, at("2026-10-27T21:30:00Z")), true);
  assert.equal(reminderDue(nightJob, at("2026-10-27T23:00:00Z")), false, "2 h after the due time");
  assert.equal(logDueAt({ ...nightJob, finish: null }).toISOString(), "2026-10-27T21:00:00.000Z", "no clear finish: 08:00 next morning");
  assert.equal(sydneyDay(at("2026-10-27T14:00:00Z")), "2026-10-28");
});

test("missing log: a pilot job that ran, no log, past its due time - and it clears when the log arrives", () => {
  const dueAt = logDueAt(dayJob);
  const j = { pilot: true, ran: true, hasLog: false, dueAt };
  assert.equal(isMissingLog(j, at("2026-10-27T07:00:00Z")), false, "before 19:00");
  assert.equal(isMissingLog(j, at("2026-10-27T08:01:00Z")), true);
  assert.equal(isMissingLog({ ...j, hasLog: true }, at("2026-10-27T08:01:00Z")), false);
  assert.equal(isMissingLog({ ...j, pilot: false }, at("2026-10-27T08:01:00Z")), false);
  assert.equal(isMissingLog({ ...j, ran: false }, at("2026-10-27T08:01:00Z")), false);
});

test("split mismatch: signed hours moved more than 0.5 h after the log; a hand-entered crew isn't compared", () => {
  assert.equal(splitMismatch({ crewOk: true, labourHours: 46.5 }, 48), true);
  assert.equal(splitMismatch({ crewOk: true, labourHours: 46.5 }, 47), false);
  assert.equal(splitMismatch({ crewOk: false, labourHours: 16 }, 0), false);
});

const pk = (id: string, code: string | null, hrs: number) => ({ packageId: id, code, name: `Pkg ${id}`, labourHrs: hrs });

test("hours vs budget: used % minus % complete; >15 Watch, >30 Act, 15 under Ahead; needs 2 logs and a weekly %", () => {
  const packages = [pk("a", "STR-02", 100), pk("b", "STR-03", 100), pk("c", "DEM-10", 50), pk("d", "STR-01", 40), pk("e", "STR-01", 60), pk("f", null, 30), pk("g", "MKG-02", 20)];
  const logged = new Map([["STR-02", 70], ["STR-03", 40], ["DEM-10", 10], ["STR-01", 50], ["MKG-02", 2]]);
  const pct = new Map([["pkg:a", 30], ["pkg:b", 20], ["pkg:c", 40], ["pkg:d", 50], ["pkg:e", 50]]);
  const rows = hoursVsBudget(packages, logged, 3, pct);
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  assert.deepEqual([by["STR-02"].usedPct, by["STR-02"].pctComplete, by["STR-02"].gapPoints, by["STR-02"].status], [70, 30, 40, "ACT"]);
  assert.deepEqual([by["STR-03"].gapPoints, by["STR-03"].status], [20, "WATCH"]);
  assert.deepEqual([by["DEM-10"].gapPoints, by["DEM-10"].status], [-20, "AHEAD"]);
  assert.deepEqual([by["STR-01"].budgetHours, by["STR-01"].pctComplete, by["STR-01"].gapPoints, by["STR-01"].status, by["STR-01"].packages], [100, 50, 0, "ON_TRACK", 2], "two packages, one code");
  assert.equal(by["MKG-02"].status, "NOT_ENOUGH", "no weekly % yet");
  assert.ok(!rows.some((r) => r.code === null), "a package with no code isn't compared");
  assert.equal(rows[0].status, "ACT", "worst first");
  assert.ok(hoursVsBudget(packages, logged, 1, pct).every((r) => r.status === "NOT_ENOUGH"), "1 log isn't enough");
  assert.equal(hoursVsBudget([pk("a", "STR-02", 100)], new Map([["STR-02", 45]]), 2, new Map([["pkg:a", 30]]))[0].status, "ON_TRACK", "exactly 15 points is still on track");
});

test("the approved budget for a job: APPROVED, matched on job or quote number, the latest revision", () => {
  const row = (x: Record<string, unknown>) => ({ estimate_id: "e1", revision: 1, status: "APPROVED", jobNo: "", quoteNo: "", ...x });
  const rows = [row({ quoteNo: "26_168", revision: 1 }), row({ quoteNo: "26_168", revision: 2 }), row({ quoteNo: "26_168", revision: 3, status: "SUBMITTED" }), row({ estimate_id: "e2", jobNo: "07" })];
  assert.equal(pickApprovedBudget(rows, { jobNo: null, quoteNo: " 26_168 " })?.revision, 2);
  assert.equal(pickApprovedBudget(rows, { jobNo: "07", quoteNo: null })?.estimate_id, "e2");
  assert.equal(pickApprovedBudget(rows, { jobNo: null, quoteNo: null }), null);
  assert.equal(pickApprovedBudget(rows, { jobNo: "99", quoteNo: "x" }), null);
});

test("hours vs budget at Act is one Directors finding per job and code - hours only, never dollars; dormant without budgets", () => {
  const input = [{ projectId: "p1", projectName: "Swiss Hotel", budgetRef: "e1/r2", rows: hoursVsBudget([pk("a", "STR-02", 100), pk("b", "STR-03", 100)], new Map([["STR-02", 70], ["STR-03", 40]]), 3, new Map([["pkg:a", 30], ["pkg:b", 20]])) }];
  const s = labourVsBudgetSignals(input);
  assert.equal(s.length, 1, "Watch isn't a finding - only Act");
  assert.deepEqual([s[0].kind, s[0].severity, s[0].audience, s[0].dedupeKey], ["LABOUR_HOURS_VS_BUDGET", "HIGH", "COMMERCIAL", "LABOUR_HOURS_VS_BUDGET:PROJECT:p1:STR-02"]);
  assert.match(s[0].title, /Swiss Hotel: STR-02 .* used 70% of its budgeted labour hours at 30% complete/);
  assert.ok(!/\$/.test(s[0].title + JSON.stringify(s[0].values)));
  assert.equal(screenFor({ ruleCode: "LABOUR_HOURS_VS_BUDGET", audience: "COMMERCIAL" }), "DIRECTORS");
  assert.ok(DIRECTOR_KINDS.has("LABOUR_HOURS_VS_BUDGET"));
  assert.deepEqual(notChecked({ wonTenders: [], labourVsBudget: null }), ["LABOUR_HOURS_VS_BUDGET"], "Estimating down: left as it is");
  assert.deepEqual(notChecked({ wonTenders: [], labourVsBudget: [] }), []);
  assert.deepEqual(notChecked({ wonTenders: [] }), [], "not passed at all (older callers): checked, nothing found");
  assert.equal(labourVsBudgetSignals([]).length, 0);
});

test("the daily log adds exactly one findings kind, and it's director-level (no operational list or alerts)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "findings", "signals.ts"), "utf8");
  const kinds = (src.match(/export type SignalKind =([\s\S]*?);/)?.[1] ?? "").match(/"([A-Z_]+)"/g)!.map((k) => k.slice(1, -1));
  assert.deepEqual(kinds.filter((k) => /LOG|DAILY|BUDGET|DOCKET|DELAY|SPLIT/.test(k)), ["LABOUR_HOURS_VS_BUDGET"]);
  assert.equal(typeof buildSignals, "function");
});

test("the pilot list and the reminder's kill switch", () => {
  assert.deepEqual([...pilotLinkIds("")], []);
  assert.deepEqual([...pilotLinkIds(undefined)], []);
  assert.deepEqual([...pilotLinkIds(" a1, b2 ,,")], ["a1", "b2"]);
  assert.equal(reminderEnabled(undefined), true);
  assert.equal(reminderEnabled("off"), false);
  assert.equal(reminderEnabled(" OFF "), false);
});

test("money guard: nothing the link gets can carry a dollar figure, and the link shapes have no money fields", () => {
  assert.equal(linkSafe({ jobs: [{ label: "Swiss Hotel", crew: { hours: 46.5 } }] }), true);
  assert.equal(linkSafe({ note: "cost was $1,200" }), false);
  const types = fs.readFileSync(path.join(process.cwd(), "src", "lib", "dailyLog", "types.ts"), "utf8");
  const linkPart = types.slice(types.indexOf("// ---------- the supervisor's link"), types.indexOf("// ---------- the office"));
  assert.ok(linkPart.length > 500);
  assert.ok(!/\b(rate|cost|price|amount|money|dollar|budgetHours|labourHrs|value)\w*\s*:/i.test(linkPart), "no money or budget-hours field on a link shape");
});
