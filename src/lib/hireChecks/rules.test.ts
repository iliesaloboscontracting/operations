// Hire invoices vs the register (Accounts stage 4). Made-up rates. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHireInvoices, type HireInvoice, type HireItem } from "./rules";

// Mon 5 Oct - Fri 16 Oct 2026 on hire, $100 a day (made up), $50 delivery + $50 pick-up.
const ITEM: HireItem = { id: "h1", name: "5T Excavator", onHireDate: "2026-10-05", offHireDate: "2026-10-16", hireRate: 100, hireRateUnit: "DAY", hireDeliveryCost: 50, hireCollectionCost: 50 };
const I = (x: Partial<HireInvoice>): HireInvoice => ({ id: "i1", invoiceNo: "A1", vendor: "Hire Co", periodFrom: "2026-10-05", periodTo: "2026-10-09", amountExGst: 500, ...x });
const kinds = (f: { kind: string }[]) => f.map((x) => x.kind);

test("a clean invoice inside the period, at the register's rate, raises nothing (delivery allowed for)", () => {
  assert.deepEqual(checkHireInvoices(ITEM, [I({}), I({ id: "i2", invoiceNo: "A2", periodFrom: "2026-10-12", periodTo: "2026-10-16", amountExGst: 600 })], "2026-10-27"), []);
});

test("days outside the on-hire period: before the start and after the finish (weekdays only)", () => {
  const f = checkHireInvoices(ITEM, [I({ periodFrom: "2026-10-01", periodTo: "2026-10-09", amountExGst: 700 })], "2026-10-27");
  assert.deepEqual(kinds(f), ["OUTSIDE_PERIOD"]);
  assert.match(f[0].text, /2 weekday/); // Thu 1, Fri 2 Oct
  const after = checkHireInvoices(ITEM, [I({ periodFrom: "2026-10-12", periodTo: "2026-10-20", amountExGst: 500 })], "2026-10-27");
  assert.match(after[0].text, /2 weekday/); // Mon 19, Tue 20
  assert.deepEqual(kinds(checkHireInvoices(ITEM, [I({ periodFrom: "2026-10-03", periodTo: "2026-10-09" })], "2026-10-27")), [], "a weekend before the start isn't a billed weekday");
});

test("still on hire: the window runs to today", () => {
  const open = { ...ITEM, offHireDate: null };
  assert.deepEqual(checkHireInvoices(open, [I({ periodFrom: "2026-10-19", periodTo: "2026-10-23" })], "2026-10-27"), []);
  assert.deepEqual(kinds(checkHireInvoices(open, [I({ periodFrom: "2026-10-26", periodTo: "2026-10-30" })], "2026-10-27")), ["OUTSIDE_PERIOD"], "billed ahead of today");
});

test("more days than the register shows, worked out from the amount and the item's own rate", () => {
  const f = checkHireInvoices(ITEM, [I({ amountExGst: 800 })], "2026-10-27"); // (800-100)/100 = 7 days vs 5
  assert.deepEqual(kinds(f), ["MORE_DAYS"]);
  assert.match(f[0].text, /about 7 days/);
  assert.deepEqual(checkHireInvoices(ITEM, [I({ amountExGst: 640 })], "2026-10-27"), [], "within half a day");
  assert.deepEqual(checkHireInvoices({ ...ITEM, hireRate: null, dailyRateExGst: null }, [I({ amountExGst: 99999 })], "2026-10-27"), [], "no rate on the item: not checked");
  const weekly = checkHireInvoices({ ...ITEM, hireRate: 500, hireRateUnit: "WEEK" }, [I({ amountExGst: 600 })], "2026-10-27");
  assert.deepEqual(weekly, [], "a weekly rate is 5 days");
});

test("the same weekdays billed twice flags both invoices; a shared weekend doesn't", () => {
  const f = checkHireInvoices(ITEM, [I({}), I({ id: "i2", invoiceNo: "A2", periodFrom: "2026-10-08", periodTo: "2026-10-14", amountExGst: 500 })], "2026-10-27");
  assert.deepEqual(f.filter((x) => x.kind === "BILLED_TWICE").map((x) => x.invoiceId).sort(), ["i1", "i2"]);
  assert.match(f.find((x) => x.kind === "BILLED_TWICE")!.text, /2 weekday/); // Thu 8, Fri 9
  assert.deepEqual(checkHireInvoices(ITEM, [I({ periodFrom: "2026-10-05", periodTo: "2026-10-11" }), I({ id: "i2", periodFrom: "2026-10-11", periodTo: "2026-10-16", amountExGst: 500 })], "2026-10-27").filter((x) => x.kind === "BILLED_TWICE"), []);
});

test("a linked invoice with no period", () => {
  assert.deepEqual(kinds(checkHireInvoices(ITEM, [I({ periodFrom: null, periodTo: null })], "2026-10-27")), ["NO_PERIOD"]);
});
