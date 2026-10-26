// ABN worker invoices (Accounts stage 4) - matching, hours comparison, GST flag, ABN checksum. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { abnLooksValid, abnMatch, compareHours, gstFlag, parseDays, weeksCovering, type AbnPerson } from "./rules";

// Made-up people and ABNs (the ATO's published example ABN and its neighbours).
const PEOPLE: AbnPerson[] = [
  { id: "max", name: "Max", engagement: "ABN" }, { id: "joe", name: "Joe Bloggs", engagement: "ABN" },
  { id: "cem", name: "Cem", engagement: "ABN", abn: "51 824 753 556" }, { id: "sam", name: "Sam", engagement: "EMPLOYEE" },
  { id: "old", name: "Old Timer", engagement: "ABN", active: false },
];
const kindOf = (m: ReturnType<typeof abnMatch>) => (m.kind === "SKIP" ? `SKIP:${m.person.id}:${m.why}` : m.kind);

test("a single first name is never enough: 'Max Hire' with an ABN worker 'Max' waits for a person", () => {
  const m = abnMatch("Max Hire Pty Ltd", null, PEOPLE);
  assert.equal(m.kind, "REVIEW");
  assert.equal(m.kind === "REVIEW" && m.problem, "Could be Max's own invoice (ABN worker) - attach on Accounts -> Invoice checks, or add as a job cost.");
  assert.equal(kindOf(abnMatch("Max Hire", "99 999 999 999", PEOPLE)), "REVIEW", "a different ABN on the invoice doesn't help");
});

test("the recorded ABN matches: not counted on a job, checked on Accounts", () => {
  assert.equal(kindOf(abnMatch("CD Demolition Services", "51824753556", PEOPLE)), "SKIP:cem:ABN", "ABN alone, any supplier name");
  assert.equal(kindOf(abnMatch("Cem", "51 824 753 556", PEOPLE)), "SKIP:cem:ABN", "a single name plus a matching ABN");
  assert.equal(kindOf(abnMatch("Joe Bloggs", "51824753556", PEOPLE)), "SKIP:cem:ABN", "the ABN wins over a name match");
  const twice = abnMatch("X", "51824753556", [...PEOPLE, { id: "cem2", name: "Cem Two", engagement: "ABN", abn: "51824753556" }]);
  assert.equal(twice.kind, "REVIEW", "an ABN recorded for two people waits for a person");
});

test("a full two-word name (every word, whole words) of an ABN worker is strong enough", () => {
  assert.equal(kindOf(abnMatch("Joe Bloggs Pty Ltd", null, PEOPLE)), "SKIP:joe:FULL_NAME");
  assert.equal(kindOf(abnMatch("Bloggs Joe", null, PEOPLE)), "SKIP:joe:FULL_NAME", "order doesn't matter");
  assert.equal(kindOf(abnMatch("Joe Bloggsworth", null, PEOPLE)), "NONE", "whole words only");
  assert.equal(kindOf(abnMatch("Joe Bloggs", null, [...PEOPLE, { id: "joe2", name: "Bloggs Joe", engagement: "ABN" }])), "REVIEW", "two full-name matches wait");
});

test("employees, leavers and unrelated suppliers are never matched", () => {
  assert.equal(kindOf(abnMatch("Sam Smith Plumbing", null, PEOPLE)), "NONE", "Sam is an employee");
  assert.equal(kindOf(abnMatch("Old Timer Demolition", null, PEOPLE)), "NONE", "inactive");
  assert.equal(kindOf(abnMatch("CEMENT SUPPLIES", null, PEOPLE)), "NONE", "not part of a word");
  assert.equal(kindOf(abnMatch(null, null, PEOPLE)), "NONE");
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
