import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSummary, isAssetResource, linkable, managerDateView, reminderCategory } from "./rules";

const TODAY = "2026-10-27";

test("D4: what a Manager reads is the date, who issued it and its number - nothing else", () => {
  const doc = { id: "d1", kind: "ASSET_INSURANCE", issuer: "Insurer", reference: "POL-1", expiryDate: "2026-11-10", title: "Fleet policy - premium paid", notes: "premium 4200", files: [{ id: "f" }] };
  const v = managerDateView(doc, TODAY);
  assert.deepEqual(Object.keys(v).sort(), ["expiryDate", "issuer", "kind", "label", "reference", "state"]);
  assert.equal(v.label, "Insurance");
  assert.equal(v.state, "EXPIRING");
  assert.equal(managerDateView({ ...doc, expiryDate: "2026-10-01" }, TODAY).state, "EXPIRED");
});

test("reminders use the calendar's own categories", () => {
  assert.equal(reminderCategory("REGO"), "REGO");
  assert.equal(reminderCategory("ASSET_INSURANCE"), "INSURANCE");
  assert.equal(reminderCategory("SERVICE_DUE"), "SERVICE");
  assert.equal(reminderCategory("PLANT_INSPECTION"), "SERVICE");
  assert.equal(reminderCategory("PUBLIC_LIABILITY"), "COMPLIANCE");
});

test("assets are owned vehicles, plant and attachments - not hire, not people", () => {
  assert.equal(isAssetResource({ type: "VEHICLE", ownership: "OWNED" }), true);
  assert.equal(isAssetResource({ type: "EQUIPMENT", ownership: null }), true);
  assert.equal(isAssetResource({ type: "EQUIPMENT", ownership: "HIRED" }), false);
  assert.equal(isAssetResource({ type: "PERSONNEL" }), false);
  assert.equal(isAssetResource({ type: "HIRE" }), false);
});

test("an asset's dates: soonest active per kind, not recorded, and the worst", () => {
  const docs = [
    { kind: "REGO", status: "ACTIVE", expiryDate: "2027-03-01" },
    { kind: "REGO", status: "ARCHIVED", expiryDate: "2026-01-01" },
    { kind: "ASSET_INSURANCE", status: "ACTIVE", expiryDate: "2026-11-10" },
  ];
  const v = dueSummary(docs, TODAY, { vehicle: true });
  assert.deepEqual(v.lines.map((l) => [l.kind, l.state]), [["REGO", "VALID"], ["ASSET_INSURANCE", "EXPIRING"], ["SERVICE_DUE", "NOT_RECORDED"]]);
  assert.equal(v.worst, "EXPIRING");
  const plant = dueSummary([{ kind: "PLANT_INSPECTION", status: "ACTIVE", expiryDate: "2026-10-01" }], TODAY, { vehicle: false });
  assert.deepEqual(plant.lines.map((l) => l.kind), ["ASSET_INSURANCE", "SERVICE_DUE", "PLANT_INSPECTION"], "no rego line for plant");
  assert.equal(plant.worst, "EXPIRED");
  assert.equal(dueSummary([], TODAY, { vehicle: true }).worst, "NOT_RECORDED");
});

test("inbox lines that can be linked as a service", () => {
  const linked = new Set(["a"]);
  const line = { status: "NO_JOB", invoiceDate: "2026-09-01", createdAt: "2026-09-02T00:00:00Z" };
  assert.equal(linkable(line, linked, "b", TODAY), true);
  assert.equal(linkable(line, linked, "a", TODAY), false, "already linked");
  assert.equal(linkable({ ...line, status: "DUPLICATE" }, linked, "b", TODAY), false);
  assert.equal(linkable({ ...line, invoiceDate: "2025-10-26" }, linked, "b", TODAY), false, "over 12 months old");
  assert.equal(linkable({ ...line, invoiceDate: null, createdAt: "2026-10-01T00:00:00Z" }, linked, "b", TODAY), true, "upload date when no invoice date");
});
