import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { correctionError, homeFrom, HOME_OFFER_HOURS, legHours, needsOffice, outRefusal, stillOpen, TRAVEL_CAP_HOURS } from "./rules";
import { makeTravelPass, readTravelPass } from "../signin";
import { timesheetCsv, peopleOf, type TravelLine } from "../timesheets";
import { fileIsSafe } from "../payroll/rules";

// Regional travel (2 Nov 2026, Ilies): out (Start travel -> site sign-in) and home (Travelling home -> Arrived).
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));

test("leg times: start to end, quarter hours, no break", () => {
  assert.deepEqual(legHours(at(20), at(22, 20), at(23)), { hours: 2.25, flag: null });
  assert.deepEqual(legHours(at(20), at(20, 7), at(23)), { hours: 0, flag: null });
  assert.deepEqual(legHours(at(20), at(20), at(23)), { hours: 0, flag: null }, "end at start counts 0");
});

test("an open leg: on the way inside the window, then closed at no time (flagged, no hours)", () => {
  assert.deepEqual(legHours(at(1), null, at(3)), { hours: null, flag: "ON_THE_WAY" });
  assert.equal(stillOpen(at(1), null, at(1 + TRAVEL_CAP_HOURS)), true);
  assert.deepEqual(legHours(at(1), null, at(1 + TRAVEL_CAP_HOURS, 1)), { hours: null, flag: "NOT_ENDED" });
  assert.equal(stillOpen(at(1), null, at(1 + TRAVEL_CAP_HOURS, 1)), false, "can't be ended by the worker any more");
  assert.equal(stillOpen(at(1), at(2), at(2)), false, "an ended leg isn't open");
  assert.equal(needsOffice("NOT_ENDED"), true);
  assert.equal(needsOffice("ON_THE_WAY"), false);
});

test(`the cap: a leg over ${TRAVEL_CAP_HOURS}h counts nothing and is flagged`, () => {
  assert.deepEqual(legHours(at(0), at(TRAVEL_CAP_HOURS)), { hours: TRAVEL_CAP_HOURS, flag: null }, "exactly the cap counts");
  assert.deepEqual(legHours(at(0), at(TRAVEL_CAP_HOURS, 1)), { hours: null, flag: "OVER_CAP" });
  assert.equal(needsOffice("OVER_CAP"), true);
});

test("start travel: regional jobs only; already on site refused; a second tap is not a refusal", () => {
  assert.match(outRefusal(undefined)!, /only for the regional jobs/);
  assert.match(outRefusal({ jobId: "j", regional: false, signedIn: false, existingLeg: false })!, /only for regional jobs/);
  assert.match(outRefusal({ jobId: "j", regional: true, signedIn: true, existingLeg: false })!, /already signed in/);
  assert.equal(outRefusal({ jobId: "j", regional: true, signedIn: false, existingLeg: false }), null);
  assert.equal(outRefusal({ jobId: "j", regional: true, signedIn: false, existingLeg: true }), null, "the store shows the existing leg instead");
});

test("travelling home: after a sign-out on a regional job, within the window, once", () => {
  const now = at(12);
  const c = (id: string, o: Partial<{ regional: boolean; out: Date | null; leg: boolean }> = {}) =>
    ({ attendanceId: id, regional: o.regional ?? true, signOutAt: o.out === undefined ? at(10) : o.out, existingLeg: o.leg ?? false });
  assert.equal(homeFrom([c("a")], now)?.attendanceId, "a");
  assert.equal(homeFrom([c("a", { regional: false })], now), null, "not regional - not offered");
  assert.equal(homeFrom([c("a", { out: null })], now), null, "not signed out yet");
  assert.equal(homeFrom([c("a", { out: at(12 - HOME_OFFER_HOURS, -1) })], now), null, "too long after the sign-out");
  assert.equal(homeFrom([c("a", { leg: true })], now), null, "already travelling home from that sign-out - no duplicate");
  assert.equal(homeFrom([c("old", { out: at(9) }), c("new", { out: at(11) })], now)?.attendanceId, "new", "the latest sign-out");
});

test("office corrections: end after start", () => {
  assert.equal(correctionError(at(1), at(2)), null);
  assert.equal(correctionError(at(1), null), null);
  assert.match(correctionError(at(2), at(1))!, /after the start/);
  assert.match(correctionError(new Date("x"), null)!, /start time/);
});

test("the travel pass: tied to the person and the phone, signed, expires", () => {
  process.env.AUTH_SECRET ??= "test-secret-for-unit-tests-only";
  const pass = makeTravelPass("r1", "dev1", 1_000);
  assert.equal(readTravelPass(pass, "dev1", 2_000), "r1");
  assert.equal(readTravelPass(pass, "dev2", 2_000), null, "another phone can't use it");
  assert.equal(readTravelPass(pass.slice(0, -2) + "xx", "dev1", 2_000), null, "tampered");
  assert.equal(readTravelPass(pass, "dev1", 1_000 + 121 * 86_400_000), null, "expired");
  assert.equal(readTravelPass("nonsense", "dev1"), null);
});

const tl = (o: Partial<TravelLine>): TravelLine => ({
  legId: "t1", direction: "OUT", date: "2026-11-02", resourceId: "r1", name: "Sam Smith", role: "Labourer", jobId: "j1", site: "Orange hospital",
  start: "5:00 am", end: "8:30 am", startAt: "", endAt: null, hours: 3.5, flag: null, changedByOffice: null, ...o,
});

test("timesheets: travel is its own column and total - site hours unchanged", () => {
  const line = { attendanceId: "a1", date: "2026-11-02", resourceId: "r1", name: "Sam Smith", role: "Labourer", site: "Orange hospital", in: "8:30 am", out: "5:00 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null };
  const travel = [tl({}), tl({ legId: "t2", direction: "HOME", start: "5:10 pm", end: "8:40 pm", hours: 3.5 }), tl({ legId: "t3", date: "2026-11-03", end: null, hours: null, flag: "NOT_ENDED" })];
  const [p] = peopleOf("2026-11-02", [line], travel);
  assert.equal(p.total, 8, "site hours exactly as before");
  assert.equal(p.travelTotal, 7, "out + home; the never-ended leg counts nothing");
  const csv = timesheetCsv("2026-11-02", [line], null, travel);
  assert.ok(csv.includes("Employee,Role,Date,Day,Site / place,Sign in,Sign out,Unpaid break (min),Hours,Travel (h),Status,Notes"));
  assert.ok(csv.includes("Travel out to Orange hospital,5:00 am,8:30 am,,,3.5,Travel"));
  assert.ok(csv.includes("Travel home from Orange hospital,5:10 pm,8:40 pm,,,3.5,Travel"));
  assert.ok(csv.includes("never ended - no hours"));
  assert.ok(csv.includes("WEEK TOTAL,,,,,8,7,,"));
  assert.ok(fileIsSafe(csv));
});

test("the link answers carry no money, and site hours / JobActual are never touched", () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /assertNoMoney\(JSON\.stringify\(out\)\)/, "status checked before it leaves");
  assert.doesNotMatch(store, /prisma\.(jobActual|assignment|allocationCost|siteAttendance|job|project)\.(create|update|upsert|delete)/, "travel writes TravelLeg / TravelEdit only");
  const route = readFileSync(new URL("../../app/api/site/in/travel/route.ts", import.meta.url), "utf8");
  assert.match(route, /assertNoMoney\(JSON\.stringify\(x\)\)/);
  assert.match(route, /readTravelPass\(body\.pass, deviceId\)/, "the phone's own pass, nobody else's");
});
