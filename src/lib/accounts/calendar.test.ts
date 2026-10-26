import { test } from "node:test";
import assert from "node:assert/strict";
import { alertDue, nextDate, whenOf } from "./calendar";

test("repeating items move to their next date", () => {
  assert.equal(nextDate("2026-10-07", "MONTHLY"), "2026-11-07");
  assert.equal(nextDate("2026-01-31", "MONTHLY"), "2026-02-28");
  // the original day of month is kept, so it doesn't drift to the 28th for ever
  assert.equal(nextDate("2026-02-28", "MONTHLY", 31), "2026-03-31");
  assert.equal(nextDate("2026-10-23", "WEEKLY"), "2026-10-30");
  assert.equal(nextDate("2026-10-23", "FORTNIGHTLY"), "2026-11-06");
  assert.equal(nextDate("2026-07-28", "QUARTERLY"), "2026-10-28");
  assert.equal(nextDate("2026-07-28", "YEARLY"), "2027-07-28");
  assert.equal(nextDate("2026-07-28", "NONE"), null);
});

test("overdue, today, soon or later", () => {
  assert.equal(whenOf({ dueDate: "2026-10-25", alertDays: 3 }, "2026-10-26"), "OVERDUE");
  assert.equal(whenOf({ dueDate: "2026-10-26", alertDays: 3 }, "2026-10-26"), "TODAY");
  assert.equal(whenOf({ dueDate: "2026-10-29", alertDays: 3 }, "2026-10-26"), "SOON");
  assert.equal(whenOf({ dueDate: "2026-10-30", alertDays: 3 }, "2026-10-26"), "LATER");
});

test("one alert per due date, from the alert window on", () => {
  const item = { dueDate: "2026-10-29", alertDays: 3, alertedFor: null as string | null, status: "OPEN" };
  assert.equal(alertDue(item, "2026-10-25"), false);
  assert.equal(alertDue(item, "2026-10-26"), true);
  assert.equal(alertDue({ ...item, alertedFor: "2026-10-29" }, "2026-10-27"), false);
  assert.equal(alertDue({ ...item, status: "DONE" }, "2026-10-27"), false);
});
