// "Fill my log from this" (29 Oct 2026): what of Claude's suggested activity hours, plant hours and tip runs is kept,
// what goes to "Check this", and filling the phone's log without ever overwriting what's there. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoMoney } from "../moneyGuard";
import { ACTIVITY_MAX, PLANT_MAX, mergeFill, validateFill } from "./fill";
import { cleanContext, stripMoney, validateCleaned } from "./voiceRules";

const noMoney = (s: string) => stripMoney(s).text;
const ctx = { codes: ["STR-02", "DEM-10", "GEN-03"], plantCount: 2, signedHours: 22.5, docketsSent: 2 };

test("the validator keeps only codes from the list, machines by a valid number, and hours in range", () => {
  const { fill } = validateFill({
    activity: [
      { code: "STR-02", hours: 22.5 }, { code: "XXX-99", hours: 4 }, { code: "GEN-03", hours: 0 }, { code: "DEM-10", hours: ACTIVITY_MAX + 1 },
      { code: "STR-02", hours: "3" }, { code: "GEN-03", hours: -2 },
    ],
    plant: [
      { plant: 1, code: "DEM-10", hours: 6.1 }, { plant: 3, code: null, hours: 4 }, { plant: 0, code: null, hours: 4 }, { plant: 1.5, code: null, hours: 4 },
      { plant: 2, code: "NOPE-1", hours: PLANT_MAX + 1 }, { plant: 2, code: "NOPE-1", hours: 8 }, { plant: 2, code: null, hours: 3 },
    ],
    tipRuns: 4,
  }, ctx, noMoney);
  assert.deepEqual(fill.activity, [{ code: "STR-02", hours: 22.5 }], "a bad code, 0 h, over 500 h, text hours and negatives are dropped");
  assert.deepEqual(fill.plant, [{ index: 1, code: "DEM-10", hours: 6 }, { index: 2, code: null, hours: 8 }], "numbers 0 / 3 / 1.5 dropped; over 24 h dropped; an unknown code becomes none; one entry per machine");
  assert.equal(fill.tipRuns, 4);
  assert.equal(validateFill({ tipRuns: 2.5 }, ctx, noMoney).fill.tipRuns, null);
  assert.equal(validateFill({ tipRuns: -1 }, ctx, noMoney).fill.tipRuns, null);
  assert.deepEqual(validateFill({ activity: [{ code: "STR-02", hours: 8 }] }, undefined, noMoney).fill, { activity: [], plant: [], tipRuns: null }, "no fill context, no fill");
});

test("activity hours are the crew's total on a code - over 24 is fine (3 guys all day), as the log keeps them", () => {
  const { fill, checks } = validateFill({ activity: [{ code: "STR-02", hours: 32 }] }, { ...ctx, signedHours: 32 }, noMoney);
  assert.deepEqual(fill.activity, [{ code: "STR-02", hours: 32 }]);
  assert.deepEqual(checks, []);
});

test("signed hours: a total that doesn't match (outside 0.5 h) goes to Check this - the numbers aren't touched", () => {
  const one = validateFill({ activity: [{ code: "STR-02", hours: 24 }] }, ctx, noMoney);
  assert.deepEqual(one.fill.activity, [{ code: "STR-02", hours: 24 }], "not adjusted");
  assert.match(one.checks[0], /You said 24 h on .+; the crew signed 22.5 h\./);
  const two = validateFill({ activity: [{ code: "STR-02", hours: 10 }, { code: "DEM-10", hours: 6 }] }, ctx, noMoney);
  assert.equal(two.checks[0], "You said 16 h in total; the crew signed 22.5 h.");
  assert.deepEqual(validateFill({ activity: [{ code: "STR-02", hours: 22.75 }] }, ctx, noMoney).checks, [], "within 0.5 h is fine");
});

test("tip runs: more said than dockets sent today goes to Check this; dockets aren't created", () => {
  assert.deepEqual(validateFill({ tipRuns: 4 }, ctx, noMoney).checks, ["You said 4 tip runs - 2 dockets sent so far."]);
  assert.deepEqual(validateFill({ tipRuns: 1 }, { ...ctx, docketsSent: 0 }, noMoney).checks, ["You said 1 tip run - 0 dockets sent so far."]);
  assert.deepEqual(validateFill({ tipRuns: 2 }, ctx, noMoney).checks, []);
});

test("through the clean-up: the fill rides along, its checks come first in Check this, no money anywhere", () => {
  const c = validateCleaned({
    sections: [{ heading: "Work done", text: "Strip-out all day. Paid $200 for parking." }], delays: [], checkThis: ["Was it level 2?"],
    activity: [{ code: "STR-02", hours: 24 }], plant: [{ plant: 1, code: null, hours: 5 }], tipRuns: 4,
  }, false, ctx);
  assert.deepEqual(c.fill.activity, [{ code: "STR-02", hours: 24 }]);
  assert.equal(c.checkThis.length, 3);
  assert.match(c.checkThis[0], /crew signed/);
  assert.match(c.checkThis[1], /tip runs/);
  assert.equal(c.checkThis[2], "Was it level 2?");
  assert.ok(assertNoMoney(JSON.stringify(c)), JSON.stringify(c));
});

test("machine and crew names Claude gets are cleaned and numbered in board order (never an id); a $ in a name never gets through", () => {
  const cc = cleanContext({ site: "Lido", crew: ["Sam"], plant: ["Kobelco"], plantList: ["Kobelco SK135 - $850 per day", "8t tipper", "$90 bin"], crewHours: [{ name: "Joao ($45/h)", hours: 7.5 }], signedHours: 7.5 });
  assert.deepEqual(cc.plantList, ["Kobelco SK135", "8t tipper", "bin"], "numbered 1..3 in board order, amounts out");
  assert.deepEqual(cc.crewHours, [{ name: "Joao", hours: 7.5 }]);
  assert.ok(assertNoMoney(JSON.stringify(cc)));
});

test("filling the phone's log: new codes and empty machines are filled; anything already there is kept and offered, never overwritten", () => {
  const label = (c: string) => ({ "STR-02": "Ceiling removal", "DEM-10": "Waste load-out" } as Record<string, string>)[c] ?? c;
  const current = { rows: [{ code: "STR-02", hours: 8 }], plant: [{ resourceId: "r1", code: "", hours: 7.5 }, { resourceId: "r2", code: "DEM-10", hours: 4 }] };
  const m = mergeFill(current, {
    activity: [{ code: "STR-02", hours: 10 }, { code: "DEM-10", hours: 12.5 }],
    plant: [{ resourceId: "r1", name: "Kobelco", code: "DEM-10", hours: 6 }, { resourceId: "r2", name: "Tipper", code: "DEM-10", hours: 7 }, { resourceId: "r9", name: "Not on the board", code: null, hours: 3 }],
  }, label);
  assert.deepEqual(m.rows, [{ code: "STR-02", hours: 8 }, { code: "DEM-10", hours: 12.5 }], "typed STR-02 stays 8 h; DEM-10 added");
  assert.deepEqual(m.plant, [{ resourceId: "r1", code: "DEM-10", hours: 6 }, { resourceId: "r2", code: "DEM-10", hours: 4 }], "the empty machine filled; the one with a code kept; an unknown machine ignored");
  assert.deepEqual(m.added, ["Waste load-out 12.5 h", "Kobelco 6 h"]);
  assert.deepEqual(m.kept.map((k) => [k.what, k.key, k.yours, k.suggested]), [["code", "STR-02", 8, 10], ["plant", "r2", 4, 7]], "offered to accept with a tap");
  assert.deepEqual(current.rows, [{ code: "STR-02", hours: 8 }], "the input isn't changed");
  // A second recording adds up the same way: the first fill is now 'already there'.
  const again = mergeFill({ rows: m.rows, plant: m.plant }, { activity: [{ code: "DEM-10", hours: 12.5 }, { code: "GEN-03", hours: 2 }], plant: [] }, label);
  assert.deepEqual(again.rows.map((r) => r.code), ["STR-02", "DEM-10", "GEN-03"]);
  assert.deepEqual(again.kept, [], "the same number again isn't offered");
});
