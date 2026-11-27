// Variation docket rows as loads (Ilies, 28 Nov 2026: "change the quanitity estimated to just loads.. eg: how many
// loads 1, what is the material type: mixed waste" - "dont delete the current code. just switcht the current set up
// off"). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LIMITS, LOADS, MATERIAL_SUGGESTIONS, itemQty, parseDocket, unitLabel, variationItemMode } from "./rules";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const good = (x: Record<string, unknown> = {}) => ({
  jobId: `cm${"0".repeat(22)}1`, ticks: ["RUBBISH"], otherText: "", tasks: [],
  items: [{ quantity: 1, type: "Mixed waste", comment: "" }], note: "", photoIds: [],
  customerName: "Sam Client", customerPosition: "Site manager", customerSignature: PNG, lobosPosition: "Supervisor", lobosSignature: PNG, ...x,
});
const err = (r: unknown) => (r && typeof r === "object" && "error" in r ? (r as { error: string }).error : null);
const items = (r: unknown) => (r as { items: { quantity: number | null; unit: string; type: string }[] }).items;

test("loads is the default; VARIATION_ITEMS=detailed brings the old rows back", () => {
  assert.equal(variationItemMode({}), "LOADS");
  assert.equal(variationItemMode({ VARIATION_ITEMS: "" }), "LOADS");
  assert.equal(variationItemMode({ VARIATION_ITEMS: " Detailed " }), "DETAILED");
});

test("a load row: how many loads (whole number) + material type", () => {
  const r = parseDocket(good(), "LOADS");
  assert.equal(err(r), null);
  assert.deepEqual(items(r).map((x) => [x.quantity, x.unit, x.type]), [[1, LOADS, "Mixed waste"]]);
  // Whatever unit the phone sends, a load row is saved as LOADS.
  assert.equal(items(parseDocket(good({ items: [{ quantity: "3", unit: "M3", type: "Concrete" }] }), "LOADS"))[0].unit, LOADS);
  assert.match(err(parseDocket(good({ items: [{ quantity: 2.5, type: "Mixed waste" }] }), "LOADS")) ?? "", /whole number/);
  assert.match(err(parseDocket(good({ items: [{ quantity: 0, type: "Mixed waste" }] }), "LOADS")) ?? "", /whole number/);
  assert.match(err(parseDocket(good({ items: [{ type: "Mixed waste" }] }), "LOADS")) ?? "", /how many loads/);
  assert.ok(err(parseDocket(good({ items: [{ quantity: LIMITS.loads + 1, type: "Mixed waste" }] }), "LOADS")));
  assert.match(err(parseDocket(good({ items: [{ quantity: 1, type: "" }] }), "LOADS")) ?? "", /material/);
  assert.ok(err(parseDocket(good({ items: [{ quantity: 1, type: "Skip $380" }] }), "LOADS")), "no amounts in the material");
  assert.ok(err(parseDocket(good({ items: [{ quantity: 1, type: "Mixed waste", comment: "charge AUD 200" }] }), "LOADS")), "...or the comment");
  assert.match(err(parseDocket(good({ items: [] }), "LOADS")) ?? "", /loads taken away/);
});

test("the old rows still work when switched back on", () => {
  const r = parseDocket(good({ items: [{ quantity: 6, unit: "M3", type: "Mixed waste" }] }), "DETAILED");
  assert.deepEqual(items(r).map((x) => [x.quantity, x.unit]), [[6, "M3"]]);
  assert.ok(err(parseDocket(good({ items: [{ quantity: 1, unit: "LOADS", type: "Mixed waste" }] }), "DETAILED")), "detailed keeps its own units");
});

test("how a row reads: 1 load, 3 loads, and old dockets as they were sent", () => {
  assert.equal(itemQty(1, LOADS), "1 load");
  assert.equal(itemQty(3, LOADS), "3 loads");
  assert.equal(itemQty(6, "M3"), "6 m³");
  assert.equal(itemQty(null, LOADS), "");
  assert.equal(unitLabel("EACH"), "each");
  assert.equal(MATERIAL_SUGGESTIONS[0], "Mixed waste");
});

test("the phone screen keeps the old rows in the code, behind the switch", () => {
  const src = readFileSync(path.join(__dirname, "..", "..", "components", "site", "VariationDocket.tsx"), "utf8");
  assert.match(src, /view\.itemMode === "LOADS"/);
  assert.match(src, /How many loads/);
  assert.match(src, /Material type/);
  assert.match(src, /UNITS\.map/, "the old unit picker is still there");
});
