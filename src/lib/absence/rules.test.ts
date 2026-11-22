// "Not in today" (23 Nov 2026, Ilies: "yes build it, alex can too") - the plain rules, and the source checks that keep
// the routes and the store to what was agreed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  absenceCsvNotes, absenceViews, cancelRefusal, DUPLICATE_REFUSAL, LOCKED_WEEK_REFUSAL, markedButSignedIn, markedButSignedInText,
  markRefusal, noSignInCount, parseCancel, parseMark, timesheetDayCell, unexplained, type AbsenceLine, type AbsenceRow,
} from "./rules";
import { flagSummary } from "../signinFlags";
import { peopleOf, timesheetCsv, type TimesheetLine } from "../timesheets";
import { accountsTimesheetCsv } from "../accountsTimesheets";
import { fileIsSafe } from "../payroll/rules";
import { coordinatorOr } from "../roles";

const TODAY = "2026-11-23";
const row = (o: Partial<AbsenceRow> = {}): AbsenceRow => ({
  id: "m1", resourceId: "r1", date: TODAY, reason: "SICK", note: null, createdBy: "Alex", createdAt: new Date("2026-11-22T20:40:00Z"),
  cancelledAt: null, cancelledBy: null, cancelReason: null, ...o,
});
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("input: Sick or Not in, today or earlier, a short note with no amount, bank or tax detail", () => {
  const ok = parseMark({ resourceId: "r1", date: TODAY, reason: "SICK", note: "  rang in   at 6am " }, TODAY);
  assert.deepEqual(ok, { ok: true, value: { resourceId: "r1", date: TODAY, reason: "SICK", note: "rang in at 6am" } });
  assert.deepEqual(parseMark({ resourceId: "r1", date: "2026-11-20", reason: "NOT_IN" }, TODAY), { ok: true, value: { resourceId: "r1", date: "2026-11-20", reason: "NOT_IN", note: null } });
  const bad = (b: Record<string, unknown>) => { const r = parseMark({ resourceId: "r1", date: TODAY, reason: "SICK", ...b }, TODAY); return r.ok ? null : r.error; };
  assert.match(bad({ date: "2026-11-24" })!, /today or an earlier day/, "a future day is refused");
  assert.match(bad({ date: "2026-02-30" })!, /Pick the day/);
  assert.match(bad({ reason: "HOLIDAY" })!, /Sick or Not in/);
  assert.match(bad({ resourceId: "" })!, /who/);
  assert.match(bad({ note: "owes $50 for fuel" })!, /No amounts/);
  assert.match(bad({ note: "TFN 123 456 782" })!, /bank, tax or rate/);
  assert.match(bad({ note: "BSB 062-000 acct 12345678" })!, /bank, tax or rate/);
  assert.match(bad({ note: "x".repeat(201) })!, /under 200/);
  // Undo needs a reason - also no amounts.
  assert.deepEqual(parseCancel({ reason: " wrong person " }), { ok: true, reason: "wrong person" });
  assert.equal(parseCancel({ reason: "no" }).ok, false);
  assert.equal(parseCancel({}).ok, false);
  assert.equal(parseCancel({ reason: "paid him $200" }).ok, false);
});

test("one live mark per person per day - a second is refused until the first is undone", () => {
  assert.equal(markRefusal({ lockedWeek: null, active: null }), null, "nothing there: can mark");
  assert.deepEqual(markRefusal({ lockedWeek: null, active: { reason: "SICK" } }), { error: DUPLICATE_REFUSAL("Sick"), status: 409 });
  // An undone mark doesn't stop a new one; the views keep both.
  const v = absenceViews([row({ id: "old", cancelledAt: new Date("2026-11-22T21:00:00Z"), cancelledBy: "Ilies", cancelReason: "wrong person" }), row({ id: "new", reason: "NOT_IN", createdAt: new Date("2026-11-22T21:05:00Z") })], new Set()).get(`r1|${TODAY}`)!;
  assert.equal(v.active?.id, "new");
  assert.equal(v.active?.label, "Not in");
  assert.equal(v.cancelled.length, 1, "the undone mark is kept as history");
  assert.equal(v.cancelled[0].cancelReason, "wrong person");
  // The store makes the check inside one locked transaction (two taps at once can't make two).
  const store = src("./store.ts");
  assert.match(store, /\$transaction\(async \(tx\) => \{\s*await writeLock\(tx\);[\s\S]*findFirst\(\{ where: \{ resourceId: input\.resourceId, date: input\.date, cancelledAt: null \}/);
});

test("a locked (approved) week refuses marking and undoing", () => {
  assert.deepEqual(markRefusal({ lockedWeek: "2026-11-16", active: null }), { error: LOCKED_WEEK_REFUSAL, status: 409 });
  assert.deepEqual(cancelRefusal({ row: { cancelledAt: null }, lockedWeek: "2026-11-16" }), { error: LOCKED_WEEK_REFUSAL, status: 409 });
  assert.equal(cancelRefusal({ row: { cancelledAt: null }, lockedWeek: null }), null);
  assert.equal(cancelRefusal({ row: { cancelledAt: new Date() }, lockedWeek: null })?.status, 409, "already undone");
  assert.equal(cancelRefusal({ row: null, lockedWeek: null })?.status, 404);
  assert.match(src("./store.ts"), /lockedWeekFor\(input\.date\)[\s\S]*lockedWeekFor\(row\.date\)/, "the store asks the timesheet lock for both");
});

test("a marked person stops counting as an unexplained no-show", () => {
  const marked = absenceViews([row()], new Set()).get(`r1|${TODAY}`)!;
  const noShows = [
    { id: "r1", name: "A", staff: true, nowhere: true, absence: marked },
    { id: "r2", name: "B", staff: true, nowhere: true },
    { id: "r3", name: "C", staff: true, nowhere: false },
    { id: "tile", name: "Labour hire", hireTile: true, absence: absenceViews([row({ resourceId: "tile" })], new Set()).get(`tile|${TODAY}`)! },
  ];
  assert.equal(noSignInCount(noShows), 1, "only B - no sign-in anywhere and not marked");
  assert.deepEqual(unexplained(noShows).map((n) => n.id), ["r2", "r3"], "the 'Expected, not signed in' count leaves out A and the marked labour hire tile");
  assert.equal(flagSummary([{ rows: [], noShows }]).noSignIn, 1, "the Sign-ins strip and the Timesheets banner (flagSummary) agree");
  // An undone mark counts again.
  const undone = absenceViews([row({ cancelledAt: new Date() })], new Set()).get(`r1|${TODAY}`)!;
  assert.equal(noSignInCount([{ nowhere: true, absence: undone }]), 1);
  // The 5a "not signed in yet" alert / today's banner leaves marked people out too.
  assert.match(src("../signinAlerts.ts"), /activeAbsenceKeys\([\s\S]*!marked\.has\(`\$\{r\.id\}\|\$\{day\}`\)/);
});

test("marked but signed in: the sign-in stands, the mark is flagged", () => {
  const v = absenceViews([row()], new Set([`r1|${TODAY}`])).get(`r1|${TODAY}`)!;
  assert.equal(v.signedIn, true);
  assert.equal(markedButSignedIn(v), true);
  assert.equal(markedButSignedIn(absenceViews([row()], new Set()).get(`r1|${TODAY}`)), false);
  assert.equal(markedButSignedInText("Sick"), "Marked Sick but signed in");
  // The Sign-ins page flags the person's sign-in lines that day (hours unchanged).
  assert.match(src("../attendanceView.ts"), /markedButSignedIn\(m\)\) \{ r\.flags\.push\("MARKED_NOT_IN"\)/);
});

const line = (o: Partial<TimesheetLine> = {}): TimesheetLine => ({
  attendanceId: "a1", date: "2026-11-17", resourceId: "r1", name: "Sam Worker", role: "Labourer", site: "Job A",
  in: "7:00 am", out: "3:30 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null, ...o,
});
const mark = (o: Partial<AbsenceLine> = {}): AbsenceLine => ({
  absenceId: "m1", date: "2026-11-18", resourceId: "r1", name: "Sam Worker", role: "Labourer", reason: "SICK", label: "Sick", note: "rang in", by: "Alex", at: "2026-11-17T20:00:00.000Z", ...o,
});

test("the timesheet day cell: Sick / Not in with no hours - never in the total", () => {
  assert.deepEqual(timesheetDayCell(mark(), []), { label: "Sick", hours: null, warn: false, text: "Sick" });
  assert.deepEqual(timesheetDayCell(mark({ reason: "NOT_IN", label: "Not in" }), [{ hours: 8 }]), { label: "Not in", hours: null, warn: true, text: "Marked Not in but signed in" });
  assert.equal(timesheetDayCell(null, []), null);
  const [p] = peopleOf("2026-11-16", [line()], [], [], [mark()]);
  assert.equal(p.total, 8, "the mark adds no hours");
  assert.equal(p.issues, 0, "and never holds up the approval");
  assert.equal(p.absences?.["2026-11-18"]?.label, "Sick");
  // Someone marked with no sign-in that week still has a row - 0 hours.
  const [only] = peopleOf("2026-11-16", [], [], [], [mark()]);
  assert.equal(only.total, 0);
  assert.equal(only.name, "Sam Worker");
});

test("the exports carry a text marker with no hours, and still pass the payroll file check", () => {
  const csv = timesheetCsv("2026-11-16", [line(), line({ attendanceId: "a2", date: "2026-11-19" })], null, [], { absences: [mark(), mark({ absenceId: "m2", date: "2026-11-19", reason: "NOT_IN", label: "Not in", note: null })] });
  const rows = csv.split("\r\n");
  const sick = rows.find((r) => r.includes(",2026-11-18,"))!;
  assert.equal(sick, "Sam Worker,Labourer,2026-11-18,Wed,Sick,,,,,,,Sick,Sick - no hours; Note: rang in; Marked by Alex");
  const notIn = rows.find((r) => r.includes(",2026-11-19,") && r.includes("Not in"))!;
  assert.match(notIn, /,Not in,,,,,,,Not in,Not in - no hours; Marked by Alex; Marked Not in but signed in - check$/);
  assert.ok(rows.some((r) => r.startsWith("Sam Worker,Labourer,,WEEK TOTAL,,,,,16,")), "the week total is the sign-ins only");
  assert.ok(fileIsSafe(csv));
  assert.equal(absenceCsvNotes(mark({ note: null }), false), "Sick - no hours; Marked by Alex");
  // Accounts' copy: the same marker; any amount that got into a note is taken out; fileIsSafe passes.
  const acc = accountsTimesheetCsv("2026-11-16", [line()], null, [], [], [mark({ note: "owed $40" })])!;
  assert.ok(acc && fileIsSafe(acc) && !acc.includes("$"));
  assert.ok(acc.includes(",Sick,,,,,,,Sick,"));
  // The approval locks the marks into the week's snapshot; both exports pass them through.
  assert.match(src("../../app/api/timesheets/route.ts"), /const snapshot: TimesheetSnapshot = \{ weekStart, lines, travel, tipRuns, absences \}/);
  assert.match(src("../../app/api/timesheets/export/route.ts"), /timesheetCsv\(weekStart, lines, approval, travel, \{ tipRuns, absences \}\)/);
  assert.match(src("../../app/api/accounts/timesheets/export/route.ts"), /accountsTimesheetCsv\(weekStart, lines, approval, travel, tipRuns, absences\)/);
  assert.match(src("../timesheets.ts"), /const shownAbsences = snap \? snap\.absences \?\? \[\] : absencesNow/, "a locked week shows the marks it was approved with");
});

test("who may: Managers, Admins and the coordinator - never by loosening guard(); nothing is deleted", () => {
  for (const rel of ["../../app/api/attendance/absence/route.ts", "../../app/api/attendance/absence/[id]/cancel/route.ts"]) {
    const code = src(rel);
    assert.match(code, /export const POST = withErrorHandling\(async \([^)]*\) => \{\s*const denied = await guardOrCoordinator\("MANAGER"\);\s*if \(denied\) return denied;/, `${rel}: guardOrCoordinator("MANAGER") first`);
    assert.doesNotMatch(code, /export const (GET|PUT|PATCH|DELETE)/, `${rel}: POST only`);
  }
  for (const r of ["MANAGER", "ADMIN", "COORDINATOR"]) assert.equal(coordinatorOr(r, "MANAGER"), true, r);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD", "nonsense"]) assert.equal(coordinatorOr(r, "MANAGER"), false, r);
  // Keep forever: the store never deletes a mark (undo fills the cancelled fields).
  assert.doesNotMatch(src("./store.ts"), /\.delete(Many)?\(/);
  // No site link reaches it: the routes are under /api/attendance, never /api/site.
  assert.doesNotMatch(src("../../app/api/attendance/absence/route.ts"), /resolveLink|siteLinks/);
});
