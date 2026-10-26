// On-costs (Accounts stage 3) - the maths. The percentages here are made-up test values, not Lobos's rates
// (those are entered by an Admin and never live in code). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOnCosts, cleanRate, fyOf, groupCosts, lineList, mondayOf, rateOn, type LabourLine, type RateRow } from "./rules";

const R = (x: Partial<RateRow>): RateRow => ({ line: "SUPER", label: "Super", percent: 10, base: "PAID", appliesTo: "EMPLOYEE", effectiveFrom: "2026-07-01", ...x });
const RATES: RateRow[] = [
  R({}),
  R({ line: "WORKERS_COMP", label: "Workers comp", percent: 4, base: "PAID_PLUS_SUPER", appliesTo: "ALL" }),
  R({ line: "PAYROLL_TAX", label: "Payroll tax", percent: 2, base: "PAID_PLUS_SUPER", appliesTo: "ALL", thresholdRule: "FLAT" }),
];
const L = (x: Partial<LabourLine> = {}): LabourLine => ({ projectId: "p1", projectName: "Myers", date: "2026-10-20", personKey: "r1", personName: "Sam", engagement: "EMPLOYEE", paid: 1000, ...x });

test("the rate in force: the latest effective date on or before the day, retired rows ignored", () => {
  const rows = [R({ effectiveFrom: "2026-07-01", percent: 10 }), R({ effectiveFrom: "2026-10-01", percent: 11 }), R({ effectiveFrom: "2026-10-15", percent: 99, retiredAt: "2026-10-16" })];
  assert.equal(rateOn(rows, "SUPER", "2026-09-30")!.percent, 10);
  assert.equal(rateOn(rows, "SUPER", "2026-10-20")!.percent, 11, "the retired row is skipped");
  assert.equal(rateOn(rows, "SUPER", "2026-06-30"), null, "before any rate: not set");
  assert.equal(rateOn(rows, "PAYROLL_TAX", "2026-10-20"), null);
});

test("Victoria's method: super on paid (employees), workers comp and payroll tax on paid + super (everyone)", () => {
  const [c] = applyOnCosts([L()], RATES);
  assert.deepEqual(c.lines, { SUPER: 100, WORKERS_COMP: 44, PAYROLL_TAX: 22 });
  assert.equal(c.onCosts, 166);
  assert.equal(c.complete, true);
  const [abn] = applyOnCosts([L({ engagement: "ABN" })], RATES);
  assert.deepEqual(abn.lines, { SUPER: 0, WORKERS_COMP: 40, PAYROLL_TAX: 20 }, "ABN: no super; comp and tax on paid");
  const [unset] = applyOnCosts([L({ engagement: null })], RATES);
  assert.equal(unset.lines.SUPER, 100, "engagement not set counts as an employee");
});

test("lines with no rate are 'not set' and the line is incomplete - never guessed", () => {
  const [none] = applyOnCosts([L()], []);
  assert.deepEqual(none.lines, { SUPER: null, WORKERS_COMP: null, PAYROLL_TAX: null });
  assert.deepEqual([none.onCosts, none.complete], [0, false]);
  const [noSuper] = applyOnCosts([L()], RATES.slice(1));
  assert.deepEqual([noSuper.lines.SUPER, noSuper.lines.WORKERS_COMP, noSuper.complete], [null, 40, false], "comp on paid + super can't be right until super is set");
  const [uncosted] = applyOnCosts([L({ paid: null })], RATES);
  assert.deepEqual([uncosted.lines.SUPER, uncosted.onCosts, uncosted.complete], [null, 0, false]);
});

test("a change of rate applies from its date; an extra line an Admin adds is included", () => {
  const rows = [...RATES, R({ effectiveFrom: "2026-10-01", percent: 12 }), R({ line: "OTHER:long service levy", label: "Long service levy", percent: 1, base: "PAID", appliesTo: "ALL" })];
  const [sep, oct] = applyOnCosts([L({ date: "2026-09-30" }), L({ date: "2026-10-01" })], rows);
  assert.deepEqual([sep.lines.SUPER, oct.lines.SUPER], [100, 120]);
  assert.equal(oct.lines["OTHER:long service levy"], 10);
  assert.deepEqual(lineList(rows).map((l) => l.label), ["Super", "Workers comp", "Payroll tax", "Long service levy"]);
});

test("payroll tax above a threshold: only the part of the year's running base over it, reset each 1 July", () => {
  const rows = [RATES[0], RATES[1], R({ line: "PAYROLL_TAX", label: "Payroll tax", percent: 2, base: "PAID", appliesTo: "ALL", thresholdRule: "ABOVE_THRESHOLD", thresholdAnnual: 2500, effectiveFrom: "2025-07-01" })];
  const out = applyOnCosts([
    L({ date: "2026-06-29", personKey: "a" }), L({ date: "2026-06-30", personKey: "b" }), L({ date: "2026-06-30", personKey: "c" }), // FY2025: 3000 -> 500 over
    L({ date: "2026-07-01", personKey: "d" }), // FY2026 starts again: under the threshold
  ], rows);
  assert.deepEqual(out.map((c) => c.lines.PAYROLL_TAX), [0, 0, 10, 0]);
  assert.deepEqual([fyOf("2026-06-30"), fyOf("2026-07-01")], ["2025", "2026"]);
});

test("rounding to the cent on each line", () => {
  const [c] = applyOnCosts([L({ paid: 333.33 })], RATES);
  assert.deepEqual(c.lines, { SUPER: 33.33, WORKERS_COMP: 14.67, PAYROLL_TAX: 7.33 });
  assert.equal(c.onCosts, 55.33);
});

test("totals per job, week and person; uncosted lines counted, never summed as $0", () => {
  const costed = applyOnCosts([
    L(), L({ date: "2026-10-26", personKey: "r2", personName: "Alex" }), L({ projectId: "p2", projectName: "Bronte", paid: null }),
  ], RATES);
  const byJob = groupCosts(costed, "project");
  const myers = byJob.find((g) => g.key === "p1")!;
  assert.deepEqual([myers.paid, myers.onCosts, myers.companyCost, myers.people, myers.lines.SUPER], [2000, 332, 2332, 2, 200]);
  assert.deepEqual(byJob.find((g) => g.key === "p2")!.uncosted, 1);
  assert.deepEqual(groupCosts(costed, "week").map((g) => g.key).sort(), ["2026-10-19", "2026-10-26"]);
  assert.equal(groupCosts(costed, "person").length, 2);
  assert.equal(mondayOf("2026-11-01"), "2026-10-26", "Sunday belongs to the week before");
});

test("an Admin's rate: checked and cleaned", () => {
  assert.deepEqual(cleanRate({ line: "WORKERS_COMP", percent: "4.5", effectiveFrom: "2026-07-01" }), { line: "WORKERS_COMP", label: "Workers comp", percent: 4.5, base: "PAID_PLUS_SUPER", appliesTo: "ALL", thresholdRule: null, thresholdAnnual: null, effectiveFrom: "2026-07-01", note: null });
  assert.match((cleanRate({ line: "SUPER", percent: 101, effectiveFrom: "2026-07-01" }) as any).error, /between 0 and 100/);
  assert.match((cleanRate({ line: "SUPER", percent: 10, base: "PAID_PLUS_SUPER", effectiveFrom: "2026-07-01" }) as any).error, /Super/);
  assert.match((cleanRate({ line: "PAYROLL_TAX", percent: 2, thresholdRule: "ABOVE_THRESHOLD", effectiveFrom: "2026-07-01" }) as any).error, /threshold/);
  assert.equal((cleanRate({ line: "OTHER", label: "Long Service Levy", percent: 1, base: "PAID", appliesTo: "ALL", effectiveFrom: "2026-07-01" }) as any).line, "OTHER:long service levy");
  assert.match((cleanRate({ line: "BONUS", percent: 1, effectiveFrom: "2026-07-01" }) as any).error, /Pick the line/);
  assert.match((cleanRate({ line: "SUPER", percent: 10, effectiveFrom: "1/7/2026" }) as any).error, /date/);
});
