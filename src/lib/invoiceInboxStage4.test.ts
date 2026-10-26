// Invoices inbox, Accounts stage 4: what the reader found for ABN hours and line prices, cleaned for storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stage4Fields } from "./invoiceInbox";

test("ABN, days, total hours and lines are cleaned; empty ones stored as nothing", () => {
  const f = stage4Fields({
    supplierAbn: " 51 824 753 556 ",
    workDays: [{ date: "2026-10-19", hours: "8" }, { date: "19/10/2026", hours: "7.5" }, { date: "", hours: "4" }, { date: "2026-10-21", hours: "" }],
    hoursTotal: "15.5",
    lines: [{ description: "5T excavator", quantity: "5", unit: "day", unitPriceExGst: "$1,100.00" }, { description: "", quantity: "1", unit: "", unitPriceExGst: "1" }],
  });
  assert.equal(f.supplierAbn, "51824753556");
  assert.deepEqual(JSON.parse(f.workDays!), [{ date: "2026-10-19", hours: 8 }, { date: "2026-10-19", hours: 7.5 }]);
  assert.equal(f.hoursTotal, 15.5);
  assert.deepEqual(JSON.parse(f.lines!), [{ description: "5T excavator", quantity: 5, unit: "day", unitPriceExGst: 1100 }]);
  assert.deepEqual(stage4Fields({}), { supplierAbn: null, workDays: null, hoursTotal: null, lines: null });
});

test("the inbox rules: an ABN worker's own invoice isn't counted on a job; two possible people wait for a person", async () => {
  const { decide } = await import("./invoiceInbox");
  const raw = {
    supplier: "Cem Dogay", entityBilled: "Lobos Contracting", invoiceNo: "12", invoiceDate: "2026-10-26", periodFrom: "2026-10-19", periodTo: "2026-10-25",
    description: "Labour", siteText: null, hireRef: null, amountExGst: 100, gst: 10, totalIncGst: 110, category: "LABOUR_HIRE", projectId: "p1", confidence: "HIGH" as const, matchReason: null,
  };
  const people = [{ id: "r1", name: "Cem", engagement: "ABN", active: true }];
  const v = await decide(raw, new Set(), new Set(), new Set(["p1"]), people);
  assert.equal(v.status, "SKIPPED");
  assert.equal(v.abnResourceId, "r1");
  assert.match(v.problem!, /ABN worker's invoice/);
  const two = await decide(raw, new Set(), new Set(), new Set(["p1"]), [...people, { id: "r2", name: "Dogay", engagement: "ABN", active: true }]);
  assert.equal(two.status, "NEEDS_REVIEW");
  const dup = await decide(raw, new Set(), new Set(["cem dogay|12"]), new Set(["p1"]), people);
  assert.equal(dup.status === "DUPLICATE" || dup.status === "SKIPPED", true, "an invoice already entered is still caught first");
});
