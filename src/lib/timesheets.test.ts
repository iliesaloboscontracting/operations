import { test } from "node:test";
import assert from "node:assert/strict";
import { showEditValue, timesheetCsv } from "./timesheets";

// SEC-012 (27 Oct 2026): a name or note that starts like a formula never becomes one when accounts open the CSV.
test("the timesheet CSV neutralises spreadsheet formulas", () => {
  const line = {
    attendanceId: "a1", date: "2026-10-20", resourceId: "r1", name: "=HYPERLINK(\"http://evil.example\",\"x\")", role: "+Labourer", site: "@Site",
    in: "7:00 am", out: "3:30 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: "\tnote",
  };
  const csv = timesheetCsv("2026-10-20", [line], null);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`), csv);
  assert.ok(csv.includes(`"'+Labourer"`));
  assert.ok(csv.includes(`"'@Site"`));
  assert.ok(!/(^|,)=/m.test(csv), "no cell starts with =");
});

// 26 Oct 2026: a sign-in added by hand ("added", stored as "<in> - <out|open>")
// threw "Invalid time value" and took the whole week's timesheets down.
test("an edit note never throws, whatever was stored", () => {
  assert.equal(showEditValue("added", "2026-10-25T18:30:00.000Z - open"), "5:30 am - open");
  assert.match(showEditValue("added", "2026-10-25T18:30:00.000Z - 2026-10-26T04:00:00.000Z"), /^5:30 am - 3:00 pm$/);
  assert.equal(showEditValue("signOutAt", "2026-10-23T04:30:00.000Z"), "3:30 pm");
  assert.equal(showEditValue("status", "TO_CONFIRM"), "to confirm");
  assert.equal(showEditValue("signInAt", null), "none");
  assert.equal(showEditValue("somethingElse", "not a time"), "not a time");
});
