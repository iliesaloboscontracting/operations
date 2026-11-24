import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crewLegVerdict, CREW_MATCH_MINUTES, crewWindow, deriveCrewLegs, findDrive, ownTruckCovers, viaText, type Att, type LegLite } from "./derive";
import { amberFlag, driversPossibleText, legVerdict, linkCountsOn, linkRefusal, needsOffice, NO_LINK_REFUSAL, paidText, paidTravelHours, pointFixFor, TRAVEL_LINK_KINDS } from "./rules";
import { approvalBlockers, peopleOf, travelBlocks, type TravelLine } from "../timesheets";
import { EXPORT_COLUMNS, fileIsSafe, payRunRows, reviewTravelOf, toCsv, TRAVEL_CHANGED_NOTE, travelChanged, type PayLine } from "../payroll/rules";

// Crew travel worked out from their driver, TP-001, TP-003, TP-005 (Ilies, 24 Nov 2026: "yes build travel as described").
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h, m));
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
let n = 0;
const att = (o: Partial<Att>): Att => ({ id: `a${++n}`, resourceId: "crew", jobId: "j1", date: "2026-11-03", place: null, placeLabel: null, signInAt: at(21), signOutAt: at(30), signOutMethod: "SUPERVISOR_QR", ...o });
const leg = (o: Partial<LegLite>): LegLite => ({ id: `l${++n}`, resourceId: "sup", jobId: "j1", direction: "OUT", startAt: at(19), endAt: at(21), mode: "DRIVER_OWN_VEHICLE", ...o });
const own = (a: Att) => ({ id: a.id, in: a.signInAt, out: a.signOutAt, place: a.place, placeLabel: a.placeLabel });

// Driver D: truck QR 19:00 -> site 21:00 (MOVED), site 21:00 -> 06:00 next day (MOVED into the truck), truck 06:00 -> 08:30.
const truckOut = att({ resourceId: "drv", place: "VEHICLE", placeLabel: "Tipper - CN03RK", jobId: null, signInAt: at(19), signOutAt: at(21), signOutMethod: "MOVED" });
const drvSite = att({ resourceId: "drv", signInAt: at(21), signOutAt: at(30), signOutMethod: "MOVED" });
const truckBack = att({ resourceId: "drv", place: "VEHICLE", placeLabel: "Tipper - CN03RK", jobId: null, signInAt: at(30), signOutAt: at(32, 30) });
const holders = [truckOut, drvSite, truckBack];

test("only link-holders record travel - Start travel is refused without a SUPERVISOR / DRIVER link, on the server", () => {
  assert.deepEqual([...TRAVEL_LINK_KINDS], ["SUPERVISOR", "DRIVER"]);
  assert.equal(linkRefusal(true), null);
  assert.equal(linkRefusal(false), NO_LINK_REFUSAL);
  assert.equal(NO_LINK_REFUSAL, "Travel is recorded by your driver - nothing to do.");
  const store = src("./store.ts");
  // startOut checks the link before anything else; startHome refuses through travelStatus's byDriver.
  assert.match(store, /export async function startOut[\s\S]{0,400}const noLink = linkRefusal\(await hasTravelLink\(resourceId\)\);\s*\n\s*if \(noLink\) return \{ error: noLink, status: 403 \};/);
  assert.match(store, /if \(s\.byDriver\) return \{ error: linkRefusal\(false\)!, status: 403 \};/);
  // TP-007a: held on the trip's date (linkCountsOn) - the phone checks today, the office's lines the trip's own date.
  assert.match(store, /kind: \{ in: \[\.\.\.TRAVEL_LINK_KINDS\] \}, resourceId: \{ in: resourceIds \}, \.\.\.\(activeOnly \? \{ resource: \{ active: true \} \} : \{\}\)/, "the phone: the person still active");
  assert.match(store, /export const hasTravelLink = async \(resourceId: string \| null, date = todaySydney\(\)\)/);
  assert.match(store, /const isHolder = \(a: \{ resourceId: string \| null; date: string \}\) => held\(a\.resourceId!, a\.date\);/, "each sign-in's own date");
  // The phone isn't offered it either: the travel link and Travelling home only for link-holders.
  const sign = src("../../app/api/site/in/sign/route.ts");
  assert.match(sign, /travelLink: regionalWork && \(await hasTravelLink\(resourceId\)\)/);
  assert.match(sign, /regional && \(await hasTravelLink\(who\.resourceId\)\) \? \{ travelHome: true \}/);
  assert.match(sign, /passAllowed\(\{ jobId: s\.jobId, method: s\.method, allocated, regionalWork \}\)/, "AT-001 / the travel pass unchanged");
});

test("crew OUT: the driver's truck sign-in up to their site sign-in; paid 1 hour less", () => {
  const a = att({ signInAt: at(21, 10) });
  const [out] = deriveCrewLegs([a], holders, []);
  assert.equal(out.direction, "OUT");
  assert.equal(out.drive?.kind, "TRUCK");
  assert.equal(out.drive?.driverId, "drv");
  assert.deepEqual([out.drive?.startAt, out.drive?.endAt], [at(19), at(21)], "truck sign-in -> the driver's site sign-in");
  const v = crewLegVerdict(out, [own(a)]);
  assert.deepEqual([v.hours, v.flag], [2, null]);
  assert.equal(paidTravelHours(v.hours, "PASSENGER"), 1, "driver's drive - 1h");
  assert.equal(viaText(out.drive!, "Turori Smith"), "with Turori Smith's truck (Tipper - CN03RK)");
  assert.equal(paidText({ hours: 2, mode: "PASSENGER", via: "with Turori Smith's truck (Tipper - CN03RK)" }), "paid 1h (with Turori Smith's truck (Tipper - CN03RK))");
});

test("crew HOME: matched on their sign-out; the truck sign-in that starts then, up to its sign-out", () => {
  const a = att({ signInAt: at(21, 10), signOutAt: at(29, 50) });
  const home = deriveCrewLegs([a], holders, []).find((c) => c.direction === "HOME")!;
  assert.equal(home.drive?.kind, "TRUCK");
  assert.deepEqual([home.drive?.startAt, home.drive?.endAt], [at(30), at(32, 30)]);
  const v = crewLegVerdict(home, [own(a)]);
  assert.equal(v.hours, 2.5);
  assert.equal(paidTravelHours(v.hours, "PASSENGER"), 1.5);
  // Not signed out, or signed out by signing in somewhere else (MOVED): not going home - no home leg.
  assert.equal(deriveCrewLegs([att({ signOutAt: null })], holders, []).filter((c) => c.direction === "HOME").length, 0);
  assert.equal(deriveCrewLegs([att({ signOutMethod: "MOVED" })], holders, []).filter((c) => c.direction === "HOME").length, 0);
});

test(`matching: within ${CREW_MATCH_MINUTES} min, same job only, the nearest driver, drivers before passengers`, () => {
  assert.equal(findDrive("OUT", "j1", at(21, 30), holders, [])?.kind, "TRUCK", "30 min after is still in");
  // TP-008a: a drive out that arrived more than 10 min after their own site sign-in wasn't their ride.
  assert.equal(findDrive("OUT", "j1", at(20, 30), holders, []), null, "on site 30 min before the truck got there - not their ride");
  assert.equal(findDrive("OUT", "j1", at(20, 50), holders, [])?.kind, "TRUCK", "10 min before the truck got there - still theirs");
  assert.equal(findDrive("OUT", "j1", at(20, 49), holders, []), null, "11 min before - not");
  assert.equal(findDrive("OUT", "j1", at(21, 31), holders, []), null, "31 min after is out");
  assert.equal(findDrive("OUT", "other-job", at(21), holders, []), null, "another job's driver never counts");
  // Two link-holders: the nearest in time wins.
  const supSite = att({ resourceId: "sup", signInAt: at(21, 20) });
  const supLeg = leg({ resourceId: "sup", startAt: at(19, 30), endAt: at(21, 20) });
  // TP-008b: a truck and an own car/ute both match - the truck, even when the car is nearer in time.
  const both = findDrive("OUT", "j1", at(21, 18), [...holders, supSite], [supLeg]);
  assert.deepEqual([both?.driverId, both?.candidates], ["drv", 2], "the truck; TP-008c: 2 drivers possible");
  assert.equal(findDrive("OUT", "j1", at(21, 5), [...holders, supSite], [supLeg])?.driverId, "drv", "the car arrived after their sign-in + 10 min - only the truck");
  assert.equal(findDrive("OUT", "j1", at(21, 5), [...holders, supSite], [supLeg])?.candidates, 1);
  // A passenger's leg only when no driver matched - it's the same trip.
  const pasSite = att({ resourceId: "pas", signInAt: at(21, 1) });
  const pasLeg = leg({ resourceId: "pas", mode: "PASSENGER", startAt: at(19), endAt: at(21, 1) });
  assert.equal(findDrive("OUT", "j1", at(21, 1), [...holders, pasSite], [pasLeg])?.driverId, "drv", "the truck driver, not the passenger next to them");
  const alone = findDrive("OUT", "j1", at(21, 1), [pasSite], [pasLeg]);
  assert.equal(alone?.driverId, "pas", "no driver - the passenger's leg still shows the trip");
  assert.equal(viaText(alone!, "Pat"), "with Pat");
  // A link-holder with no drive recorded (no truck, no leg) isn't a source.
  assert.equal(findDrive("OUT", "j1", at(21), [att({ resourceId: "sup2", signInAt: at(21) })], []), null);
  // Own leg home.
  const homeLeg = leg({ resourceId: "sup", direction: "HOME", startAt: at(30, 10), endAt: at(32, 10) });
  const supOut = att({ resourceId: "sup", signInAt: at(21), signOutAt: at(30), signOutMethod: "SUPERVISOR_QR" });
  const h = findDrive("HOME", "j1", at(30, 5), [supOut], [homeLeg]);
  assert.deepEqual([h?.kind, h?.startAt, h?.endAt, viaText(h!, "Sam")], ["LEG", at(30, 10), at(32, 10), "with Sam (own car/ute)"]);
});

test("no driver found: amber, pays nothing, never blocks the week", () => {
  const a = att({ signInAt: at(23, 30) });
  const [out] = deriveCrewLegs([a], holders, []);
  assert.equal(out.drive, null);
  const v = crewLegVerdict(out, [own(a)]);
  assert.deepEqual([v.hours, v.flag], [null, "NO_DRIVER"]);
  assert.equal(amberFlag("NO_DRIVER"), true);
  assert.equal(needsOffice("NO_DRIVER"), false);
  const line: TravelLine = { legId: "derived:a:OUT", direction: "OUT", date: "2026-11-03", resourceId: "crew", name: "Crew", role: null, jobId: "j1", site: "Orange", start: "?", end: "10:30 am", startAt: "", endAt: null, hours: null, flag: "NO_DRIVER", changedByOffice: null, mode: null, paidHours: null };
  assert.equal(travelBlocks(line), false);
  assert.deepEqual(approvalBlockers([], [line]), []);
  const [p] = peopleOf("2026-11-02", [], [line]);
  assert.equal(p.travelNoDriver, 1);
  assert.equal(p.travelPaidTotal, 0);
});

test("the driver's drive never ended / over 8h: the crew leg counts nothing too, flagged the same", () => {
  const open = att({ resourceId: "drv", place: "VEHICLE", jobId: null, signInAt: at(30), signOutAt: null });
  const a = att({ signInAt: at(21), signOutAt: at(30) });
  const home = deriveCrewLegs([a], [drvSite, open], []).find((c) => c.direction === "HOME")!;
  assert.equal(crewLegVerdict(home, [own(a)], at(40)).flag, "NOT_ENDED");
  const long = att({ resourceId: "drv", place: "VEHICLE", jobId: null, signInAt: at(10), signOutAt: at(21) });
  const [out] = deriveCrewLegs([a], [long, drvSite], []);
  assert.equal(crewLegVerdict(out, [own(a)]).flag, "OVER_CAP");
});

test("TP-001: a recorded or worked-out leg over the person's own sign-ins pays nothing and blocks the week", () => {
  // Recorded: a passenger link-holder's leg 19:00-21:00 while their Yard sign-in ran 18:30-21:00.
  const yard = { id: "y1", in: at(18, 30), out: at(21), place: "YARD", placeLabel: "Yard" };
  assert.deepEqual(legVerdict(at(19), at(21), [yard]), { hours: null, flag: "SIGNIN_OVERLAP" });
  assert.deepEqual(legVerdict(at(19), at(21), [{ ...yard, out: at(19) }]), { hours: 2, flag: null }, "touching end to start is not an overlap");
  assert.deepEqual(legVerdict(at(19), at(21), [{ id: "s", in: at(21), out: at(30) }]), { hours: 2, flag: null }, "the site sign-in that ended it");
  assert.deepEqual(legVerdict(at(10), at(21), [yard]).flag, "OVER_CAP", "a leg already counting nothing keeps its own flag");
  assert.equal(needsOffice("SIGNIN_OVERLAP"), true);
  const line: TravelLine = { legId: "l", direction: "OUT", date: "2026-11-03", resourceId: "r", name: "Pat", role: null, jobId: "j1", site: "Orange", start: "6:00 am", end: "8:00 am", startAt: "", endAt: null, hours: null, flag: "SIGNIN_OVERLAP", changedByOffice: null, mode: "PASSENGER", paidHours: null };
  assert.equal(travelBlocks(line), true);
  assert.deepEqual(approvalBlockers([], [line]), ["Pat (2026-11-03: travel overlaps a sign-in)"]);
  // Worked out: crew C signed in at the Yard 18:30 and only signed in on site at 21:10 (the Yard sign-in MOVED then).
  const yardC = att({ place: "YARD", placeLabel: "Yard", jobId: null, signInAt: at(18, 30), signOutAt: at(21, 10), signOutMethod: "MOVED" });
  const siteC = att({ signInAt: at(21, 10) });
  const [out] = deriveCrewLegs([siteC], holders, []);
  const v = crewLegVerdict(out, [own(yardC), own(siteC)], at(40), { site: "Orange hospital", driver: "Turori Smith" });
  assert.deepEqual([v.hours, v.flag], [null, "SIGNIN_OVERLAP"]);
  assert.equal(paidTravelHours(v.hours, "PASSENGER"), null, "pays nothing");
  // ...but never the sign-in it's matched on (their own site sign-in, a few minutes before the driver's).
  const early = att({ signInAt: at(20, 50) });
  assert.equal(crewLegVerdict(deriveCrewLegs([early], holders, [])[0], [own(early)]).flag, null);
});

test("option A (Ilies, 24 Nov 2026): one tap ends the Yard sign-in at the departure, the overlap clears, paid = drive - 1h", () => {
  const yardC = att({ place: "YARD", placeLabel: "Yard", jobId: null, signInAt: at(18, 30), signOutAt: at(21, 10), signOutMethod: "MOVED" });
  const siteC = att({ signInAt: at(21, 10) });
  const [out] = deriveCrewLegs([siteC], holders, []);
  const v = crewLegVerdict(out, [own(yardC), own(siteC)], at(40), { site: "Orange hospital", driver: "Turori Smith" });
  assert.deepEqual(v.pointFix, {
    attendanceId: yardC.id, signOutAt: at(19).toISOString(), currentSignOutAt: at(21, 10).toISOString(), label: "End yard sign-in when the truck left",
    reason: "Rode to Orange hospital with Turori Smith - travel counted instead (option A, Ilies 24 Nov 2026)",
  });
  // The office presses it: the Yard sign-in now ends when the truck left.
  const fixed = { ...yardC, signOutAt: new Date(v.pointFix!.signOutAt) };
  const after = crewLegVerdict(out, [own(fixed), own(siteC)], at(40));
  assert.deepEqual([after.hours, after.flag, after.pointFix], [2, null, null]);
  assert.equal(paidTravelHours(after.hours, "PASSENGER"), 1);
  // Only for a drive out over exactly one Yard / Office sign-in that started before the departure - never automatic.
  assert.equal(pointFixFor("HOME", [own(yardC)], at(19), { site: "x", driver: null, truck: true }), null);
  assert.equal(pointFixFor("OUT", [own(att({ place: "VEHICLE" }))], at(19), { site: "x", driver: null, truck: true }), null, "not a truck sign-in");
  assert.equal(pointFixFor("OUT", [own(att({ place: "YARD", signInAt: at(19, 30) }))], at(19), { site: "x", driver: null, truck: true }), null, "started after the departure");
  assert.equal(pointFixFor("OUT", [own(yardC), own(att({ place: "OFFICE", signInAt: at(18) }))], at(19), { site: "x", driver: null, truck: true }), null, "two of them - the office sorts it");
  assert.equal(pointFixFor("OUT", [own(att({ place: "OFFICE", signInAt: at(18) }))], at(19), { site: "x", driver: null, truck: false })?.label, "End office sign-in when travel started");
  // The button is the ordinary office sign-in change (Manager+, AttendanceEdit with the reason, locked weeks refuse).
  const ui = src("../../components/attendance/TravelLegs.tsx");
  assert.match(ui, /apiFetch\(`\/api\/attendance\/\$\{f\.attendanceId\}`, \{\s*method: "PATCH"[\s\S]{0,120}JSON\.stringify\(\{ signOutAt: f\.signOutAt, reason: f\.reason \}\)/);
  assert.doesNotMatch(src("./store.ts"), /siteAttendance\.update/, "travel never changes a sign-in itself");
  assert.doesNotMatch(src("./derive.ts"), /prisma/, "the rules are plain code");
});

test("a recorded leg for that person, job and way is used instead of the worked-out one; nothing stored for crew", () => {
  const store = src("./store.ts");
  assert.match(store, /\.filter\(\(c\) => !recorded\.has\(`\$\{c\.resourceId\}\|\$\{c\.jobId\}\|\$\{c\.direction\}`\)\)/);
  assert.match(store, /legId: `derived:\$\{c\.anchor\.id\}:\$\{c\.direction\}`/);
  // One loader for Sign-ins, Timesheets (and so the approved snapshot) and accounts' Payroll.
  assert.match(store, /export const travelLinesForWeek = \(weekStart: string\) => travelLinesBetween\(weekStart, weekEnd\(weekStart\)\);/);
  assert.match(src("../payroll/store.ts"), /const lines = await travelLinesBetween\(weekStart, weekEnd\(weekStart\)\);/);
  // The office's own leg: Manager+, a reason, TravelEdit "added", locked weeks refuse, never over a sign-in.
  const add = store.slice(store.indexOf("export async function addTravelLeg"));
  assert.match(add, /lockedWeekFor\(date\)/);
  assert.match(add, /field: "added", before: null/);
  assert.match(add, /Those times run over one of their sign-ins/);
  assert.match(src("../../app/api/attendance/travel/route.ts"), /guard\("MANAGER"\)[\s\S]*reason\.length < 3/);
});

test("TP-003: Victoria's approval keeps the travel she approved on; a change drops the person from the pay-run", () => {
  const p = { travelPaidHours: 3, travelModeMissing: 0, travelNoDriver: 1 };
  const snap = JSON.stringify({ lines: [], travel: reviewTravelOf(p) });
  assert.deepEqual(reviewTravelOf(p), { paidHours: 3, toCheck: 1 });
  assert.equal(travelChanged(snap, reviewTravelOf(p)), false, "same travel - stays in");
  assert.equal(travelChanged(snap, reviewTravelOf({ ...p, travelPaidHours: 3.5 })), true, "paid hours changed");
  assert.equal(travelChanged(snap, reviewTravelOf({ ...p, travelNoDriver: 0 })), true, "a no-driver leg was fixed after she approved");
  assert.equal(travelChanged(JSON.stringify([{ attendanceId: "a1" }]), reviewTravelOf(p)), false, "an older review (no travel part) is left as it is");
  assert.equal(travelChanged("not json", reviewTravelOf(p)), false);
  assert.equal(TRAVEL_CHANGED_NOTE, "Travel changed since you approved - approve again");
  const store = src("../payroll/store.ts");
  assert.match(store, /travel: reviewTravelOf\(p\),/, "stored at her approval");
  assert.match(store, /travelChanged\(reviews\.get\(p\.personKey\)\?\.snapshot, reviewTravelOf\(p\)\)\) \{\s*p\.inPayRun = false;/);
});

test("TP-005: 'Travel paid hours' is the last pay-run column; number columns are numbers or blank", () => {
  assert.equal(EXPORT_COLUMNS[EXPORT_COLUMNS.length - 1], "Travel paid hours");
  assert.deepEqual(EXPORT_COLUMNS.slice(0, 8), ["Employee", "Email", "Earnings Rate", "Date", "Hours", "Site", "Travel hours", "Of which tip run hours"], "the columns the import already maps keep their places");
  const L = (o: Partial<PayLine>): PayLine => ({ attendanceId: "a", date: "2026-11-03", personKey: "r1", personName: "Crew One", resourceId: "r1", company: null, group: "EMPLOYEE", engagementSet: true, jobId: "j1", shift: "DAY", site: "Orange", point: false, in: "8:10 am", out: "5:00 pm", hours: 8, status: "CONFIRMED", tile: null, gps: null, gpsStatus: null, ...o });
  const rows = payRunRows([L({}), L({ attendanceId: "b", date: "2026-11-04" })], new Set(["r1"]), new Map([["r1", null]]), new Map([
    ["r1|2026-11-03", { hours: 4.5, paid: 2.5, modeMissing: false, site: "Orange", name: "Crew One" }],
    ["r1|2026-11-04", { hours: 2, paid: 0, modeMissing: true, site: "Orange", name: "Crew One" }],
  ]));
  assert.deepEqual(rows[1].slice(-3), [4.5, "", 2.5]);
  assert.deepEqual(rows[2].slice(-3), [2, "", ""], "no mode recorded: blank, never text");
  for (const r of rows.slice(1)) for (const i of [4, 6, 7, 8]) assert.ok(r[i] === "" || typeof r[i] === "number", `column ${i}: ${r[i]}`);
  assert.ok(fileIsSafe(toCsv(rows)));
});

test("cut at their own sign-in: out ends at the earlier of the driver's arrival and their site sign-in; home starts at the later; -1h after the cut", () => {
  // B signed in on site at 7:52 (20:52), before the driver arrived at 8:00: travel 6:00 -> 7:52 = 1.75h, paid 0.75h.
  const b = att({ signInAt: at(20, 52), signOutAt: at(30, 20) });
  const [out, home] = deriveCrewLegs([b], holders, []);
  assert.deepEqual(crewWindow(out), { startAt: at(19), endAt: at(20, 52) });
  assert.equal(crewLegVerdict(out, [own(b)]).hours, 1.75);
  assert.equal(paidTravelHours(1.75, "PASSENGER"), 0.75);
  // Signed out at 5:20pm (30:20), after the truck left at 5pm: home from 5:20 to 7:30 = 2.25h, paid 1.25h.
  assert.deepEqual(crewWindow(home), { startAt: at(30, 20), endAt: at(32, 30) });
  assert.equal(crewLegVerdict(home, [own(b)]).hours, 2.25);
  // Driver arrived first / left last: the driver's own times.
  const a = att({ signInAt: at(21, 10), signOutAt: at(29, 50) });
  const [o2, h2] = deriveCrewLegs([a], holders, []);
  assert.deepEqual([crewWindow(o2)?.endAt, crewWindow(h2)?.startAt], [at(21), at(30)]);
  // Signed in before the drive even started: 0h, paid 0 - never below 0.
  const z = att({ signInAt: at(18, 52) });
  const zl = deriveCrewLegs([z], [att({ resourceId: "drv", place: "VEHICLE", jobId: null, signInAt: at(18, 30), signOutAt: at(19), signOutMethod: "MOVED" }), att({ resourceId: "drv", signInAt: at(19) })], [])[0];
  assert.equal(crewLegVerdict(zl, [own(z)]).hours, 0.25);
  assert.equal(paidTravelHours(0.25, "PASSENGER"), 0);
  // The driver's drive not ended (own leg on the way) but they're on site: their sign-in ends it.
  const supSite = att({ resourceId: "sup", signInAt: at(21) });
  const open = findDrive("OUT", "j1", at(21), [supSite], [leg({ resourceId: "sup", startAt: at(19), endAt: null })]);
  assert.deepEqual(crewWindow({ resourceId: "crew", jobId: "j1", date: "x", direction: "OUT", anchor: att({}), anchorAt: at(21, 5), drive: open }), { startAt: at(19), endAt: at(21, 5) });
});

test("a crew member's own truck QR sign-in on that drive stands: no worked-out leg that way, no overlap flag", () => {
  // G rode in on the truck and scanned its QR (6:00 -> 8:00, moved off it by the site sign-in): out is their sign-in.
  const gTruck = att({ resourceId: "g", place: "VEHICLE", jobId: null, signInAt: at(19), signOutAt: at(21), signOutMethod: "MOVED" });
  const gSite = att({ resourceId: "g", signInAt: at(21), signOutAt: at(30) });
  const legs = deriveCrewLegs([gSite], holders, [], [gTruck]);
  assert.deepEqual(legs.map((l) => l.direction), ["HOME"], "no worked-out out leg - and so nothing to flag");
  assert.equal(crewLegVerdict(legs[0], [own(gTruck), own(gSite)]).hours, 2.5, "home still worked out from the driver");
  // ...even with no driver found (their own truck sign-in ends at their site sign-in).
  const lone = att({ resourceId: "g", signInAt: at(23, 30) });
  const loneTruck = att({ resourceId: "g", place: "VEHICLE", jobId: null, signInAt: at(21, 30), signOutAt: at(23, 30), signOutMethod: "MOVED" });
  assert.equal(deriveCrewLegs([lone], holders, [], [loneTruck]).filter((l) => l.direction === "OUT").length, 0);
  // Someone else's truck sign-in, or a Yard sign-in, doesn't count as theirs.
  assert.equal(ownTruckCovers(deriveCrewLegs([gSite], holders, [])[0], [{ ...gTruck, resourceId: "other" }]), false);
  assert.equal(ownTruckCovers(deriveCrewLegs([gSite], holders, [])[0], [{ ...gTruck, place: "YARD" }]), false);
  // The store passes the crew's own truck sign-ins in.
  assert.match(src("./store.ts"), /deriveCrewLegs\(crewAtts, holderAtts, holderLegs, crewTrucks\)/);
});
test("TP-007a: who held a link is read on the trip's date", () => {
  const made = (d: string) => new Date(`${d}T02:00:00Z`); // midday-ish in Sydney
  // A link made after a trip: on the trip's day they were crew - that trip is still worked out from the driver.
  assert.equal(linkCountsOn({ createdAt: made("2026-11-20"), revokedAt: null }, "2026-11-18"), false);
  assert.equal(linkCountsOn({ createdAt: made("2026-11-20"), revokedAt: null }, "2026-11-20"), true, "made that day counts");
  // A link switched off later: its past days still count (their own legs stand, and crew are worked out from them).
  const off = { createdAt: made("2026-11-01"), revokedAt: made("2026-11-22") };
  assert.equal(linkCountsOn(off, "2026-11-18"), true);
  assert.equal(linkCountsOn(off, "2026-11-22"), false, "switched off that day - not after it");
  assert.equal(linkCountsOn(off, "2026-11-23"), false);
  // Sydney's date, not UTC's: made 9pm UTC on the 17th = 8am on the 18th in Sydney.
  assert.equal(linkCountsOn({ createdAt: new Date("2026-11-17T21:00:00Z"), revokedAt: null }, "2026-11-17"), false);
  const store = src("./store.ts");
  assert.match(store, /const noLink = linkRefusal\(await hasTravelLink\(resourceId\)\);/, "the phone: today");
});

test("TP-008: truck arriving 9:00, own car arriving 9:30, crew on site 9:28 - the truck; '2 drivers possible'", () => {
  const nine = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 2, h - 11, m)); // Sydney (UTC+11)
  const truckIn = att({ resourceId: "drv", place: "VEHICLE", jobId: null, signInAt: nine(7), signOutAt: nine(9), signOutMethod: "MOVED" });
  const drvSite9 = att({ resourceId: "drv", signInAt: nine(9) });
  const carSite = att({ resourceId: "sup", signInAt: nine(9, 30) });
  const car = leg({ resourceId: "sup", startAt: nine(7, 30), endAt: nine(9, 30) });
  const d = findDrive("OUT", "j1", nine(9, 28), [truckIn, drvSite9, carSite], [car]);
  assert.deepEqual([d?.kind, d?.driverId, d?.candidates], ["TRUCK", "drv", 2]);
  assert.equal(driversPossibleText(d?.candidates), "2 drivers possible");
  assert.equal(driversPossibleText(1), "");
  // Information only: never a flag, never a blocker.
  const crew = att({ signInAt: nine(9, 28) });
  const [out] = deriveCrewLegs([crew], [truckIn, drvSite9, carSite], [car]);
  assert.deepEqual([crewLegVerdict(out, [own(crew)]).flag, crewLegVerdict(out, [own(crew)]).hours], [null, 2]);
  assert.match(src("./store.ts"), /\.\.\.\(\(c\.drive\?\.candidates \?\? 0\) > 1 \? \{ driversPossible: c\.drive!\.candidates \} : \{\}\)/);
});

test("TP-010: a tip run during travel is worked time - the leg counts nothing (SIGNIN_OVERLAP); tip runs refuse during travel", () => {
  const run = { id: "tiprun:t1", in: at(30, 30), out: at(31, 30), place: "TIP_RUN", placeLabel: "Tip run" };
  assert.deepEqual(legVerdict(at(30), at(32), [run]), { hours: null, flag: "SIGNIN_OVERLAP" });
  const a = att({ signInAt: at(21, 10), signOutAt: at(29, 50) });
  const home = deriveCrewLegs([a], holders, []).find((c) => c.direction === "HOME")!;
  assert.equal(crewLegVerdict(home, [own(a), run]).flag, "SIGNIN_OVERLAP", "worked-out legs too");
  assert.equal(pointFixFor("OUT", [run], at(30), { site: "x", driver: null, truck: true }), null, "no one-tap fix for a tip run");
  const store = src("./store.ts");
  assert.match(store, /const runs = await prisma\.tipRun\.findMany\(/, "ownSignIns loads their tip runs");
  assert.match(store, /id: `tiprun:\$\{r\.id\}`, in: r\.startAt, out: end/);
  // ...and a tip run never starts while travel is open (lib/tipRun/store.ts).
  assert.match(src("../tipRun/store.ts"), /prisma\.travelLeg\.count\(\{ where: \{ resourceId, endAt: null,/);
});

test("TP-009: the office's added leg - never over their other travel, on the job's day +-1, never your own", () => {
  const add = src("./store.ts").slice(src("./store.ts").indexOf("export async function addTravelLeg"));
  assert.match(add, /if \(await isSelf\(who\.id, resourceId, person\.name\)\) return \{ error: "Ask another Manager to add your own travel\.", status: 403 \};/);
  assert.match(add, /The times need to be on the job's day \(or the day either side\)\./);
  assert.match(add, /await travelLinesBetween\(shiftDate\(date, -1\), shiftDate\(date, 1\)\)/, "recorded and worked-out legs");
  assert.match(add, /!\(l\.derived && l\.jobId === jobId && l\.direction === direction\)/, "not the worked-out leg it takes the place of");
  assert.match(src("./store.ts"), /linked\.some\(\(u\) => sameUser\(u\.id, userId\)\)/, "lib/samePerson.ts: any of their logins");
  assert.match(src("../../app/api/attendance/travel/route.ts"), /addTravelLeg\(body, reason, \{ id: user\.id, name: user\.name \}\)/);
});

test("TP-007b: only an Admin makes a driver link; TP-011: the yard button asks first", () => {
  const route = src("../../app/api/site-links/route.ts");
  assert.match(route, /if \(kind === "DRIVER" && \(await guard\("ADMIN"\)\)\) return NextResponse\.json\(\{ error: "Only an Admin can make a driver link\." \}, \{ status: 403 \}\);/);
  assert.match(src("../../app/tools/site/page.tsx"), /isAdmin\s*\? drivers\.map/);
  assert.match(src("../../components/attendance/TravelLegs.tsx"), /if \(!window\.confirm\(`\$\{f\.label\}\?\\n\\nTheir sign-out changes from \$\{t\(f\.currentSignOutAt\)\} to \$\{t\(f\.signOutAt\)\}/);
});

test("refusals that hold whatever they pick come before the mode question (truck, open travel, tip run)", () => {
  const store = src("./store.ts");
  const out = store.slice(store.indexOf("export async function startOut"), store.indexOf("export async function startHome"));
  assert.ok(out.indexOf("tipRunOpen(resourceId)") < out.indexOf("modeRefusal(b.mode)") && out.indexOf("onTruckNow(resourceId)") < out.indexOf("modeRefusal(b.mode)"));
  const home = store.slice(store.indexOf("export async function startHome"), store.indexOf("export async function arrive"));
  assert.ok(home.indexOf("tipRunOpen(resourceId)") < home.indexOf("modeRefusal(b.mode)") && home.indexOf("onTruckNow(resourceId)") < home.indexOf("modeRefusal(b.mode)"));
});