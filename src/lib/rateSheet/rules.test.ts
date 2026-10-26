// Agreed rates (Accounts stage 4) - units, suppliers, line -> rate matching, the 2% flag. Made-up rates. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRate, isRateSheet, lineKey, matchLine, normUnit, parseLines, supplierKey, validOn, type SheetRate } from "./rules";

const R = (x: Partial<SheetRate>): SheetRate => ({ id: "r1", supplier: "Acme Hire", item: "5T Excavator", category: "Plant", unit: "day", rateExGst: 100, validFrom: "2026-01-01", validTo: null, ...x });
const RATES = [R({}), R({ id: "r2", item: "1.7T Excavator", rateExGst: 80 }), R({ id: "r3", item: "5T Excavator", unit: "wk", rateExGst: 450 }), R({ id: "r4", supplier: "Other Hire", item: "5T Excavator" })];

test("units and supplier names are normalised", () => {
  assert.deepEqual(["Days", "per week", "hrs", "Tonnes", "ea", "m3", "lm", ""].map(normUnit), ["day", "wk", "hr", "t", "each", "m³", "m", null]);
  assert.equal(supplierKey("A.C.M.E. Hire Pty Ltd"), "acme hire");
  assert.equal(supplierKey("Acme Hire"), "acme hire");
  assert.equal(lineKey("5T  Excavator - (Hire)"), "5t excavator hire");
});

test("a line matches the same supplier's rate with the same unit and the best words", () => {
  const m = matchLine({ description: "Hire of 5T excavator", quantity: 5, unit: "days", unitPriceExGst: 110 }, "ACME Hire Pty Ltd", RATES, new Map());
  assert.deepEqual(m.how !== "NONE" && [m.how, m.rate.id], ["SUGGESTED", "r1"]);
  const wk = matchLine({ description: "5T excavator", quantity: 1, unit: "week", unitPriceExGst: 450 }, "Acme Hire", RATES, new Map());
  assert.equal(wk.how !== "NONE" && wk.rate.id, "r3", "weekly line -> weekly rate");
});

test("no match: another supplier, no rate in that unit, or no clear winner -> pick the rate", () => {
  assert.deepEqual(matchLine({ description: "5T excavator", quantity: 1, unit: "day", unitPriceExGst: 1 }, "Nobody Pty Ltd", RATES, new Map()), { how: "NONE", reason: "No rates for this supplier in Estimating", candidates: [] });
  const t = matchLine({ description: "5T excavator", quantity: 1, unit: "tonne", unitPriceExGst: 1 }, "Acme Hire", RATES, new Map());
  assert.equal(t.how === "NONE" && t.reason, "No t rate for this supplier");
  const vague = matchLine({ description: "Excavator", quantity: 1, unit: "day", unitPriceExGst: 1 }, "Acme Hire", RATES, new Map());
  assert.equal(vague.how, "NONE", "5T and 1.7T both score the same");
  assert.equal(vague.how === "NONE" && vague.candidates.length, 2);
});

test("a remembered link wins over the words", () => {
  const links = new Map([["acme hire|excavator", "r2"]]);
  const m = matchLine({ description: "Excavator", quantity: 1, unit: "day", unitPriceExGst: 1 }, "Acme Hire", RATES, links);
  assert.deepEqual(m.how !== "NONE" && [m.how, m.rate.id], ["LINKED", "r2"]);
});

test("over the agreed rate by more than 2%; difference per unit and in total; validity", () => {
  assert.deepEqual(checkRate({ description: "x", quantity: 5, unit: "day", unitPriceExGst: 110 }, R({}), "2026-10-20"), { over: true, diffPerUnit: 10, diffTotal: 50, outsideValidity: false });
  assert.equal(checkRate({ description: "x", quantity: 5, unit: "day", unitPriceExGst: 102 }, R({}), "2026-10-20")!.over, false, "within 2%");
  assert.equal(checkRate({ description: "x", quantity: null, unit: "day", unitPriceExGst: 99 }, R({}), "2026-10-20")!.diffTotal, null);
  assert.equal(checkRate({ description: "x", quantity: 1, unit: "day", unitPriceExGst: null }, R({}), "2026-10-20"), null);
  assert.equal(checkRate({ description: "x", quantity: 1, unit: "day", unitPriceExGst: 100 }, R({ validTo: "2026-06-30" }), "2026-10-20")!.outsideValidity, true);
  assert.equal(validOn(R({ validFrom: null, validTo: null }), "2020-01-01"), true);
});

test("stored lines are read safely; only the agreed contract shape is accepted", () => {
  assert.deepEqual(parseLines('[{"description":"5T excavator","quantity":5,"unit":"day","unitPriceExGst":110},{"description":""},{"x":1}]'), [{ description: "5T excavator", quantity: 5, unit: "day", unitPriceExGst: 110 }]);
  assert.deepEqual(parseLines("nope"), []);
  assert.equal(isRateSheet({ schema_version: "rate-sheet.v1", version: "1", rates: [R({})] }), true);
  assert.equal(isRateSheet({ schema_version: "rate-sheet.v2", version: "1", rates: [] }), false);
  assert.equal(isRateSheet({ schema_version: "rate-sheet.v1", version: "1", rates: [{ id: "x" }] }), false);
});
