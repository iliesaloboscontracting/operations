import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLabel, shiftLabel } from "./signin";

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
