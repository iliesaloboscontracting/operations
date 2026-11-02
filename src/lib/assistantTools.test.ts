// What the Assistant's tools hand the model (lib/assistantTools.ts). PP-006 (3 Nov 2026): the projects list never
// carries the notes or contract value notes - free text that can hold rates and prices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectsForModel } from "./assistantTools";

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

test("get_projects: anything that isn't a list passes through untouched", () => {
  const err = { error: "Forbidden" };
  assert.equal(projectsForModel(err), err);
  assert.equal(projectsForModel(null), null);
});
