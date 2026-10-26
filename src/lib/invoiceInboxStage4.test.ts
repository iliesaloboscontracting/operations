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
  // First name only: a person decides - it is never silently taken off job cost.
  const first = await decide(raw, new Set(), new Set(), new Set(["p1"]), people);
  assert.equal(first.status, "NEEDS_REVIEW");
  assert.match(first.problem!, /Could be Cem's own invoice/);
  assert.equal(first.abnResourceId, undefined);
  // The recorded ABN (stage 5 onboarding) on the invoice: not counted, checked on Accounts.
  const byAbn = await decide({ ...raw, supplierAbn: "51824753556" }, new Set(), new Set(), new Set(["p1"]), [{ ...people[0], abn: "51 824 753 556" }]);
  assert.deepEqual([byAbn.status, byAbn.abnResourceId], ["SKIPPED", "r1"]);
  assert.match(byAbn.problem!, /ABN worker's invoice/);
  // The full two-word name.
  const full = await decide(raw, new Set(), new Set(), new Set(["p1"]), [{ id: "r3", name: "Cem Dogay", engagement: "ABN", active: true }]);
  assert.deepEqual([full.status, full.abnResourceId], ["SKIPPED", "r3"]);
  // No ABN worker named: the ordinary rules carry on (here: a clear job match is added).
  const none = await decide({ ...raw, supplier: "Max Hire" }, new Set(), new Set(), new Set(["p1"]), people);
  assert.equal(none.status, "ADDED");
});
