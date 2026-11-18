import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLabel, shiftLabel, shiftOrder, takesSignIns } from "./signin";

// 18 Nov 2026 (Mt Hutton): Tuesday 9:11pm - the page opened on Monday night's shift and the crew signed in there.
const mon = { id: "mon", shift: "NIGHT", date: new Date("2026-11-16T00:00:00.000Z") };
const tue = { id: "tue", shift: "NIGHT", date: new Date("2026-11-17T00:00:00.000Z") };
const at = (sydney: string) => new Date(sydney + "+11:00"); // AEDT
test("evening: tonight's shift comes first, last night's never", () => {
  const none = () => false;
  assert.deepEqual(shiftOrder([mon, tue], none, at("2026-11-17T21:11:00")).map((j) => j.id), ["tue", "mon"]);
  assert.deepEqual(shiftOrder([tue, mon], none, at("2026-11-17T21:11:00")).map((j) => j.id), ["tue", "mon"]);
  // even with someone still signed in on last night's (forgot to sign out) - tonight's still opens first
  assert.deepEqual(shiftOrder([mon, tue], (id) => id === "mon", at("2026-11-17T21:11:00")).map((j) => j.id), ["tue", "mon"]);
  assert.deepEqual(shiftOrder([mon, tue], none, at("2026-11-17T13:00:00")).map((j) => j.id), ["tue", "mon"]);
});
test("morning: crew still signed in first, then last night's shift for the tip run", () => {
  assert.deepEqual(shiftOrder([tue, mon], () => false, at("2026-11-17T08:41:00")).map((j) => j.id), ["mon", "tue"]);
  assert.deepEqual(shiftOrder([mon, tue], (id) => id === "tue", at("2026-11-17T08:41:00")).map((j) => j.id), ["tue", "mon"]);
});
test("last night's shift takes new sign-ins until 2pm only; tonight's always", () => {
  assert.equal(takesSignIns(mon, at("2026-11-17T08:41:00")), true);
  assert.equal(takesSignIns(mon, at("2026-11-17T13:59:00")), true);
  assert.equal(takesSignIns(mon, at("2026-11-17T14:00:00")), false);
  assert.equal(takesSignIns(mon, at("2026-11-17T21:11:00")), false);
  assert.equal(takesSignIns(tue, at("2026-11-17T21:11:00")), true);
  assert.equal(takesSignIns(tue, at("2026-11-18T04:07:00")), true);
  assert.equal(takesSignIns(mon, at("2026-11-18T08:00:00")), false); // two nights ago
  assert.equal(takesSignIns({ shift: "DAY", date: mon.date }, at("2026-11-17T07:00:00")), false);
});

// 17 Nov 2026 (Mt Hutton): last night's and tonight's night shifts must look different on a supervisor's link.
test("night shifts show their day; day shifts are unchanged", () => {
  const project = { name: "Woolworths Mt Hutton" };
  const mon = { title: "x", shift: "NIGHT", date: new Date("2026-11-16T00:00:00.000Z"), project };
  const tue = { ...mon, date: new Date("2026-11-17T00:00:00.000Z") };
  assert.equal(shiftLabel(mon), "Woolworths Mt Hutton (night, Mon 16)");
  assert.equal(shiftLabel(tue), "Woolworths Mt Hutton (night, Tue 17)");
  assert.notEqual(shiftLabel(mon), shiftLabel(tue));
  const day = { ...mon, shift: "DAY" };
  assert.equal(shiftLabel(day), jobLabel(day));
  assert.equal(shiftLabel({ ...mon, project: null, title: "Yard job" }), "Yard job (night, Mon 16)");
});
