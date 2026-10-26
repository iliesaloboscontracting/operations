// Reimbursements (Accounts stage 3) - no double claims, what a claim needs, a receipt's amount. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanClaim, duplicatesOf, normRef, receiptAmount, type ClaimKey } from "./rules";

const C = (x: Partial<ClaimKey> = {}): ClaimKey => ({ id: "c1", amountIncGst: 84.5, spentOn: "2026-10-20", resourceId: "r1", personName: "Sam", status: "TO_PAY", ...x });

test("receipt numbers: spaces, case, punctuation and leading zeros don't matter", () => {
  assert.equal(normRef("INV-00123"), normRef("inv 123"));
  assert.equal(normRef("00123"), normRef("123"));
  assert.notEqual(normRef("A123"), normRef("B123"));
  assert.equal(normRef("  "), null);
  assert.equal(normRef(null), null);
});

test("the same receipt, the same photo, or the same number + amount + date is refused", () => {
  assert.deepEqual(duplicatesOf(C({ id: undefined, receiptId: "rc1" }), [C({ receiptId: "rc1", amountIncGst: 1 })]).map((h) => [h.blocking, h.why]), [[true, "the same receipt is already claimed"]]);
  assert.equal(duplicatesOf(C({ id: undefined, photoHash: "abc", resourceId: "r2", spentOn: "2026-10-01" }), [C({ photoHash: "abc" })])[0].blocking, true, "same photo, even claimed for someone else on another date");
  const hit = duplicatesOf(C({ id: undefined, refNo: "inv-0042", resourceId: "r9", personName: "Other" }), [C({ refNo: "INV42" })]);
  assert.deepEqual(hit.map((h) => [h.blocking, h.why]), [[true, "same receipt number, amount and date"]]);
});

test("a different amount, date or number is a different receipt", () => {
  assert.deepEqual(duplicatesOf(C({ id: undefined, refNo: "42", amountIncGst: 84.51 }), [C({ refNo: "42" })]), []);
  assert.deepEqual(duplicatesOf(C({ id: undefined, refNo: "42", spentOn: "2026-10-21" }), [C({ refNo: "42" })]), []);
  assert.deepEqual(duplicatesOf(C({ id: undefined, refNo: "43" }), [C({ refNo: "42" })]), [], "two receipts for the same amount the same day, numbers differ");
});

test("same person + amount + date with no number to tell them apart is a warning, not a block", () => {
  const hits = duplicatesOf(C({ id: undefined }), [C()]);
  assert.deepEqual(hits.map((h) => h.blocking), [false]);
  assert.deepEqual(duplicatesOf(C({ id: undefined, refNo: "7" }), [C()]).map((h) => h.blocking), [false], "one of them has no number");
  assert.deepEqual(duplicatesOf(C({ id: undefined, resourceId: "r2", personName: "Alex" }), [C()]), [], "someone else");
  assert.deepEqual(duplicatesOf(C({ id: undefined, resourceId: null, personName: " sam " }), [C({ resourceId: null })]).length, 1, "no register record: matched by name");
});

test("cancelled claims don't count, and a claim never matches itself", () => {
  assert.deepEqual(duplicatesOf(C({ id: undefined, receiptId: "rc1" }), [C({ receiptId: "rc1", status: "CANCELLED" })]), []);
  assert.deepEqual(duplicatesOf(C({ receiptId: "rc1" }), [C({ receiptId: "rc1" })]), []);
  assert.equal(duplicatesOf(C({ id: undefined, receiptId: "rc1" }), [C({ receiptId: "rc1", status: "PAID" })]).length, 1, "a paid claim still counts");
});

test("what a claim entered by accounts needs", () => {
  const ok = cleanClaim({ description: " Bunnings  - gloves ", amountIncGst: "$1,234.567", spentOn: "2026-10-20", refNo: " 99 " }, "2026-10-27");
  assert.deepEqual(ok, { personName: "", description: "Bunnings - gloves", amountIncGst: 1234.57, spentOn: "2026-10-20", supplier: null, refNo: "99" });
  assert.match((cleanClaim({ description: "x", amountIncGst: 5, spentOn: "2026-10-20" }, "2026-10-27") as any).error, /what it was for/);
  assert.match((cleanClaim({ description: "Gloves", amountIncGst: 0, spentOn: "2026-10-20" }, "2026-10-27") as any).error, /amount/);
  assert.match((cleanClaim({ description: "Gloves", amountIncGst: 5, spentOn: "2026-10-28" }, "2026-10-27") as any).error, /future/);
  assert.match((cleanClaim({ description: "Gloves", amountIncGst: 5, spentOn: "20/10/2026" }, "2026-10-27") as any).error, /date/);
});

test("a receipt's amount: fuel total, tip inc GST (else ex GST + 10%), or not read", () => {
  assert.equal(receiptAmount({ kind: "FUEL", fuelTotal: 150.456, priceIncGst: null, priceExGst: null }), 150.46);
  assert.equal(receiptAmount({ kind: "TIP", fuelTotal: null, priceIncGst: 330, priceExGst: 300 }), 330);
  assert.equal(receiptAmount({ kind: "TIP", fuelTotal: null, priceIncGst: null, priceExGst: 300 }), 330);
  assert.equal(receiptAmount({ kind: "FUEL", fuelTotal: null, priceIncGst: null, priceExGst: null }), null);
});
