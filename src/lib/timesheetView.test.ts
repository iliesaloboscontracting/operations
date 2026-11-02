import { test } from "node:test";
import assert from "node:assert/strict";
import { allPlaces, mondayOf } from "./timesheetView";
import { peopleOf, type TimesheetLine } from "./timesheets";

// 2 Nov 2026 (Ilies, after "Turori ... not recorded in the timesheets page"): display only.
test("?week= opens the week the date falls in", () => {
  assert.equal(mondayOf("2026-10-30"), "2026-10-26", "a Friday -> its Monday");
  assert.equal(mondayOf("2026-10-26"), "2026-10-26", "a Monday stays");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26", "a Sunday belongs to the week before");
  for (const bad of [null, "", "2026-13-01", "2026-02-30", "30/10/2026", "2026-10-30T00:00"]) assert.equal(mondayOf(bad), null, String(bad));
});

const line = (o: Partial<TimesheetLine>): TimesheetLine => ({
  attendanceId: "a", date: "2026-10-26", resourceId: "r1", name: "Turori", role: "Driver", site: "Jannali", in: "7:00 am", out: "3:30 pm",
  breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null, ...o,
});

test("a By-site box shows the person's whole week and where else they signed in", () => {
  const lines = [
    line({ attendanceId: "a1", date: "2026-10-26", site: "Jannali", out: null, hours: null }),
    line({ attendanceId: "a2", date: "2026-10-27", site: "Tipper - CN03RK", hours: 8.75 }),
    line({ attendanceId: "a3", date: "2026-10-28", site: "Tipper - CN03RK", hours: 9 }),
    line({ attendanceId: "a4", date: "2026-10-29", site: "Tipper - CN03RK", hours: 8.75 }),
    line({ attendanceId: "a5", date: "2026-10-30", site: "Tipper - CN03RK", hours: 8.75 }),
  ];
  const [p] = peopleOf("2026-10-26", lines);
  assert.deepEqual(allPlaces(p, "Jannali"), { total: 35.25, travelTotal: 0, also: ["Tipper - CN03RK"] }, "the Jannali box says 35.25h, also the truck");
  assert.deepEqual(allPlaces(p, "Tipper - CN03RK").also, ["Jannali"]);
  const [only] = peopleOf("2026-10-26", [line({})]);
  assert.deepEqual(allPlaces(only, "Jannali").also, [], "only this box: no 'also'");
});
