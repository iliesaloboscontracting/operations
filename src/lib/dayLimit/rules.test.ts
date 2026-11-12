// Days-a-week limit (Ilies, 12 Nov 2026) - the plain rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDay, copySkips, distinctDates, limitMessage, limitOf, ordinal, overLimitDates, overLimitNote, overrideDecision, overrideNote,
  parseLimitInput, shortDay, sydneyDateOf, weekMonday, weekSunday,
} from "./rules";

test("weeks run Monday to Sunday, by Sydney date", () => {
  assert.equal(weekMonday("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(weekMonday("2026-11-12"), "2026-11-09"); // Thursday
  assert.equal(weekMonday("2026-11-15"), "2026-11-09"); // Sunday belongs to the week before
  assert.equal(weekMonday("2026-11-16"), "2026-11-16");
  assert.equal(weekSunday("2026-11-10"), "2026-11-15");
  assert.equal(weekMonday("2027-01-01"), "2026-12-28"); // across the year end
  // A moment late on Sunday in UTC is already Monday in Sydney (AEDT, UTC+11) - it counts in the new week.
  assert.equal(sydneyDateOf(new Date("2026-11-15T14:30:00Z")), "2026-11-16");
  assert.equal(weekMonday(sydneyDateOf(new Date("2026-11-15T14:30:00Z"))), "2026-11-16");
  assert.equal(sydneyDateOf(new Date("2026-11-15T12:30:00Z")), "2026-11-15"); // 11:30pm Sunday in Sydney
  // Winter (AEST, UTC+10).
  assert.equal(sydneyDateOf(new Date("2026-06-14T14:30:00Z")), "2026-06-15");
});

test("several jobs or shifts on one date count as one day", () => {
  assert.deepEqual(distinctDates(["2026-11-11", "2026-11-09", "2026-11-11", "2026-11-10", "2026-11-09"]), ["2026-11-09", "2026-11-10", "2026-11-11"]);
});

test("no limit (null) is unlimited", () => {
  const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"];
  assert.deepEqual(checkDay(null, week, "2026-11-15"), { ok: true });
  assert.deepEqual(checkDay(undefined, week, "2026-11-15"), { ok: true });
  assert.equal(limitOf(null), null);
  assert.equal(limitOf(0), null);
  assert.equal(limitOf(7), null);
  assert.equal(limitOf(2.5), null);
  assert.equal(limitOf(3), 3);
  assert.equal(overLimitDates(null, week).size, 0);
});

test("a second job on a date already counted is always fine", () => {
  const on = ["2026-11-09", "2026-11-10", "2026-11-11"];
  assert.deepEqual(checkDay(3, on, "2026-11-11"), { ok: true });
  assert.deepEqual(checkDay(3, [...on, "2026-11-11"], "2026-11-10"), { ok: true });
});

test("the 4th date in the week is refused, with the plain message", () => {
  const on = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-11"];
  const c = checkDay(3, on, "2026-11-12");
  assert.deepEqual(c, { ok: false, limit: 3, already: ["2026-11-09", "2026-11-10", "2026-11-11"] });
  assert.equal(limitMessage("Darnell", 3, (c as { already: string[] }).already), "Darnell is limited to 3 days a week – already on Mon 9, Tue 10, Wed 11.");
  assert.equal(limitMessage("Sam", 1, ["2026-11-09"]), "Sam is limited to 1 day a week – already on Mon 9.");
  // The 3rd date is fine; other weeks' dates don't count.
  assert.deepEqual(checkDay(3, ["2026-11-09", "2026-11-10"], "2026-11-12"), { ok: true });
  assert.deepEqual(checkDay(3, ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-08"], "2026-11-09"), { ok: true });
  // A move: the allocation being moved is left out of onBoard, so Wed -> Thu stays at 3 days.
  assert.deepEqual(checkDay(3, ["2026-11-09", "2026-11-10"], "2026-11-12"), { ok: true });
});

test("an override needs an Admin and a reason", () => {
  assert.deepEqual(overrideDecision("MANAGER", "short-staffed"), { ok: false, status: 403, error: "Only an Admin can go over a days-a-week limit." });
  assert.deepEqual(overrideDecision("COORDINATOR", "short-staffed"), { ok: false, status: 403, error: "Only an Admin can go over a days-a-week limit." });
  const none = overrideDecision("ADMIN", "  ");
  assert.equal(none.ok, false);
  assert.equal((none as { status: number }).status, 400);
  assert.equal(overrideDecision("ADMIN", undefined).ok, false);
  assert.deepEqual(overrideDecision("ADMIN", "  Short-staffed, Ilies OK'd  "), { ok: true, reason: "Short-staffed, Ilies OK'd" });
  assert.equal(overrideNote("Darnell", 3, ["2026-11-09", "2026-11-10", "2026-11-11"], "2026-11-12", "short-staffed"), "Darnell: 4th day Thu 12 (limit 3 d/wk) – reason: short-staffed");
});

test("copy day skips the person over their limit and says so; everyone else is copied", () => {
  const out = copySkips([
    { resourceId: "d", name: "Darnell", limit: 3, onBoard: ["2026-11-09", "2026-11-10", "2026-11-11"] },
    { resourceId: "d", name: "Darnell", limit: 3, onBoard: ["2026-11-09", "2026-11-10", "2026-11-11"] }, // a second job - one note
    { resourceId: "a", name: "Alex", limit: 3, onBoard: ["2026-11-09", "2026-11-10"] }, // 3rd day - fine
    { resourceId: "b", name: "Ben", limit: 3, onBoard: ["2026-11-09", "2026-11-10", "2026-11-13"] }, // already on Fri - fine
    { resourceId: "n", name: "No limit", limit: null, onBoard: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"] },
  ], "2026-11-13");
  assert.deepEqual([...out.skip], ["d"]);
  assert.deepEqual(out.notes, ["Darnell not copied to Fri 13 – 3-day limit"]);
});

test("sign-ins: the dates past the limit are flagged with their place in the week", () => {
  const dates = ["2026-11-09", "2026-11-10", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-14", "2026-11-16"];
  const over = overLimitDates(3, dates);
  assert.deepEqual([...over], [["2026-11-12", 4], ["2026-11-14", 5]]); // the next week (16th) starts again
  assert.equal(overLimitNote(3, 4), "Over 3-day limit (4th day this week)");
  assert.deepEqual([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(22)], ["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
  assert.equal(shortDay("2026-11-13"), "Fri 13");
});

test("what the Labour form may set", () => {
  assert.deepEqual(parseLimitInput(""), { value: null });
  assert.deepEqual(parseLimitInput(null), { value: null });
  assert.deepEqual(parseLimitInput("3"), { value: 3 });
  assert.deepEqual(parseLimitInput(4), { value: 4 });
  for (const bad of ["0", "7", "2.5", "three", -1, true]) assert.ok("error" in parseLimitInput(bad), String(bad));
});
