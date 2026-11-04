// One-tap off-hire rules (Ilies, 5 Nov 2026). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callOffReminderDay, formOffHireDay, hireStatusChangeError, offHireError, offHireOutcome, offHireRef, offHiresByStatus } from "./rules";

const GEAR = { type: "HIRE", category: "PLANT", onHireDate: "2026-10-26" };
const TODAY = "2026-11-05";

test("off-hire day: a real day, not before it went on hire, at most two weeks ahead", () => {
  assert.equal(offHireError(GEAR, "2026-11-05", TODAY), null);
  assert.equal(offHireError(GEAR, "2026-10-26", TODAY), null, "the on-hire day itself");
  assert.equal(offHireError(GEAR, "2026-11-19", TODAY), null, "two weeks ahead");
  assert.match(offHireError(GEAR, "2026-11-20", TODAY)!, /two weeks/);
  assert.match(offHireError(GEAR, "2026-10-23", TODAY)!, /before it went on hire/);
  assert.match(offHireError(GEAR, "2026-02-30", TODAY)!, /Pick the day/);
  assert.match(offHireError(GEAR, undefined, TODAY)!, /Pick the day/);
});

test("only hire gear: not labour hire, not our own plant", () => {
  assert.match(offHireError({ ...GEAR, category: "LABOUR" }, TODAY, TODAY)!, /hours worked/);
  assert.match(offHireError({ ...GEAR, type: "EQUIPMENT" }, TODAY, TODAY)!, /Only hire items/);
});

test("off-hire number: optional, short, never an amount", () => {
  assert.deepEqual(offHireRef(""), { ref: null });
  assert.deepEqual(offHireRef(null), { ref: null });
  assert.deepEqual(offHireRef("  OH-12345 "), { ref: "OH-12345" });
  assert.ok("error" in offHireRef("x".repeat(41)));
  assert.ok("error" in offHireRef("$450 credit"));
});

test("once off-hired, a form saved afterwards can't quietly put it back on hire", () => {
  assert.match(hireStatusChangeError({ offHiredOn: "2026-11-03" }, "ON_HIRE")!, /Put back on hire/, "a stale form saved after the off-hire");
  assert.equal(hireStatusChangeError({ offHiredOn: "2026-11-03" }, "RETURNED"), null);
  assert.equal(hireStatusChangeError({ offHiredOn: "2026-11-03" }, undefined), null, "status not in the save");
  assert.equal(hireStatusChangeError({ offHiredOn: null }, "ON_HIRE"), null, "an older Returned item put back by hand");
  assert.equal(hireStatusChangeError(null, "RETURNED"), null);
});

test("Off-hired from the Status box records a day: the expected finish if it's passed, else today", () => {
  assert.equal(offHiresByStatus({ hireStatus: "ON_HIRE", offHiredOn: null }, "RETURNED"), true);
  assert.equal(offHiresByStatus(null, "RETURNED"), true, "added already off-hired");
  assert.equal(offHiresByStatus({ hireStatus: "RETURNED", offHiredOn: null }, "RETURNED"), false, "an older Returned item saved again keeps its old meaning");
  assert.equal(offHiresByStatus({ hireStatus: "RETURNED", offHiredOn: "2026-11-03" }, "RETURNED"), false, "already off-hired");
  assert.equal(offHiresByStatus({ hireStatus: "ON_HIRE", offHiredOn: null }, "ON_HIRE"), false);
  assert.equal(formOffHireDay({ onHireDate: "2026-10-26", offHireDate: "2026-11-02" }, TODAY), "2026-11-02");
  assert.equal(formOffHireDay({ onHireDate: "2026-10-26", offHireDate: "2026-11-12" }, TODAY), TODAY, "finish still ahead");
  assert.equal(formOffHireDay({ onHireDate: "2026-10-26", offHireDate: null }, TODAY), TODAY);
  assert.equal(formOffHireDay({ onHireDate: "2026-11-03", offHireDate: "2026-11-01" }, TODAY), TODAY, "a finish before the start isn't used");
});

test("what the supervisor reads, and when the office is reminded", () => {
  assert.match(offHireOutcome("2026-11-05", "OH-1", TODAY), /^Off-hired Thu,? 5 Nov - off-hire no\. OH-1\.$/);
  assert.match(offHireOutcome("2026-11-09", null, TODAY), /^Called off for Mon,? 9 Nov\.$/);
  assert.equal(callOffReminderDay("2026-11-05"), "2026-11-06"); // Thu -> Fri
  assert.equal(callOffReminderDay("2026-11-06"), "2026-11-09"); // Fri -> Mon
  assert.equal(callOffReminderDay("2026-11-07"), "2026-11-09"); // Sat -> Mon
});
