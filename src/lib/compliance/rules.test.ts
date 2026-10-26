import { test } from "node:test";
import assert from "node:assert/strict";
import { expiryState, isDocumentKind, isTicketKind, looksLikeTfnOrBank, onboardingProgress, ticketLabel, worstState } from "./rules";

const TODAY = "2026-10-26";

test("expiry states against today (Sydney date)", () => {
  assert.equal(expiryState(null, TODAY), "NO_EXPIRY");
  assert.equal(expiryState("2026-10-25", TODAY), "EXPIRED"); // yesterday
  assert.equal(expiryState("2026-10-26", TODAY), "EXPIRING"); // still good on its expiry date
  assert.equal(expiryState("2026-11-25", TODAY), "EXPIRING"); // 30 days out: inside the reminder window
  assert.equal(expiryState("2026-11-26", TODAY), "VALID"); // 31 days out
  assert.equal(expiryState("2030-01-01", TODAY), "VALID");
});

test("a worker's worst state: expired beats expiring beats OK; archived tickets are ignored", () => {
  assert.equal(worstState([], TODAY), "NONE");
  assert.equal(worstState([{ status: "ARCHIVED", expiryDate: "2020-01-01" }], TODAY), "NONE");
  assert.equal(worstState([{ status: "ACTIVE", expiryDate: null }], TODAY), "NO_EXPIRY");
  assert.equal(worstState([{ status: "ACTIVE", expiryDate: "2030-01-01" }, { status: "ACTIVE", expiryDate: "2026-11-01" }], TODAY), "EXPIRING");
  assert.equal(worstState([{ status: "ACTIVE", expiryDate: "2026-11-01" }, { status: "ACTIVE", expiryDate: "2026-10-01" }, { status: "ACTIVE", expiryDate: null }], TODAY), "EXPIRED");
  assert.equal(worstState([{ status: "ARCHIVED", expiryDate: "2026-10-01" }, { status: "ACTIVE", expiryDate: "2030-01-01" }], TODAY), "VALID");
});

test("TFN and bank details are refused (words everywhere, shapes in free text)", () => {
  for (const s of ["TFN 123 456 789", "my tax file number is", "BSB 062-000", "Account number 12345678", "acct no 1234", "bank details to follow"]) assert.equal(looksLikeTfnOrBank(s), true, s);
  // shapes, in free text
  assert.equal(looksLikeTfnOrBank("123 456 789", { freeText: true }), true);
  assert.equal(looksLikeTfnOrBank("his number 123456789 ok", { freeText: true }), true);
  assert.equal(looksLikeTfnOrBank("pay to 062-000 12345678", { freeText: true }), true);
  // allowed: ordinary notes, phones, ABN / ACN / licence numbers, and shapes in a number field
  for (const s of ["Renewed early, card in the office", "Call 0412 345 678", "ABN 12 345 678 901", "ACN 123 456 789", "Licence no. 123 456 789", "12 Smith St, Penrith NSW 2750"]) assert.equal(looksLikeTfnOrBank(s, { freeText: true }), false, s);
  assert.equal(looksLikeTfnOrBank("123456789"), false); // a 9-digit licence number in a number field
  assert.equal(looksLikeTfnOrBank(null), false);
});

test("kinds and labels", () => {
  assert.equal(isTicketKind("HRWL_EWP"), true);
  assert.equal(isTicketKind("NOPE"), false);
  assert.equal(isDocumentKind("PUBLIC_LIABILITY"), true);
  assert.equal(ticketLabel({ kind: "DRIVER_LICENCE", label: "HC" }), "Driver licence - HC");
  assert.equal(ticketLabel({ kind: "SITE_INDUCTION", label: "Westfield Parramatta" }), "Westfield Parramatta");
  assert.equal(ticketLabel({ kind: "OTHER", label: null }), "Other");
});

test("onboarding progress counts the six checklist items", () => {
  assert.deepEqual(onboardingProgress(null), { done: 0, of: 6 });
  assert.deepEqual(onboardingProgress({ startDate: "2026-10-01", employmentType: "CASUAL", emergencyName: "Sam", emergencyPhone: null, xeroSetUp: true }), { done: 3, of: 6 });
  assert.deepEqual(onboardingProgress({ startDate: "x", employmentType: "x", emergencyName: "x", emergencyPhone: "x", xeroSetUp: true, contractSigned: "x", inductionDate: "x" }), { done: 6, of: 6 });
});
