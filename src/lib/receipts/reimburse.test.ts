// Reimbursements from the phone (docs/accounts/REIMBURSE-LINK-DESIGN.md): parsing what's sent, the purchase
// reading's rules, a purchase's amount, and the words a phone sees (never a figure). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkSafe, parseReimbursement, reimburseStatus } from "./rules";
import { decidePurchase, purchaseFields } from "./checks";
import { receiptAmount } from "../reimbursements/rules";
import type { PurchaseReading } from "./reading";

const PHOTO = "cmvabcdefghij0123456789";
const TRUCK = "cmvtruck0000000000000001";

test("what the phone sends: what it was for, the truck or machine for fuel, a note for Other, the tap", () => {
  assert.deepEqual(parseReimbursement({ purpose: "TOOLS", note: " drill  bits ", photoIds: [PHOTO], paidMyself: true }), { purpose: "TOOLS", note: "drill bits", vehicleId: null, photoIds: [PHOTO] });
  assert.deepEqual(parseReimbursement({ purpose: "FUEL", vehicleId: TRUCK, photoIds: [PHOTO], paidMyself: true }), { purpose: "FUEL", note: null, vehicleId: TRUCK, photoIds: [PHOTO] });
  assert.match((parseReimbursement({ purpose: "TOOLS", photoIds: [PHOTO] }) as { error: string }).error, /I paid this myself/);
  assert.match((parseReimbursement({ purpose: "FUEL", photoIds: [PHOTO], paidMyself: true }) as { error: string }).error, /truck or machine/);
  assert.match((parseReimbursement({ purpose: "OTHER", photoIds: [PHOTO], paidMyself: true }) as { error: string }).error, /what it was for/);
  assert.match((parseReimbursement({ purpose: "TIP", photoIds: [PHOTO], paidMyself: true }) as { error: string }).error, /What was it for/, "a tip docket isn't a reimbursement");
  assert.match((parseReimbursement({ purpose: "TOOLS", photoIds: [], paidMyself: true }) as { error: string }).error, /photo/);
  assert.match((parseReimbursement({ purpose: "TOOLS", note: "gloves $45", photoIds: [PHOTO], paidMyself: true }) as { error: string }).error, /amount off/, "no figure typed on the link");
  assert.equal((parseReimbursement({ purpose: "TOOLS", vehicleId: TRUCK, photoIds: [PHOTO], paidMyself: true }) as { vehicleId: string | null }).vehicleId, null, "only fuel keeps a vehicle");
});

const P = (x: Partial<PurchaseReading> = {}): PurchaseReading => ({ documentType: "receipt", supplier: "Bunnings", receiptNo: "123", dateTime: "2026-10-26T10:15", total: "84.50", gst: "7.68", unclear: [], note: "", ...x });
const SENT = new Date("2026-10-27T00:00:00Z");

test("the purchase reading: total, date and shop make it READ; anything odd waits for a person", () => {
  assert.deepEqual(decidePurchase(P(), { sentAt: SENT }), { status: "READ", reasons: [] });
  assert.match(decidePurchase(P({ documentType: "tip_docket" }), { sentAt: SENT }).reasons[0], /tip docket - those are company costs/);
  assert.match(decidePurchase(P({ documentType: "fuel_receipt" }), { sentAt: SENT }).reasons[0], /fuel receipt/);
  assert.match(decidePurchase(P({ total: "" }), { sentAt: SENT }).reasons[0], /Missing: total/);
  assert.match(decidePurchase(P({ total: "6000" }), { sentAt: SENT }).reasons.join(), /worth a look/);
  assert.match(decidePurchase(P({ dateTime: "2026-08-01" }), { sentAt: SENT }).reasons.join(), /more than a month/);
  assert.match(decidePurchase(P({ unclear: ["total"] }), { sentAt: SENT }).reasons.join(), /Not clear on the photo: total/);
  const f = purchaseFields(P());
  assert.deepEqual([f.supplier, f.docketNo, f.purchaseTotal], ["Bunnings", "123", 84.5]);
  assert.ok(f.docketAt instanceof Date);
});

test("a purchase's amount is its total; fuel its fuel total", () => {
  assert.equal(receiptAmount({ kind: "PURCHASE", fuelTotal: null, priceIncGst: 999, priceExGst: null, purchaseTotal: 84.5 }), 84.5);
  assert.equal(receiptAmount({ kind: "PURCHASE", fuelTotal: null, priceIncGst: null, priceExGst: null, purchaseTotal: null }), null);
  assert.equal(receiptAmount({ kind: "FUEL", fuelTotal: 120.1, priceIncGst: null, priceExGst: null }), 120.1);
});

test("what the phone sees: words and a date, never a figure (and never the cancel reason)", () => {
  assert.equal(reimburseStatus("SENT", null), "Sent - being read");
  assert.equal(reimburseStatus("CHECK", null), "Sent - accounts will check it");
  assert.equal(reimburseStatus("READ", { status: "TO_PAY", paidOn: null }), "With accounts");
  assert.equal(reimburseStatus("READ", { status: "PAID", paidOn: "2026-11-03" }), "Paid on 3 Nov");
  assert.equal(reimburseStatus("READ", { status: "CANCELLED", paidOn: null }), "Not going ahead - ask accounts");
  assert.equal(reimburseStatus("REJECTED", null), "Not going ahead - ask accounts");
  for (const s of ["SENT", "READ", "CHECK"]) assert.ok(linkSafe(reimburseStatus(s, { status: "PAID", paidOn: "2026-11-03" })));
});
