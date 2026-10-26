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
