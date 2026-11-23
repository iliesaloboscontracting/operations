import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  correctionError, homeFrom, HOME_OFFER_HOURS, legHours, MODE_BUTTON, MODE_NOT_RECORDED, MODE_REQUIRED, modeMissing, modeOf, modeRefusal, needsOffice,
  outRefusal, paidText, paidTravelHours, passAllowed, stillOpen, TRAVEL_CAP_HOURS, truckRefusal,
} from "./rules";
import { makeTravelPass, readTravelPass } from "../signin";
import { approvalBlockers, timesheetCsv, peopleOf, travelIssues, type TravelLine } from "../timesheets";
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
  assert.ok(csv.includes("Employee,Role,Date,Day,Site / place,Sign in,Sign out,Unpaid break (min),Hours,Of which tip run (h),Travel (h),Travel paid (h),Status,Notes"));
  // These legs have no mode (recorded before travel pay): no paid figure, "Mode not recorded" in Notes.
  assert.ok(csv.includes("Travel out to Orange hospital,5:00 am,8:30 am,,,,3.5,,Travel,Mode not recorded"));
  assert.ok(csv.includes("Travel home from Orange hospital,5:10 pm,8:40 pm,,,,3.5,,Travel,Mode not recorded"));
  assert.ok(csv.includes("never ended - no hours"));
  assert.ok(csv.includes("WEEK TOTAL,,,,,8,0,7,0,,2 travel legs: mode not recorded"));
  assert.ok(fileIsSafe(csv));
});

// ---------- travel pay (Ilies, 23-24 Nov 2026) ----------

test("paidTravelHours: own car/ute in full; passenger 1 hour less each way, never below 0; no mode = no figure", () => {
  assert.equal(paidTravelHours(2, "DRIVER_OWN_VEHICLE"), 2, "own vehicle: in full");
  assert.equal(paidTravelHours(0.5, "DRIVER_OWN_VEHICLE"), 0.5);
  assert.equal(paidTravelHours(2, "PASSENGER"), 1, "passenger 2h -> 1h");
  assert.equal(paidTravelHours(0.5, "PASSENGER"), 0, "passenger 0.5h -> 0");
  assert.equal(paidTravelHours(1, "PASSENGER"), 0, "passenger 1h -> 0");
  assert.equal(paidTravelHours(2.25, "PASSENGER"), 1.25, "quarter hours kept");
  assert.equal(paidTravelHours(2, null), null, "not asked - no paid figure");
  assert.equal(paidTravelHours(2, undefined), null);
  assert.equal(paidTravelHours(null, "PASSENGER"), null, "a leg that counts nothing (never ended / over the cap) pays nothing");
  assert.equal(paidTravelHours(null, "DRIVER_OWN_VEHICLE"), null);
  // Never ended / over the cap still count nothing, exactly as before.
  assert.equal(paidTravelHours(legHours(at(1), null, at(1 + TRAVEL_CAP_HOURS, 1)).hours, "DRIVER_OWN_VEHICLE"), null);
  assert.equal(paidTravelHours(legHours(at(0), at(TRAVEL_CAP_HOURS, 1)).hours, "DRIVER_OWN_VEHICLE"), null);
  assert.equal(paidText({ hours: 2, mode: "PASSENGER" }), "paid 1h (passenger)");
  assert.equal(paidText({ hours: 2, mode: "DRIVER_OWN_VEHICLE" }), "paid 2h (own vehicle)");
  assert.equal(paidText({ hours: 2, mode: null }), MODE_NOT_RECORDED);
  assert.equal(paidText({ hours: null, mode: "PASSENGER" }), "", "nothing to say for a leg with no hours");
  assert.equal(modeMissing({ hours: 2, mode: null }), true, "flagged for the office");
  assert.equal(modeMissing({ hours: null, mode: null }), false, "a leg with no hours is already flagged for that");
  assert.equal(modeOf("SOMETHING"), null);
});

test("the mode is required to start a leg - out and home; the phone's two buttons", () => {
  assert.equal(modeRefusal(undefined), MODE_REQUIRED);
  assert.equal(modeRefusal("DRIVER"), MODE_REQUIRED, "only the two values");
  assert.equal(modeRefusal("PASSENGER"), null);
  assert.equal(modeRefusal("DRIVER_OWN_VEHICLE"), null);
  assert.deepEqual(MODE_BUTTON, { DRIVER_OWN_VEHICLE: "I'm driving my own car/ute", PASSENGER: "I'm a passenger" });
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  for (const fn of ["startOut", "startHome"]) {
    const body = store.slice(store.indexOf(`export async function ${fn}(`), store.indexOf("\n}\n", store.indexOf(`export async function ${fn}(`)));
    assert.ok(body.indexOf("modeRefusal(b.mode)") > 0 && body.indexOf("modeRefusal(b.mode)") < body.indexOf("prisma.travelLeg.create"), `${fn}: the mode is checked before the leg is made`);
    assert.match(body, /mode: b\.mode as TravelMode/, `${fn}: the mode is saved on the leg`);
  }
  const route = readFileSync(new URL("../../app/api/site/in/travel/route.ts", import.meta.url), "utf8");
  assert.match(route, /startOut\(resourceId, \{ jobId: body\.jobId, mode: body\.mode/);
  assert.match(route, /startHome\(resourceId, \{ mode: body\.mode/);
});

test("Start travel is refused while signed in on a truck - the truck sign-in already counts the drive", () => {
  assert.equal(truckRefusal(true), "You're signed in on the truck - that already counts your drive. No need to start travel.");
  assert.equal(truckRefusal(false), null);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /place: "VEHICLE", signOutAt: null, removedAt: null, status: \{ not: "REJECTED" \}/, "an open truck-QR sign-in");
  for (const fn of ["startOut", "startHome"]) {
    const body = store.slice(store.indexOf(`export async function ${fn}(`), store.indexOf("\n}\n", store.indexOf(`export async function ${fn}(`)));
    assert.ok(body.indexOf("truckRefusal(await onTruckNow(resourceId))") > 0 && body.indexOf("truckRefusal(") < body.indexOf("prisma.travelLeg.create"), `${fn}: refused before any leg is made`);
  }
});

test("the approved-week snapshot keeps the mode and paid hours; an old snapshot shows 'mode not recorded'", () => {
  const legs = [
    tl({ legId: "p", hours: 2, mode: "PASSENGER", paidHours: paidTravelHours(2, "PASSENGER") }),
    tl({ legId: "d", direction: "HOME", start: "5:10 pm", end: "7:10 pm", hours: 2, mode: "DRIVER_OWN_VEHICLE", paidHours: paidTravelHours(2, "DRIVER_OWN_VEHICLE") }),
  ];
  // What POST /api/timesheets (approve) stores and every later read parses back.
  const snap = JSON.parse(JSON.stringify({ weekStart: "2026-11-02", lines: [], travel: legs })) as { travel: TravelLine[] };
  assert.deepEqual(snap.travel.map((t) => [t.mode, t.paidHours]), [["PASSENGER", 1], ["DRIVER_OWN_VEHICLE", 2]]);
  const [p] = peopleOf("2026-11-02", [], snap.travel);
  assert.equal(p.travelTotal, 4);
  assert.equal(p.travelPaidTotal, 3, "1h (passenger) + 2h (own vehicle)");
  assert.equal(p.travelModeMissing, 0);
  const csv = timesheetCsv("2026-11-02", [], { approvedBy: "Alex", approvedAt: new Date("2026-11-09T00:00:00Z") }, snap.travel);
  assert.ok(csv.includes("Travel out to Orange hospital,5:00 am,8:30 am,,,,2,1,Travel,Passenger"), "passenger: 2h, paid 1h");
  assert.ok(csv.includes("Travel home from Orange hospital,5:10 pm,7:10 pm,,,,2,2,Travel,Own vehicle"), "own vehicle: 2h, paid 2h");
  assert.ok(csv.includes("WEEK TOTAL,,,,,0,0,4,3,,"));
  assert.ok(fileIsSafe(csv), "hours only - passes the payroll file check");
  assert.doesNotMatch(csv, /\$/);
  // A week approved before travel pay: no mode, no paid hours in its snapshot.
  const old = JSON.parse(JSON.stringify([tl({ hours: 2 })]).replace(/"mode":null,?|"paidHours":null,?/g, "")) as TravelLine[];
  const [q] = peopleOf("2026-11-02", [], old);
  assert.equal(q.travelPaidTotal, 0);
  assert.equal(q.travelModeMissing, 1);
  // The approve route snapshots the live travel lines, and the lines carry the mode and paid hours.
  const route = readFileSync(new URL("../../app/api/timesheets/route.ts", import.meta.url), "utf8");
  assert.match(route, /const snapshot: TimesheetSnapshot = \{ weekStart, lines, travel, tipRuns, absences \}/);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /mode, paidHours: paidTravelHours\(hours, mode\)/);
});

test("office corrections can set the mode - with a reason, kept, refused in a locked week (same route as times)", () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const body = store.slice(store.indexOf("export async function editTravelLeg("));
  assert.ok(body.indexOf("lockedWeekFor(leg.date)") < body.indexOf('field: "mode"'), "a locked week is refused first");
  assert.match(body, /"mode" in b && !isTravelMode\(b\.mode\)/, "only the two values");
  assert.match(body, /edits\.push\(\{ field: "mode", before: leg\.mode, after: mode \}\)/, "kept in TravelEdit");
  const route = readFileSync(new URL("../../app/api/attendance/travel/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /await guard\("MANAGER"\)/, "Manager+ only");
  assert.match(route, /reason\.length < 3/, "a reason");
});

test("the link answers carry no money, and site hours / JobActual are never touched", () => {
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.match(store, /assertNoMoney\(JSON\.stringify\(out\)\)/, "status checked before it leaves");
  assert.doesNotMatch(store, /prisma\.(jobActual|assignment|allocationCost|siteAttendance|job|project)\.(create|update|upsert|delete)/, "travel writes TravelLeg / TravelEdit only");
  const route = readFileSync(new URL("../../app/api/site/in/travel/route.ts", import.meta.url), "utf8");
  assert.match(route, /assertNoMoney\(JSON\.stringify\(x\)\)/);
  assert.match(route, /readTravelPass\(body\.pass, deviceId\)/, "the phone's own pass, nobody else's");
});

test("approval is blocked by travel never ended, over 8h or still on the way - not by a normal leg (Ilies, 2 Nov 2026)", () => {
  const line = { attendanceId: "a1", date: "2026-11-02", resourceId: "r1", name: "Sam Smith", role: null, site: "Orange", in: "8:30 am", out: "5:00 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null };
  assert.deepEqual(approvalBlockers([line], [tl({})]), [], "an ended leg under 8h doesn't block");
  assert.deepEqual(approvalBlockers([line], [tl({ flag: "NOT_ENDED", hours: null })]), ["Sam Smith (2026-11-02: travel never ended)"]);
  assert.deepEqual(approvalBlockers([line], [tl({ flag: "OVER_CAP", hours: null })]), ["Sam Smith (2026-11-02: travel over 8h)"]);
  assert.deepEqual(approvalBlockers([line], [tl({ flag: "ON_THE_WAY", hours: null })]), ["Sam Smith (2026-11-02: still travelling)"]);
  assert.deepEqual(approvalBlockers([{ ...line, out: null, hours: null }], []), ["Sam Smith (2026-11-02: no sign-out)"], "a missing sign-out still blocks as before");
  assert.equal(travelIssues([tl({}), tl({ flag: "NOT_ENDED" }), tl({ flag: "OVER_CAP" })]), 2);
});
test("AT-001: a travel pass only from the supervisor's QR, on a job they're allocated to, with regional work", () => {
  const ok = { jobId: "j1", method: "SUPERVISOR_QR", allocated: true, regionalWork: true };
  assert.equal(passAllowed(ok), true);
  assert.equal(passAllowed({ ...ok, jobId: null, method: "POINT" }), false, "office / yard / truck point");
  assert.equal(passAllowed({ ...ok, method: "POSTER" }), false, "a site poster (Ilies: Supervisor QR only)");
  assert.equal(passAllowed({ ...ok, allocated: false }), false, "not on that job's allocation");
  assert.equal(passAllowed({ ...ok, regionalWork: false }), false, "no regional work on their board");
});