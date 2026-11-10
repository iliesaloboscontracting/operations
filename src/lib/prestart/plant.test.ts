// Stage 2 - plant QR stickers (Ilies approved 10 Nov 2026): the plain rules and the token binding. `npm test`.
process.env.AUTH_SECRET ??= "unit-test-secret-not-for-anything-real";
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePlantCheckToken, makePlantTicket, makePrestartToken, makeTicket, readPlantCheckToken, readPlantTicket, readPrestartToken, readTicket } from "../signin";
import { PLANT_PRE, PLANT_POST, checklistFor, slotLabel, walkaroundSlotsFor, HOUR_METER_SLOT } from "./checklists";
import { LIMITS, capsFull, hourMeterFlag, machineCapFor, parseHourMeter, photoRefusal, plantQrAllowed, sessionRefusal, walkaroundExpired, walkaroundRequired } from "./rules";

test("tokens: a plant ticket and a plant check token are only what they say - never a sign-in, never a truck check", () => {
  const ticket = makePlantTicket("link1", "machine1");
  assert.deepEqual(readPlantTicket(ticket), { linkId: "link1", resourceId: "machine1" });
  assert.equal(readTicket(ticket), null, "a plant ticket can't sign anyone in");
  assert.equal(readPlantCheckToken(ticket), null);
  const signTicket = makeTicket({ jobIds: ["p1"], method: "POINT", linkId: "p1" });
  assert.equal(readPlantTicket(signTicket), null, "a sign-in ticket can't start a plant check");
  const check = makePlantCheckToken("session1", "PRE");
  assert.deepEqual(readPlantCheckToken(check), { sessionId: "session1", kind: "PRE" });
  assert.equal(readPrestartToken(check), null, "a plant check token isn't a truck token");
  assert.equal(readPlantCheckToken(makePrestartToken("att1", "PRE")), null, "a truck token isn't a plant check token");
  assert.equal(readPlantTicket(ticket.slice(0, -2) + "xx"), null, "tampered");
  const now = Date.now();
  assert.equal(readPlantTicket(makePlantTicket("l", "m", now - 16 * 60_000), now), null, "a ticket lasts 15 minutes");
  assert.equal(readPlantCheckToken(makePlantCheckToken("s", "POST", now - 3 * 3_600_000), now), null, "a check token lasts 2 hours");
  assert.ok(readPlantCheckToken(makePlantCheckToken("s", "POST", now - 60 * 60_000), now));
});

test("hour meter: a positive number, one decimal at most, under 200,000", () => {
  assert.deepEqual(parseHourMeter("1234.5"), { ok: true, value: 1234.5 });
  assert.deepEqual(parseHourMeter(1234), { ok: true, value: 1234 });
  assert.deepEqual(parseHourMeter(" 12,345 "), { ok: true, value: 12345 });
  for (const bad of ["", "abc", "-5", "0", "1234.56", "1e5", "200001", null, undefined, {}, "12.5.1"]) assert.equal(parseHourMeter(bad).ok, false, String(bad));
  assert.equal(parseHourMeter("200000").ok, true);
});

test("hour meter: lower than the last reading is flagged, never refused", () => {
  assert.equal(hourMeterFlag(1200, 1234.5), "LOWER");
  assert.equal(hourMeterFlag(1234.5, 1234.5), null);
  assert.equal(hourMeterFlag(1300, 1234.5), null);
  assert.equal(hourMeterFlag(5, null), null);
});

test("plant: the checklist and walk-around by type; first of the day needs the walk-around", () => {
  assert.equal(checklistFor("EQUIPMENT", "PRE", { plant: true }), PLANT_PRE);
  assert.equal(checklistFor("EQUIPMENT", "POST", { plant: true }), PLANT_POST);
  assert.deepEqual(walkaroundSlotsFor("EQUIPMENT", "PRE").map((s) => s.key), ["FRONT", "BACK", "LEFT", "RIGHT", "CAB"]);
  assert.equal(walkaroundSlotsFor("EQUIPMENT", "POST").length, 0);
  assert.equal(walkaroundSlotsFor("ATTACHMENT", "PRE").length, 0);
  assert.equal(walkaroundSlotsFor("VEHICLE", "PRE").length, 5, "trucks unchanged");
  assert.equal(slotLabel("LEFT"), "Left side");
  assert.equal(slotLabel(HOUR_METER_SLOT), "Hour meter");
  assert.equal(walkaroundRequired([]), true);
  assert.equal(walkaroundRequired([{ walkaround: "DONE" }]), false);
});

test("plant QRs: Lobos-owned, active plant only", () => {
  assert.equal(plantQrAllowed({ type: "EQUIPMENT", ownership: "OWNED", active: true }), true);
  assert.equal(plantQrAllowed({ type: "EQUIPMENT", ownership: "HIRED", active: true }), false);
  assert.equal(plantQrAllowed({ type: "ATTACHMENT", ownership: "OWNED", active: true }), false);
  assert.equal(plantQrAllowed({ type: "VEHICLE", ownership: "OWNED", active: true }), false);
  assert.equal(plantQrAllowed({ type: "EQUIPMENT", ownership: "OWNED", active: false }), false);
});

test("sessions: 40 a QR and 12 a phone a Sydney day", () => {
  assert.equal(sessionRefusal({ qrToday: 39, deviceToday: 11 }), null);
  assert.equal(sessionRefusal({ qrToday: 40, deviceToday: 0 })?.status, 429);
  assert.equal(sessionRefusal({ qrToday: 0, deviceToday: 12 })?.status, 429);
  assert.equal(LIMITS.plantSessionsPerQrDay, 40);
  assert.equal(LIMITS.plantSessionsPerDeviceDay, 12);
});

test("hour-meter photos: their own allowance (20 a machine a day), the same session cap, never removed by age", () => {
  assert.equal(machineCapFor("METER"), 20);
  const c = { role: "METER" as const, signIn: 1, roleMachineDay: 20, allDay: 1, deviceDay: 1, sameOnSignIn: 1 };
  assert.equal(photoRefusal(c), null);
  assert.equal(photoRefusal({ ...c, roleMachineDay: 21 })?.cap, "METER");
  assert.equal(photoRefusal({ ...c, signIn: 31 })?.status, 429, "the per-session cap (30) as for a truck sign-in");
  assert.deepEqual(capsFull({ walkaroundMachineDay: 0, faultMachineDay: 0, meterMachineDay: 20, allDay: 0 }), ["METER"]);
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(walkaroundExpired({ role: "METER", createdAt: new Date("2020-11-01T00:00:00Z") }, now), false); // all information is kept (Ilies, 10 Nov 2026)
  assert.equal(walkaroundExpired({ role: "FAULT", createdAt: new Date("2020-11-01T00:00:00Z") }, now), false);
});
