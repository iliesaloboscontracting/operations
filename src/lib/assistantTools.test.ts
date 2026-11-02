// What the Assistant's tools hand the model (lib/assistantTools.ts). PP-006 (3 Nov 2026): the projects list never
// carries the notes or contract value notes - free text that can hold rates and prices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectsForModel, trackingForModel } from "./assistantTools";

test("get_projects: notes and contract value notes are dropped, everything else kept", () => {
  const reply = [
    { id: "p1", name: "Smith St", client: "CD", status: "ACTIVE", contractValue: 120000,
      notes: "Supplier rate agreed $1,234.50 per day", contractValueNotes: "Quote 26_117 $118,000 + variation", counts: { crew: 3 } },
    { id: "p2", name: "Shellharbour", status: "ACTIVE", regional: true, notes: null },
  ];
  const out = projectsForModel(reply) as Record<string, unknown>[];
  assert.equal(out.length, 2);
  for (const p of out) {
    assert.ok(!("notes" in p) && !("contractValueNotes" in p));
  }
  assert.deepEqual(out[0], { id: "p1", name: "Smith St", client: "CD", status: "ACTIVE", contractValue: 120000, counts: { crew: 3 } });
  assert.deepEqual(out[1], { id: "p2", name: "Shellharbour", status: "ACTIVE", regional: true });
  const text = JSON.stringify(out);
  assert.ok(!/\$\s?\d/.test(text) && !text.includes("Supplier rate"));
  // The route's own reply is not changed (the page still needs the notes).
  assert.equal(reply[0].notes, "Supplier rate agreed $1,234.50 per day");
});

test("get_tracking_summary: notes and rates are dropped, totals, contract value and health kept (PP-007)", () => {
  const reply = {
    projects: [{
      id: "p1", name: "Smith St", contractValue: 120000, contractValueNotes: "Quote $118,000", totalCost: 54321.5, forecastCost: 60000, health: "OK",
      invoiced: [{ id: "i1", vendor: "Coates", amountExGst: 2500, notes: "Agreed $410/day" }],
      labour: [{ id: "l1", personName: "Sam", hours: 8, rateTier: "ORD", rateUsed: 48.5, cost: 388, notes: "Rate $48.50 confirmed" }],
      hireLabourEstimate: [{ id: "h1", personName: "Joe", hours: 8, rateUsed: 62, cost: 496 }],
      hireItems: [{ id: "r1", name: "20t excavator", supplier: "Coates", dayRate: 1234.5, daysToDate: 4, costToDate: 4938 }],
    }],
    idleHire: { totalIdleCost: 820, items: [{ id: "r2", name: "Skid steer", idleDays: 2, rateUsed: 410, idleCost: 820 }] },
    attention: [{ level: "WATCH", text: "Smith St at 82% of contract value" }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = trackingForModel(reply) as { projects: any[]; idleHire: unknown; attention: unknown };
  const p = out.projects[0];
  assert.ok(!Object.hasOwn(p, "contractValueNotes"));
  assert.equal(p.contractValue, 120000);
  assert.equal(p.totalCost, 54321.5);
  assert.equal(p.health, "OK");
  assert.deepEqual(p.invoiced[0], { id: "i1", vendor: "Coates", amountExGst: 2500 });
  assert.deepEqual(p.labour[0], { id: "l1", personName: "Sam", hours: 8, rateTier: "ORD", cost: 388 });
  assert.deepEqual(p.hireLabourEstimate[0], { id: "h1", personName: "Joe", hours: 8, cost: 496 });
  assert.deepEqual(p.hireItems[0], { id: "r1", name: "20t excavator", supplier: "Coates", daysToDate: 4, costToDate: 4938 });
  assert.deepEqual(out.idleHire, { totalIdleCost: 820, items: [{ id: "r2", name: "Skid steer", idleDays: 2, idleCost: 820 }] });
  assert.deepEqual(out.attention, reply.attention);
  const text = JSON.stringify(out);
  for (const s of ["118,000", "410", "48.5", "1234.5", "rateUsed", "dayRate", "notes"]) assert.ok(!text.includes(s), s);
  // The route's own reply is not changed (the Tracking page still needs it).
  assert.equal(reply.projects[0].hireItems[0].dayRate, 1234.5);
});

test("get_tracking_summary: an unexpected reply fails closed", () => {
  assert.deepEqual(trackingForModel({ rows: [] }), { error: "Unexpected reply" });
  assert.deepEqual(trackingForModel(null), { error: "Unexpected reply" });
  assert.deepEqual(trackingForModel([]), { error: "Unexpected reply" });
});

test("get_projects: anything that isn't a list passes through untouched", () => {
  const err = { error: "Forbidden" };
  assert.equal(projectsForModel(err), err);
  assert.equal(projectsForModel(null), null);
});
