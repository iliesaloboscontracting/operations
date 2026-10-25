// Receipts R2 - the rules that decide READ or CHECK (design §Reading): key fields missing or unclear,
// a duplicate docket number, the date more than 2 days from sending, a rego that isn't ours, the
// odometer going backwards or jumping more than 1,500 km a day, asbestos vs the Yes/No tap. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFuel, decideOdometer, decideTip, docketDate, fuelFields, normDocket, normRego, num, tipFields } from "./checks";
import type { FuelReading, TipReading } from "./reading";

const sentAt = new Date("2026-10-26T01:00:00Z"); // 12pm Sydney
const REGOS = ["DD50LV", "DO17HS", "CN03RK"];
const tip = (x: Partial<TipReading> = {}): TipReading => ({
  documentType: "tip_docket", docketNo: "A12345", dateTime: "2026-10-26T09:41", tipSite: "Bingo Eastern Creek", wasteType: "Mixed C&D",
  tonnesNet: "6.24", rego: "DD50LV", priceExGst: "", priceIncGst: "", unclear: [], note: "", ...x,
});
const fuel = (x: Partial<FuelReading> = {}): FuelReading => ({
  documentType: "fuel_receipt", litres: "182.40", pricePerLitre: "2.159", total: "393.80", station: "Ampol Wetherill Park", dateTime: "2026-10-26T06:12", rego: "", unclear: [], note: "", ...x,
});
const T = (x: Partial<TipReading>, f: Partial<Parameters<typeof decideTip>[1]> = {}) => decideTip(tip(x), { sentAt, asbestosTap: false, ourRegos: REGOS, duplicateOf: null, ...f });

test("a clean tip docket goes straight in (READ)", () => {
  assert.deepEqual(T({}), { status: "READ", reasons: [] });
  assert.equal(T({ priceExGst: "" }).status, "READ", "no price is fine - R3 prices it from the tip rate");
});

test("tip: key fields missing or unclear -> CHECK", () => {
  assert.match(T({ docketNo: "", tonnesNet: "" }).reasons.join(), /Missing: docket number, tonnes/);
  assert.match(T({ dateTime: "26/10" }).reasons.join(), /Missing: date/);
  assert.match(T({ tipSite: " ", wasteType: "" }).reasons.join(), /tip site, waste type/);
  assert.match(T({ unclear: ["tonnesNet", "docketNo"] }).reasons.join(), /Not clear on the photo: tonnes, docket number/);
  assert.match(T({ tonnesNet: "640" }).reasons.join(), /more than a truck carries/);
  assert.match(T({ documentType: "fuel_receipt" }).reasons.join(), /fuel receipt, not a tip docket/);
});

test("tip: a duplicate docket number -> CHECK", () => {
  const d = T({}, { duplicateOf: "by Turori on 25/10/2026" });
  assert.equal(d.status, "CHECK");
  assert.match(d.reasons.join(), /A12345 was already sent \(by Turori/);
  assert.equal(normDocket(" a-12345 "), normDocket("A12345"), "spacing, case and dashes don't hide a duplicate");
  assert.equal(normDocket("0012345"), normDocket("12345"), "nor leading zeros on a number");
});

test("tip: dated more than 2 days from sending -> CHECK; within 2 days is fine", () => {
  assert.match(T({ dateTime: "2026-10-23T10:00" }).reasons.join(), /Dated 2026-10-23 - more than 2 days/);
  assert.equal(T({ dateTime: "2026-10-24T13:00" }).status, "READ");
  assert.equal(T({ dateTime: "2026-10-29" }).status, "CHECK", "the future too");
});

test("tip: a rego that isn't ours -> CHECK; ours in any spelling is fine; none printed is fine", () => {
  assert.match(T({ rego: "XYZ123" }).reasons.join(), /Rego XYZ123 isn't one of our trucks/);
  assert.equal(T({ rego: "dd 50 lv" }).status, "READ");
  assert.equal(T({ rego: "" }).status, "READ");
});

test("tip: asbestos on the docket vs the Yes/No tap", () => {
  assert.match(T({ wasteType: "Asbestos - bonded" }, { asbestosTap: false }).reasons.join(), /sent as not asbestos/);
  assert.match(T({ wasteType: "Mixed C&D" }, { asbestosTap: true }).reasons.join(), /Sent as asbestos, but the docket says "Mixed C&D"/);
  assert.equal(T({ wasteType: "ACM friable" }, { asbestosTap: true }).status, "READ");
  assert.equal(T({ wasteType: "Bonded asbestos" }, { asbestosTap: true }).status, "READ");
});

test("fuel: clean -> READ; missing, odd maths, another of our trucks -> CHECK", () => {
  const F = (x: Partial<FuelReading>, picked: string | null = "DD50LV") => decideFuel(fuel(x), { sentAt, ourRegos: REGOS, pickedRego: picked });
  assert.deepEqual(F({}), { status: "READ", reasons: [] });
  assert.match(F({ litres: "", total: "" }).reasons.join(), /Missing: litres, total/);
  assert.match(F({ total: "500.00" }).reasons.join(), /doesn't come to the total/);
  assert.match(F({ rego: "DO17HS" }).reasons.join(), /says DO17HS, but it was sent for DD50LV/);
  assert.match(F({ rego: "ZZZ999" }).reasons.join(), /isn't one of our trucks/);
  assert.match(F({ dateTime: "2026-10-20T06:00" }).reasons.join(), /more than 2 days/);
  assert.match(F({ documentType: "tip_docket" }).reasons.join(), /tip docket, not a fuel receipt/);
});

test("odometer: backwards or more than 1,500 km a day -> CHECK", () => {
  const prev = { km: 210_000, at: new Date("2026-10-25T01:00:00Z") };
  const O = (km: string, unclear = false, previous: typeof prev | null = prev) => decideOdometer({ km, unclear, note: "" }, { sentAt, previous });
  assert.deepEqual(O("210450"), { status: "READ", reasons: [] });
  assert.match(O("209990").reasons.join(), /Lower than the last reading \(210,000 km\)/);
  assert.match(O("211600").reasons.join(), /1,600 km since the last reading a day ago - more than 1,500 km a day/);
  assert.equal(decideOdometer({ km: "213000", unclear: false, note: "" }, { sentAt, previous: { km: 210_000, at: new Date("2026-10-23T01:00:00Z") } }).status, "READ", "3 days, 3,000 km is fine");
  assert.match(O("", false).reasons.join(), /No odometer reading/);
  assert.match(O("210450", true).reasons.join(), /digits aren't all clear/);
  assert.equal(O("5", false, null).status, "READ", "a truck's first reading has nothing to compare with");
});

test("numbers, regos and dates are read the same way everywhere", () => {
  assert.equal(num("1,234.50"), 1234.5);
  assert.equal(num("$412.50 inc"), 412.5);
  assert.equal(num("6.24 t"), 6.24);
  assert.equal(num(""), null);
  assert.equal(normRego(" cn-03 rk "), "CN03RK");
  assert.equal(docketDate("2026-10-26T09:41")!.toISOString(), "2026-10-25T22:41:00.000Z", "Sydney time (daylight saving)");
  assert.equal(docketDate("2026-10-26")!.toISOString(), "2026-10-26T01:00:00.000Z", "a date alone is Sydney midday");
  assert.equal(docketDate("2026-13-01"), null);
  assert.deepEqual({ ...tipFields(tip({ priceIncGst: "$453.75" })), docketAt: null }, { docketNo: "A12345", docketAt: null, tipSite: "Bingo Eastern Creek", wasteType: "Mixed C&D", tonnes: 6.24, priceExGst: null, priceIncGst: 453.75, rego: "DD50LV" });
  assert.equal(fuelFields(fuel({ pricePerLitre: "" })).pricePerLitre, 2.159, "price per litre worked out from total / litres when not printed");
});
