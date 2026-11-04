// Consumables inventory (Yard Stage C, Ilies 4 Nov 2026): the balance maths, counts, never below zero, below minimum
// and its one alert, the yard job's stock lines, the purchase prefill, and no money anywhere. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CATEGORIES, NO_AMOUNTS, belowMinStep, belowZeroError, fmtQty, itemFields, parseQty, planMovement, purchasePrefill, stockLines, stockStatus,
} from "./rules";

test("quantities: numbers only, 0..1,000,000, three decimals kept", () => {
  assert.equal(parseQty("3"), 3);
  assert.equal(parseQty(2.5), 2.5);
  assert.equal(parseQty("0.1234"), 0.123);
  assert.equal(parseQty("0"), null); // stock in / out needs something
  assert.equal(parseQty("0", false), 0); // a count can be 0
  for (const bad of ["-1", "abc", "", null, undefined, "1e9", NaN, Infinity]) assert.equal(parseQty(bad), null, String(bad));
});

test("stock in adds, stock out takes away, a count sets the shelf (the change is the difference)", () => {
  assert.deepEqual(planMovement(4, "box", "IN", "6"), { change: 6, balanceAfter: 10, countedQty: null });
  assert.deepEqual(planMovement(10, "box", "OUT", 3), { change: -3, balanceAfter: 7, countedQty: null });
  assert.deepEqual(planMovement(10, "box", "COUNT", "7"), { change: -3, balanceAfter: 7, countedQty: 7 });
  assert.deepEqual(planMovement(10, "box", "COUNT", "12"), { change: 2, balanceAfter: 12, countedQty: 12 });
  assert.deepEqual(planMovement(10, "box", "COUNT", "10"), { change: 0, balanceAfter: 10, countedQty: 10 }); // counted, unchanged
  assert.deepEqual(planMovement(0.3, "litre", "IN", "0.1"), { change: 0.1, balanceAfter: 0.4, countedQty: null }); // no 0.30000000000000004
  assert.ok("error" in planMovement(1, "box", "MOVE", 1));
});

test("never below zero: 'Count it first - the shelf says N'", () => {
  const out = planMovement(2, "box", "OUT", 3);
  assert.deepEqual(out, { error: "Count it first - the shelf says 2 box." });
  assert.equal(belowZeroError(0.5, "roll"), "Count it first - the shelf says 0.5 roll.");
  assert.deepEqual(planMovement(2, "box", "OUT", 2), { change: -2, balanceAfter: 0, countedQty: null }); // to exactly zero is fine
});

test("below minimum: strictly under it; no minimum = not set (never guessed)", () => {
  assert.equal(stockStatus({ onHand: 4, minLevel: 5 }), "BELOW");
  assert.equal(stockStatus({ onHand: 5, minLevel: 5 }), "OK");
  assert.equal(stockStatus({ onHand: 0, minLevel: null }), "NOT_SET");
  assert.equal(stockStatus({ onHand: 0, minLevel: 0 }), "OK");
});

test("the below-minimum alert goes once, and again only after it was back at or above the minimum", () => {
  const i = { onHand: 2, minLevel: 5, active: true, belowMinAlertedAt: null as Date | null };
  assert.deepEqual(belowMinStep(i), { alert: true, clear: false }); // first drop
  const alerted = { ...i, belowMinAlertedAt: new Date() };
  assert.deepEqual(belowMinStep(alerted), { alert: false, clear: false }); // still low - no second alert
  assert.deepEqual(belowMinStep({ ...alerted, onHand: 5 }), { alert: false, clear: true }); // back to the minimum - cleared
  assert.deepEqual(belowMinStep({ ...i, onHand: 5 }), { alert: false, clear: false });
  assert.deepEqual(belowMinStep({ ...i, active: false }), { alert: false, clear: false }); // retired items never alert
  assert.deepEqual(belowMinStep({ ...alerted, active: false }), { alert: false, clear: true });
  assert.deepEqual(belowMinStep({ ...i, minLevel: null }), { alert: false, clear: false });
});

test("purchase prefill: back to twice the minimum, whole units, the item's name - no price", () => {
  assert.deepEqual(purchasePrefill({ name: "P2 masks", unit: "box", onHand: 3, minLevel: 10 }), { kind: "PURCHASE", what: "P2 masks", qty: "17 box", why: "Stock below minimum - P2 masks" });
  assert.equal(purchasePrefill({ name: "Tape", unit: "roll", onHand: 0.5, minLevel: 2 })!.qty, "4 roll"); // 3.5 -> 4
  assert.equal(purchasePrefill({ name: "Gloves", unit: "pair", onHand: 25, minLevel: 10 })!.qty, "1 pair"); // at least 1
  assert.equal(purchasePrefill({ name: "Blades", unit: "each", onHand: 1, minLevel: null }), null); // no minimum - nothing to suggest
  assert.ok(!/\$\s?\d/.test(JSON.stringify(purchasePrefill({ name: "P2 masks", unit: "box", onHand: 3, minLevel: 10 }))));
});

test("an item: name, category, unit, minimum (blank = not set), location; text with a dollar figure refused", () => {
  const ok = itemFields({ name: "  Rubble bags  ", category: "CONSUMABLES", unit: "bag", minLevel: "", location: "Shelf B2" });
  assert.deepEqual(ok, { data: { name: "Rubble bags", category: "CONSUMABLES", unit: "bag", minLevel: null, location: "Shelf B2" } });
  assert.deepEqual(itemFields({ name: "Hi-vis vest", category: "PPE" }), { data: { name: "Hi-vis vest", category: "PPE", unit: "each", minLevel: null, location: null } });
  assert.ok("error" in itemFields({ name: "x" }));
  assert.ok("error" in itemFields({ name: "Gloves", category: "FOOD" }));
  assert.ok("error" in itemFields({ name: "Gloves", minLevel: "-2" }));
  for (const body of [{ name: "Gloves $4 a pair" }, { name: "Gloves", location: "Shelf $5" }, { name: "Gloves", unit: "$10 box" }])
    assert.deepEqual(itemFields(body), { error: NO_AMOUNTS }, JSON.stringify(body));
  // An edit only checks what was sent.
  assert.deepEqual(itemFields({ minLevel: 4 }, true), { data: { minLevel: 4 } });
  assert.deepEqual([...CATEGORIES], ["CONSUMABLES", "PPE", "MATERIALS", "OTHER"]);
});

test("a yard job's 'Took from stock' lines: item + positive quantity, the same item added together, at most 20", () => {
  assert.deepEqual(stockLines(undefined), { lines: [] });
  assert.deepEqual(stockLines([{ itemId: "a", qty: "2" }, { itemId: "b", qty: 1 }, { itemId: "a", qty: 0.5 }]), { lines: [{ itemId: "a", qty: 2.5 }, { itemId: "b", qty: 1 }] });
  for (const bad of ["x", [{ itemId: "a" }], [{ itemId: "", qty: 1 }], [{ itemId: "a", qty: -1 }], [{ itemId: "a", qty: 0 }]]) assert.ok("error" in stockLines(bad), JSON.stringify(bad));
  assert.ok("error" in stockLines(Array.from({ length: 21 }, (_, i) => ({ itemId: `i${i}`, qty: 1 }))));
  assert.equal(fmtQty(2.5), "2.5");
});

test("no money: the schema has no price, rate or cost field on either table", () => {
  const schema = readFileSync(path.join(__dirname, "../../../prisma/schema.prisma"), "utf8");
  for (const model of ["InventoryItem", "StockMovement"]) {
    const body = schema.slice(schema.indexOf(`model ${model} {`), schema.indexOf("}", schema.indexOf(`model ${model} {`)));
    assert.ok(body.length > 20, model);
    const fields = body.split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter((f) => f && !f.startsWith("//") && !f.startsWith("@@"));
    for (const f of fields) assert.ok(!/price|rate|cost|amount|value|gst/i.test(f), `${model}.${f}`);
  }
});

test("the shared yard phone link never takes stock; /api/yard passes the lines through to READY", () => {
  const link = readFileSync(path.join(__dirname, "../../app/api/site/[token]/yard/[id]/route.ts"), "utf8");
  assert.match(link, /Taking from stock is done on the yard computer/);
  assert.doesNotMatch(link, /stock: /);
  const inApp = readFileSync(path.join(__dirname, "../../app/api/yard/[id]/route.ts"), "utf8");
  assert.match(inApp, /stock: lines\.lines/);
});

test("CI-004: an edit records one row per field that really changed; the edit table is append-only", async () => {
  const { itemEdits } = await import("./rules");
  const before = { name: "P2 masks", category: "PPE", unit: "box", minLevel: 5, location: null, active: true };
  assert.deepEqual(itemEdits(before, { name: "P2 masks", unit: "box", minLevel: 8, location: "Shelf B2" }), [
    { field: "minLevel", before: "5", after: "8" }, { field: "location", before: null, after: "Shelf B2" },
  ]);
  assert.deepEqual(itemEdits(before, { active: false }), [{ field: "active", before: "true", after: "false" }]);
  assert.deepEqual(itemEdits(before, { location: "" }), [], "blank stays blank");
  assert.deepEqual(itemEdits(before, {}), []);
  // Nothing in the app updates or deletes an edit row.
  const walk = (d: string): string[] => require("node:fs").readdirSync(d, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const f of walk(path.join(__dirname, "../.."))) assert.doesNotMatch(readFileSync(f, "utf8"), /inventoryItemEdit\.(update|updateMany|delete|deleteMany|upsert)\(/, f);
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /await prisma\.\$transaction\(async \(tx\) => \{\s*await tx\.inventoryItem\.update\(\{ where: \{ id \}, data \}\);\s*for \(const e of edits\) await tx\.inventoryItemEdit\.create/, "written in the same transaction as the change");
});

test("CI-006: the raw stock list is capped first (even 21 copies of one item), and a long item id is refused", () => {
  assert.ok("error" in stockLines(Array.from({ length: 21 }, () => ({ itemId: "same", qty: 1 }))), "21 lines of one item - refused before merging");
  assert.ok("lines" in stockLines(Array.from({ length: 20 }, () => ({ itemId: "same", qty: 1 }))));
  assert.ok("error" in stockLines([{ itemId: "x".repeat(41), qty: 1 }]));
  assert.ok("lines" in stockLines([{ itemId: "x".repeat(40), qty: 1 }]));
});

test("CI-005: retire / bring back takes true or false only", () => {
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /if \(typeof body\.active !== "boolean"\) return \{ error: "active is true or false", status: 400 \};/);
  assert.doesNotMatch(store, /Boolean\(body\.active\)/);
});

test("CI-002: the below-minimum mark is set / cleared only while the item is as it was read", () => {
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /const asRead = \{ id: i\.id, onHand: i\.onHand, minLevel: i\.minLevel, active: i\.active \};/);
  assert.match(store, /where: \{ \.\.\.asRead, belowMinAlertedAt: \{ not: null \} \}, data: \{ belowMinAlertedAt: null \}/);
  assert.match(store, /where: \{ \.\.\.asRead, active: true, belowMinAlertedAt: null \}, data: \{ belowMinAlertedAt: new Date\(\) \}/);
  assert.match(store, /if \(!count\) continue;/, "no alert when nothing matched");
});
