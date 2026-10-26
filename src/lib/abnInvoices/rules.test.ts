// ABN worker invoices (Accounts stage 4) - matching, hours comparison, GST flag, ABN checksum. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abnLooksValid, abnWorkersNamed, compareHours, gstFlag, parseDays, weeksCovering } from "./rules";

const PEOPLE = [
  { id: "1", name: "Cem", engagement: "ABN" }, { id: "2", name: "Joe Bloggs", engagement: "ABN" },
  { id: "3", name: "Sam", engagement: "EMPLOYEE" }, { id: "4", name: "Old Timer", engagement: "ABN", active: false }, { id: "5", name: "Joe", engagement: "ABN" },
];

test("whose invoice: every word of an ABN worker's name, as whole words; employees and leavers never", () => {
  assert.deepEqual(abnWorkersNamed("Cem Dogay Pty Ltd", PEOPLE).map((p) => p.id), ["1"]);
  assert.deepEqual(abnWorkersNamed("CEMENT SUPPLIES", PEOPLE), [], "not part of a word");
  assert.deepEqual(abnWorkersNamed("Sam Smith", PEOPLE), [], "employees aren't matched");
  assert.deepEqual(abnWorkersNamed("Old Timer Demolition", PEOPLE), [], "inactive");
  assert.deepEqual(abnWorkersNamed("Joe Bloggs", PEOPLE).map((p) => p.id), ["2", "5"], "two matches - a person decides");
  assert.deepEqual(abnWorkersNamed(null, PEOPLE), []);
});

const APPROVED = [
  { date: "2026-10-19", signed: 8, approved: 8 }, { date: "2026-10-20", signed: 8, approved: 8 },
  { date: "2026-10-21", signed: 7.5, approved: 0 }, { date: "2026-10-22", signed: 6, approved: 6 },
];

test("day by day: over, under, invoiced without approval, approved but not invoiced; 0.25 h tolerance", () => {
  const c = compareHours([{ date: "2026-10-19", hours: 8.25 }, { date: "2026-10-20", hours: 9 }, { date: "2026-10-21", hours: 7.5 }, { date: "2026-10-23", hours: 4 }], null, APPROVED);
  assert.equal(c.mode, "DAYS");
  assert.deepEqual(c.rows.map((r) => [r.date, r.flag]), [["2026-10-19", "OK"], ["2026-10-20", "OVER"], ["2026-10-21", "NOT_APPROVED"], ["2026-10-22", "NOT_INVOICED"], ["2026-10-23", "NOT_APPROVED"]]);
  assert.deepEqual([c.invoicedTotal, c.approvedTotal, c.signedTotal, c.diff], [28.75, 22, 29.5, 6.75]);
  assert.deepEqual(c.flags, ["1 day(s) invoiced over the approved hours", "2 day(s) invoiced with no approved hours"]);
  const under = compareHours([{ date: "2026-10-22", hours: 5 }], null, APPROVED);
  assert.equal(under.rows.find((r) => r.date === "2026-10-22")!.flag, "UNDER");
  const twoLines = compareHours([{ date: "2026-10-19", hours: 4 }, { date: "2026-10-19", hours: 4 }], null, APPROVED);
  assert.equal(twoLines.rows[0].flag, "OK", "two lines on one day are added up");
});

test("no days on the invoice: its total against the period; no hours at all: compare by hand", () => {
  const t = compareHours(null, 25, APPROVED);
  assert.deepEqual([t.mode, t.diff, t.flags], ["TOTAL", 3, ["Invoices 3 h more than approved for the period"]]);
  assert.deepEqual(compareHours(null, 22.1, APPROVED).flags, [], "within the tolerance");
  assert.equal(compareHours(null, null, APPROVED).mode, "NO_HOURS");
});

test("GST: charged but not registered, registered but not charged, not recorded", () => {
  assert.equal(gstFlag(100, false), "CHARGED_NOT_REGISTERED");
  assert.equal(gstFlag(0, true), "REGISTERED_NOT_CHARGED");
  assert.equal(gstFlag(null, true), "REGISTERED_NOT_CHARGED");
  assert.equal(gstFlag(100, null), "REGISTRATION_UNKNOWN");
  assert.equal(gstFlag(100, true), null);
  assert.equal(gstFlag(0, false), null);
  assert.equal(gstFlag(null, null), null);
});

test("ABN checksum (the ATO's published example is valid)", () => {
  assert.equal(abnLooksValid("51 824 753 556"), true);
  assert.equal(abnLooksValid("51 824 753 557"), false);
  assert.equal(abnLooksValid("1234"), false);
  assert.equal(abnLooksValid(""), null);
});

test("weeks an invoice period covers; stored days read safely", () => {
  assert.deepEqual(weeksCovering("2026-10-21", "2026-11-03"), ["2026-10-19", "2026-10-26", "2026-11-02"]);
  assert.deepEqual(parseDays('[{"date":"2026-10-19","hours":"8"},{"date":"bad","hours":1},{"date":"2026-10-20","hours":30}]'), [{ date: "2026-10-19", hours: 8 }]);
  assert.equal(parseDays("not json"), null);
  assert.equal(parseDays("[]"), null);
});
