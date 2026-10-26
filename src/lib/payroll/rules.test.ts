// Accounts stage 2 - payroll rules (docs/accounts/STAGE2-DESIGN.md): the supervisor's day approval (and
// "changed since"), pay items, who Victoria can approve and who goes in the pay-run file, the files (hours
// only, CSV-safe), GPS parsing, and the person key for hire workers. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccountsApprove, csvCell, dayState, fileIsSafe, groupOf, inPayRun, parseGps, payRunRows, payTierOf, personKeyOf, summarise, toCsv, type PayLine } from "./rules";

const L = (x: Partial<PayLine> = {}): PayLine => ({
  attendanceId: "a1", date: "2026-10-27", personKey: "r1", personName: "Sam Smith", resourceId: "r1", company: null, group: "EMPLOYEE", engagementSet: true,
  jobId: "j1", shift: "DAY", site: "Myers", point: false, in: "7:00 am", out: "3:30 pm", hours: 8, status: "CONFIRMED", tile: null, gps: null, gpsStatus: null, ...x,
});

test("the supervisor's day: approved, flagged, changed since, not approved, and points with no supervisor", () => {
  const snap = [{ attendanceId: "a1", name: "Sam", company: null, in: "7:00 am", out: "3:30 pm", hours: 8 }];
  assert.equal(dayState(L(), snap), "APPROVED");
  assert.equal(dayState(L(), [{ ...snap[0], flag: "left at 1pm" }]), "FLAGGED");
  assert.equal(dayState(L({ out: "4:00 pm", hours: 8.5 }), snap), "CHANGED", "the office changed the sign-out after the supervisor approved");
  assert.equal(dayState(L({ attendanceId: "a2" }), snap), "NOT_APPROVED", "a sign-in the approval didn't include");
  assert.equal(dayState(L(), null), "NOT_APPROVED");
  assert.equal(dayState(L({ jobId: null }), null), "NO_SUPERVISOR", "office / yard / truck sign-in");
});

test("pay items follow the cost tiers: weekday ordinary / night, Saturday, Sunday; points are day work", () => {
  assert.equal(payTierOf(L({ date: "2026-10-27" })), "ORDINARY"); // Tuesday
  assert.equal(payTierOf(L({ date: "2026-10-27", shift: "NIGHT" })), "NIGHT");
  assert.equal(payTierOf(L({ date: "2026-10-31" })), "SATURDAY");
  assert.equal(payTierOf(L({ date: "2026-11-01", shift: "NIGHT" })), "SUNDAY");
  assert.equal(payTierOf(L({ date: "2026-10-27", shift: "NIGHT", point: true })), "ORDINARY", "a yard sign-in has no night shift");
});

test("who Victoria can approve, and who goes in the pay-run file", () => {
  assert.match(canAccountsApprove("EMPLOYEE", false, true)!, /Manager hasn't approved and locked/);
  assert.equal(canAccountsApprove("EMPLOYEE", true, true), null);
  assert.equal(canAccountsApprove("HIRE", false, true), null, "labour hire isn't on the Manager timesheet");
  assert.match(canAccountsApprove("HIRE", true, false)!, /hasn't finished/);
  assert.equal(inPayRun("EMPLOYEE", "APPROVED"), true);
  assert.equal(inPayRun("EMPLOYEE", "QUERY"), false);
  assert.equal(inPayRun("ABN", "APPROVED"), false, "ABN workers invoice");
  assert.equal(inPayRun("HIRE", "APPROVED"), false, "labour hire is paid on the agency's invoice");
  assert.equal(groupOf(null, null), "HIRE");
  assert.equal(groupOf("r1", "ABN"), "ABN");
  assert.equal(groupOf("r1", null), "EMPLOYEE", "not set yet counts as an employee (flagged on screen)");
});

test("the pay-run file: approved employees only, hours per person, pay item and day, summed; travel hook", () => {
  const lines = [
    L({ attendanceId: "a1", hours: 4, site: "Myers" }), L({ attendanceId: "a2", hours: 3.5, site: "Bronte" }), // same day, two sites
    L({ attendanceId: "a3", date: "2026-10-31", hours: 6 }),
    L({ attendanceId: "a4", personKey: "r2", personName: "Not Approved", resourceId: "r2", hours: 8 }),
    L({ attendanceId: "a5", hours: null, out: null }), // no sign-out - nothing to pay
  ];
  const rows = payRunRows(lines, new Set(["r1"]), new Map([["r1", "sam@example.com"]]));
  assert.deepEqual(rows[0], ["Employee", "Email", "Earnings Rate", "Date", "Hours", "Site", "Travel"]);
  assert.deepEqual(rows.slice(1), [
    ["Sam Smith", "sam@example.com", "Ordinary Hours", "2026-10-27", 7.5, "Myers / Bronte", "rule to be agreed"],
    ["Sam Smith", "sam@example.com", "Saturday Hours", "2026-10-31", 6, "Myers", "rule to be agreed"],
  ]);
  const csv = toCsv(rows);
  assert.ok(fileIsSafe(csv));
  assert.equal(fileIsSafe(csv + "Rate $45\r\n"), false);
  assert.equal(fileIsSafe("Employee,BSB\r\n"), false, "no bank details");
  assert.equal(fileIsSafe("Employee,TFN\r\n"), false, "no tax file numbers");
});

test("CSV cells: quotes, commas and line breaks escaped; spreadsheet formulas neutralised", () => {
  assert.equal(csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(7.5), "7.5");
});

test("the weekly summary: by person, pay item, site and agency", () => {
  const s = summarise([
    L({ hours: 8 }), L({ attendanceId: "b", date: "2026-11-01", hours: 5 }),
    L({ attendanceId: "c", personKey: "hire:joe|staffco", personName: "Joe", resourceId: null, company: "StaffCo", group: "HIRE", hours: 7.75 }),
  ], new Map([["r1", "APPROVED"]]));
  assert.equal(s.total, 20.75);
  assert.deepEqual(s.byItem, { "Ordinary Hours": 15.75, "Sunday Hours": 5 });
  assert.deepEqual(s.byAgency, { StaffCo: 7.75 });
  const sam = s.people.find((p) => p.personKey === "r1")!;
  assert.deepEqual([sam.hours, sam.days, sam.review], [13, 2, "APPROVED"]);
});

test("GPS at sign-in: kept when good, a reason when not, junk dropped - never an error", () => {
  assert.deepEqual(parseGps({ status: "OK", lat: -33.8688123456, lng: 151.2093, accuracy: 12.7 }), { gpsLat: -33.868812, gpsLng: 151.2093, gpsAccuracyM: 13, gpsStatus: "OK" });
  assert.deepEqual(parseGps({ status: "DENIED" }), { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsStatus: "DENIED" });
  assert.deepEqual(parseGps({ status: "OK", lat: 999, lng: 151 }), { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsStatus: "UNAVAILABLE" }, "an impossible position isn't kept");
  assert.deepEqual(parseGps({ status: "HACKED", lat: 1, lng: 1 }), { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsStatus: null });
  assert.deepEqual(parseGps(undefined), { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsStatus: null }, "an older phone page sends nothing");
});

test("a hire worker's key: same person and company, however they typed it", () => {
  assert.equal(personKeyOf(null, " Joe  Bloggs ", "StaffCo"), personKeyOf(null, "joe bloggs", "staffco"));
  assert.notEqual(personKeyOf(null, "Joe Bloggs", "StaffCo"), personKeyOf(null, "Joe Bloggs", "OtherCo"));
  assert.equal(personKeyOf("r1", "Sam", null), "r1");
});
