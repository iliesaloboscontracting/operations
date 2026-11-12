// Project spans on the Calendar (12 Nov 2026). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarSpans, clipSpan, pastFinishOf, spanWords, type SpanBoard, type SpanProject } from "./calendarSpans";

const TODAY = "2026-11-12";
const P = (id: string, o: Partial<SpanProject>): SpanProject => ({
  id, name: id, jobNo: null, status: "ACTIVE", startDate: null, startDateConfidence: null, expectedCompletion: null, ...o,
});
const boards = (o: Record<string, Partial<SpanBoard>> = {}) =>
  new Map(Object.entries(o).map(([k, v]) => [k, { firstJobDate: null, lastJobDate: null, ...v }]));

test("clipSpan: inside, overlapping either edge, outside, open-ended", () => {
  assert.deepEqual(clipSpan("2026-11-05", "2026-11-10", "2026-11-01", "2026-11-30"),
    { from: "2026-11-05", to: "2026-11-10", clippedStart: false, clippedEnd: false });
  assert.deepEqual(clipSpan("2026-10-20", "2026-12-10", "2026-11-01", "2026-11-30"),
    { from: "2026-11-01", to: "2026-11-30", clippedStart: true, clippedEnd: true });
  assert.equal(clipSpan("2026-10-01", "2026-10-31", "2026-11-01", "2026-11-30"), null);
  assert.equal(clipSpan("2026-12-01", "2026-12-31", "2026-11-01", "2026-11-30"), null);
  assert.deepEqual(clipSpan("2026-11-20", null, "2026-11-01", "2026-11-30"),
    { from: "2026-11-20", to: "2026-11-30", clippedStart: false, clippedEnd: true });
  // One-day span on the range's last day.
  assert.deepEqual(clipSpan("2026-11-30", "2026-11-30", "2026-11-01", "2026-11-30"),
    { from: "2026-11-30", to: "2026-11-30", clippedStart: false, clippedEnd: false });
});

test("pastFinishOf: still active after the finish, jobs after it, neither, TBC", () => {
  assert.deepEqual(pastFinishOf({ expectedCompletion: "2026-11-01" }, "ACTIVE", undefined, TODAY), { reason: "STILL_ACTIVE", until: TODAY });
  // Jobs booked after the finish - the bar runs to the later of today and the last job.
  assert.deepEqual(pastFinishOf({ expectedCompletion: "2026-11-01" }, "ACTIVE", { firstJobDate: null, lastJobDate: "2026-11-20" }, TODAY),
    { reason: "STILL_ACTIVE", until: "2026-11-20" });
  assert.deepEqual(pastFinishOf({ expectedCompletion: "2026-11-30" }, "ACTIVE", { firstJobDate: null, lastJobDate: "2026-12-02" }, TODAY),
    { reason: "JOBS_AFTER", until: "2026-12-02" });
  // Inactive: a passed finish alone is not an overrun; jobs after it are.
  assert.equal(pastFinishOf({ expectedCompletion: "2026-11-01" }, "INACTIVE", undefined, TODAY), null);
  assert.deepEqual(pastFinishOf({ expectedCompletion: "2026-11-01" }, "INACTIVE", { firstJobDate: null, lastJobDate: "2026-11-03" }, TODAY),
    { reason: "JOBS_AFTER", until: "2026-11-03" });
  assert.equal(pastFinishOf({ expectedCompletion: TODAY }, "ACTIVE", undefined, TODAY), null); // finishing today is on time
  assert.equal(pastFinishOf({ expectedCompletion: "TBC" }, "ACTIVE", undefined, TODAY), null);
  assert.equal(pastFinishOf({ expectedCompletion: null }, "ACTIVE", undefined, TODAY), null);
});

test("buildCalendarSpans: the six cases Ilies decided", () => {
  const projects = [
    P("confirmed", { startDate: "2026-11-02", startDateConfidence: "CONFIRMED", expectedCompletion: "2026-12-18" }),
    P("tentative", { startDate: "2026-11-23", startDateConfidence: "TENTATIVE", expectedCompletion: "2027-01-29" }),
    P("tbc", { startDate: "2026-10-05", expectedCompletion: "TBC" }),
    P("blankFinish", { startDate: "2026-11-16", expectedCompletion: "" }),
    P("overdue", { startDate: "2026-09-28", expectedCompletion: "2026-11-06" }),
    P("recommences", { status: "INACTIVE", startDate: "2026-12-07", expectedCompletion: "2027-02-12" }),
    P("startsLater", { status: "ON_HOLD", startDate: "2026-12-01", expectedCompletion: "2026-12-11" }),
    P("inactiveNoDates", { status: "INACTIVE" }),
    P("finishOnly", { expectedCompletion: "2026-12-01" }),
    P("pausedTbc", { status: "INACTIVE", startDate: "2026-09-01", expectedCompletion: "TBC" }),
    P("inactiveOldFinishOnly", { status: "INACTIVE", expectedCompletion: "2026-10-01" }),
    P("completed", { status: "COMPLETED", startDate: "2026-11-02", expectedCompletion: "2026-11-30" }),
    P("archived", { archived: true, startDate: "2026-11-02", expectedCompletion: "2026-11-30" }),
    P("lastYear", { startDate: "2025-01-01", expectedCompletion: "2025-02-01", status: "INACTIVE" }),
  ];
  const b = boards({ recommences: { firstJobDate: "2026-10-01", lastJobDate: "2026-10-20" }, startsLater: {} });
  const r = buildCalendarSpans(projects, b, TODAY, "2026-12-31", TODAY);
  const s = Object.fromEntries(r.spans.map((x) => [x.projectId, x]));

  assert.deepEqual(Object.keys(s).sort(), ["blankFinish", "confirmed", "overdue", "recommences", "startsLater", "tbc", "tentative"]);

  assert.equal(s.confirmed.tentative, false);
  assert.equal(s.confirmed.finish, "2026-12-18");
  assert.equal(s.confirmed.from, TODAY); // clipped to the range
  assert.equal(s.confirmed.clippedStart, true);
  assert.equal(s.confirmed.clippedEnd, false);
  assert.equal(s.confirmed.pastFinish, null);
  assert.equal(s.confirmed.upcoming, null); // active projects keep the ▶ start marker instead

  assert.equal(s.tentative.tentative, true);
  assert.equal(s.tentative.clippedEnd, true);

  assert.equal(s.tbc.finishTbc, true);
  assert.equal(s.tbc.finish, null);
  assert.equal(s.tbc.to, "2026-12-31");
  assert.equal(s.tbc.clippedEnd, true);
  assert.equal(s.blankFinish.finishTbc, true);

  assert.deepEqual(s.overdue.pastFinish, { reason: "STILL_ACTIVE", until: TODAY });
  assert.equal(s.overdue.from, TODAY);
  assert.equal(s.overdue.to, TODAY);

  assert.deepEqual(s.recommences.upcoming, { kind: "RECOMMENCES", date: "2026-12-07" });
  assert.equal(s.recommences.status, "INACTIVE");
  assert.deepEqual(s.startsLater.upcoming, { kind: "STARTS", date: "2026-12-01" });
  assert.equal(s.startsLater.status, "INACTIVE"); // ON_HOLD reads as inactive

  const nd = Object.fromEntries(r.noDates.map((x) => [x.projectId, x.reason]));
  assert.deepEqual(nd, { finishOnly: "NO_START", inactiveNoDates: "NO_START", pausedTbc: "NO_RESTART" });
});

test("buildCalendarSpans: an inactive dated span in the past shows when the range is in the past (Show past days)", () => {
  const p = [P("old", { status: "INACTIVE", startDate: "2026-09-01", expectedCompletion: "2026-09-20" })];
  assert.equal(buildCalendarSpans(p, boards(), TODAY, "2026-12-31", TODAY).spans.length, 0);
  const past = buildCalendarSpans(p, boards(), "2026-09-01", "2026-09-30", TODAY).spans;
  assert.equal(past.length, 1);
  assert.equal(past[0].upcoming, null);
});

test("buildCalendarSpans: a finish before the start is drawn as finish TBC, an active span outside the range is left out", () => {
  const r = buildCalendarSpans(
    [P("backwards", { startDate: "2026-11-20", expectedCompletion: "2026-11-10" }), P("next year", { startDate: "2027-03-01", expectedCompletion: "2027-04-01" })],
    boards(), TODAY, "2026-12-31", TODAY
  );
  assert.equal(r.spans.length, 1);
  assert.equal(r.spans[0].finishTbc, true);
  assert.equal(r.spans[0].pastFinish, null);
});

test("buildCalendarSpans: no money fields - names, dates and flags only", () => {
  const r = buildCalendarSpans([P("x", { startDate: "2026-11-02", expectedCompletion: "2026-12-18" })], boards(), TODAY, "2026-12-31", TODAY);
  assert.deepEqual(Object.keys(r.spans[0]).sort(), [
    "clippedEnd", "clippedStart", "finish", "finishTbc", "from", "jobNo", "name", "pastFinish", "projectId", "start", "status", "tentative", "to", "upcoming",
  ]);
});

test("spanWords: TBC, tentative, past finish", () => {
  const f = (iso: string) => iso.slice(5);
  assert.equal(spanWords({ start: "2026-11-02", finish: "2026-12-18", finishTbc: false, tentative: false, pastFinish: null }, f), "11-02 – 12-18");
  assert.equal(spanWords({ start: "2026-11-02", finish: null, finishTbc: true, tentative: true, pastFinish: null }, f), "11-02 – finish TBC · start tentative");
  assert.equal(spanWords({ start: "2026-11-02", finish: "2026-11-06", finishTbc: false, tentative: false, pastFinish: { reason: "STILL_ACTIVE", until: TODAY } }, f),
    "11-02 – 11-06 · past expected finish");
});
