import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderPlan } from "./reminderPlan";

const src = { active: true, expiryDate: "2026-12-01", title: "Ticket expires: Sam Lee - First aid" };

test("an active ticket with an expiry gets a 30-day reminder", () => {
  assert.deepEqual(reminderPlan(src, null), { op: "CREATE", data: { kind: "DUE", dueDate: "2026-12-01", title: src.title, alertDays: 30, repeat: "NONE", anchorDay: 1 } });
});

test("no expiry, or archived: no reminder; an open one is cancelled", () => {
  assert.deepEqual(reminderPlan({ ...src, expiryDate: null }, null), { op: "NONE" });
  assert.deepEqual(reminderPlan({ ...src, active: false }, null), { op: "NONE" });
  assert.deepEqual(reminderPlan({ ...src, active: false }, { status: "OPEN", dueDate: "2026-12-01", title: src.title }), { op: "CANCEL" });
  assert.deepEqual(reminderPlan({ ...src, expiryDate: null }, { status: "OPEN", dueDate: "2026-12-01", title: src.title }), { op: "CANCEL" });
  assert.deepEqual(reminderPlan({ ...src, active: false }, { status: "DONE", dueDate: "2026-12-01", title: src.title }), { op: "NONE" });
});

test("an open reminder follows the record: new date resets the alert, same date and title = nothing", () => {
  assert.deepEqual(reminderPlan(src, { status: "OPEN", dueDate: "2026-12-01", title: src.title }), { op: "NONE" });
  assert.deepEqual(reminderPlan({ ...src, expiryDate: "2027-12-01" }, { status: "OPEN", dueDate: "2026-12-01", title: src.title }),
    { op: "UPDATE", data: { dueDate: "2027-12-01", anchorDay: 1, alertedFor: null } });
  assert.deepEqual(reminderPlan({ ...src, title: "Ticket expires: Sam Lee - CPR" }, { status: "OPEN", dueDate: "2026-12-01", title: src.title }),
    { op: "UPDATE", data: { title: "Ticket expires: Sam Lee - CPR" } });
});

test("a done reminder stays done unless the expiry moved (then it opens again)", () => {
  assert.deepEqual(reminderPlan(src, { status: "DONE", dueDate: "2026-12-01", title: src.title }), { op: "NONE" });
  assert.deepEqual(reminderPlan({ ...src, expiryDate: "2027-12-01" }, { status: "DONE", dueDate: "2026-12-01", title: src.title }),
    { op: "UPDATE", data: { status: "OPEN", dueDate: "2027-12-01", anchorDay: 1, title: src.title, alertedFor: null } });
  assert.deepEqual(reminderPlan({ ...src, expiryDate: "2027-12-01" }, { status: "CANCELLED", dueDate: "2026-12-01", title: src.title }).op, "UPDATE");
});
