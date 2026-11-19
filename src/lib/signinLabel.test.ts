import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobLabel, notYetText, opensAtNoon, shiftLabel, shiftOrder, signInRefusal, START_TIME_MAX, startMinutes, takesSignIns, tonightOpensAt, TONIGHT_FROM_HOUR } from "./signin";
import { timeTextProblem } from "./shiftTimes";

// 18 Nov 2026 (Mt Hutton): Tuesday 9:11pm - the page opened on Monday night's shift and the crew signed in there.
const mon = { id: "mon", shift: "NIGHT", date: new Date("2026-11-16T00:00:00.000Z") };
const tue = { id: "tue", shift: "NIGHT", date: new Date("2026-11-17T00:00:00.000Z") };
const at = (sydney: string) => new Date(sydney + "+11:00"); // AEDT
test("evening: tonight's shift comes first, last night's never", () => {
  const none = () => false;
  assert.deepEqual(shiftOrder([mon, tue], none, at("2026-11-17T21:11:00")).map((j) => j.id), ["tue", "mon"]);
  assert.deepEqual(shiftOrder([tue, mon], none, at("2026-11-17T21:11:00")).map((j) => j.id), ["tue", "mon"]);
  // even with someone still signed in on last night's (forgot to sign out) - tonight's still opens first
  assert.deepEqual(shiftOrder([mon, tue], (id) => id === "mon", at("2026-11-17T21:11:00")).map((j) => j.id), ["tue", "mon"]);
  assert.deepEqual(shiftOrder([mon, tue], none, at("2026-11-17T13:00:00")).map((j) => j.id), ["tue", "mon"]);
});
test("morning: crew still signed in first, then last night's shift for the tip run", () => {
  assert.deepEqual(shiftOrder([tue, mon], () => false, at("2026-11-17T08:41:00")).map((j) => j.id), ["mon", "tue"]);
  assert.deepEqual(shiftOrder([mon, tue], (id) => id === "tue", at("2026-11-17T08:41:00")).map((j) => j.id), ["tue", "mon"]);
});
test("last night's shift takes new sign-ins until 2pm only; tonight's from noon (19 Nov 2026)", () => {
  assert.equal(takesSignIns(mon, at("2026-11-17T08:41:00")), true);
  assert.equal(takesSignIns(mon, at("2026-11-17T13:59:00")), true);
  assert.equal(takesSignIns(mon, at("2026-11-17T14:00:00")), false);
  assert.equal(takesSignIns(mon, at("2026-11-17T21:11:00")), false);
  assert.equal(takesSignIns(tue, at("2026-11-17T21:11:00")), true);
  assert.equal(takesSignIns(tue, at("2026-11-18T04:07:00")), true);
  assert.equal(takesSignIns(mon, at("2026-11-18T08:00:00")), false); // two nights ago
  assert.equal(takesSignIns({ shift: "DAY", date: mon.date }, at("2026-11-17T07:00:00")), false);
});

// 17 Nov 2026 (Mt Hutton): last night's and tonight's night shifts must look different on a supervisor's link.
test("night shifts show their day; day shifts are unchanged", () => {
  const project = { name: "Woolworths Mt Hutton" };
  const mon = { title: "x", shift: "NIGHT", date: new Date("2026-11-16T00:00:00.000Z"), project };
  const tue = { ...mon, date: new Date("2026-11-17T00:00:00.000Z") };
  // 19 Nov 2026 (Ilies, shift rollover): said plainly - the span, and the day the hours count to.
  assert.equal(shiftLabel(mon), "Woolworths Mt Hutton – Night shift Mon 16 → Tue 17 – hours count to Mon 16");
  assert.equal(shiftLabel(tue), "Woolworths Mt Hutton – Night shift Tue 17 → Wed 18 – hours count to Tue 17");
  assert.notEqual(shiftLabel(mon), shiftLabel(tue));
  const day = { ...mon, shift: "DAY" };
  assert.equal(shiftLabel(day), jobLabel(day), "day shifts unchanged");
  assert.equal(shiftLabel({ ...mon, project: null, title: "Yard job" }), "Yard job – Night shift Mon 16 → Tue 17 – hours count to Mon 16");
  // Across a month end.
  assert.equal(shiftLabel({ ...mon, date: new Date("2026-11-30T00:00:00.000Z") }), "Woolworths Mt Hutton – Night shift Mon 30 → Tue 1 – hours count to Mon 30");
});

// 19 Nov 2026 (Calwell, shift rollover): tonight's night shift takes new sign-ins only from 12 noon Sydney.
test("tonight's night shift: no sign-ins before 12 noon, from 12:00 yes; day shifts unchanged", () => {
  const thu = { shift: "NIGHT", date: new Date("2026-11-19T00:00:00.000Z") };
  assert.equal(takesSignIns(thu, at("2026-11-19T11:59:00")), false);
  assert.equal(takesSignIns(thu, at("2026-11-19T12:00:00")), true);
  assert.equal(takesSignIns(thu, at("2026-11-19T04:51:00")), false);
  assert.match(signInRefusal(thu, at("2026-11-19T11:59:00"))!, /Tonight's night shift \(Thu 19 → Fri 20\) takes sign-ins from 12 noon/);
  assert.equal(opensAtNoon(thu, at("2026-11-19T11:59:00")), true);
  assert.equal(opensAtNoon(thu, at("2026-11-19T12:00:00")), false);
  assert.equal(TONIGHT_FROM_HOUR, 12);
  // Day shifts: any time today, as before.
  assert.equal(takesSignIns({ shift: "DAY", date: thu.date }, at("2026-11-19T04:30:00")), true);
  assert.equal(takesSignIns({ shift: "DAY", date: thu.date }, at("2026-11-19T23:30:00")), true);
  // Calwell, Mon 16 Nov 4:51am: Sunday night's shift still takes sign-ins (and sign-outs); Monday night's does not.
  const sun15 = { shift: "NIGHT", date: new Date("2026-11-15T00:00:00.000Z") };
  const mon16 = { shift: "NIGHT", date: new Date("2026-11-16T00:00:00.000Z") };
  assert.equal(takesSignIns(sun15, at("2026-11-16T04:51:00")), true);
  assert.equal(takesSignIns(mon16, at("2026-11-16T04:51:00")), false);
  // From noon to 2pm both take sign-ins (last night's for the tip run, tonight's for the early crew); from 2pm only tonight's.
  assert.equal(takesSignIns(sun15, at("2026-11-16T13:30:00")) && takesSignIns(mon16, at("2026-11-16T13:30:00")), true);
  assert.equal(takesSignIns(sun15, at("2026-11-16T14:00:00")), false);
  assert.match(signInRefusal(sun15, at("2026-11-16T14:00:00"))!, /That shift has finished/);
});

// SR-007 (19 Nov 2026): an early-starting night shift opens at its start less 1 h, if that's before noon.
// SR-007 / SR-009 (19 Nov 2026): tonight's shift opens at the earlier of 12 noon and an hour before it starts - with the
// start placed like the rest of the app (a night start before noon is the NEXT morning), so only a 12:xx pm start opens
// before noon.
test("SR-007 / SR-009: tonight's shift opens at 12 noon, or an hour before a 12:xx pm start", () => {
  const night = (startTime: string | null) => ({ shift: "NIGHT", date: new Date("2026-11-19T00:00:00.000Z"), startTime });
  assert.equal(startMinutes("21:00"), 21 * 60);
  assert.equal(startMinutes("9pm"), 21 * 60);
  assert.equal(startMinutes("2:30pm"), 14 * 60 + 30);
  assert.equal(startMinutes("10:30 am"), 10 * 60 + 30);
  assert.equal(startMinutes("12am"), 0);
  assert.equal(startMinutes("12pm"), 12 * 60);
  for (const bad of [null, "", "tbc", "25:00", "13pm", "9:75", "230pm"]) assert.equal(startMinutes(bad), null, String(bad));
  // SR-009: the start times Ilies asked about.
  assert.equal(tonightOpensAt(night("12:30am")), 12 * 60, "12:30am = 00:30 tomorrow morning: noon, never 00:00");
  assert.equal(tonightOpensAt(night("1am")), 12 * 60, "1am = tomorrow morning: noon");
  assert.equal(tonightOpensAt(night("12:30pm")), 11 * 60 + 30, "12:30pm: an hour before, 11:30am");
  assert.equal(tonightOpensAt(night("2:30pm")), 12 * 60, "2:30pm (today's earliest live start): noon");
  assert.equal(tonightOpensAt(night("230pm")), 12 * 60, "'230pm' doesn't read as a time: noon");
  assert.equal(tonightOpensAt(night("10pm")), 12 * 60, "10pm: noon");
  assert.equal(tonightOpensAt(night("21:00")), 12 * 60);
  assert.equal(tonightOpensAt(night("10:30")), 12 * 60, "10:30 on a night shift = tomorrow morning: noon");
  assert.equal(tonightOpensAt(night("tbc")), 12 * 60, "unreadable: noon");
  assert.equal(tonightOpensAt(night(null)), 12 * 60, "no start: noon");
  for (const s of ["12:30am", "1am"]) {
    assert.equal(takesSignIns(night(s), at("2026-11-19T00:00:00")), false, `${s}: closed at midnight`);
    assert.equal(takesSignIns(night(s), at("2026-11-19T11:59:00")), false, `${s}: closed at 11:59`);
    assert.equal(takesSignIns(night(s), at("2026-11-19T12:00:00")), true, `${s}: open at noon`);
  }
  assert.equal(takesSignIns(night("12:30pm"), at("2026-11-19T11:29:00")), false);
  assert.equal(takesSignIns(night("12:30pm"), at("2026-11-19T11:30:00")), true);
  assert.match(signInRefusal(night("12:30pm"), at("2026-11-19T11:00:00"))!, /takes sign-ins from 11:30 am/);
  assert.equal(opensAtNoon(night("12:30pm"), at("2026-11-19T11:29:00")), true);
  assert.equal(notYetText(night("12:30pm")), "Sign-ins for tonight's shift open at 11:30 am - signing out still works.");
  assert.equal(notYetText(night("21:00")), "Sign-ins for tonight's shift open at 12 noon - signing out still works.");
  assert.equal(takesSignIns(night("21:00"), at("2026-11-19T11:59:00")), false);
});

// SR-010 (19 Nov 2026): a hostile start time can't slow the server down or open a shift early.
test("SR-010: a long hostile start time is read quickly (16 characters at most) and opens nothing early", () => {
  const night = (startTime: string) => ({ shift: "NIGHT", date: new Date("2026-11-19T00:00:00.000Z"), startTime });
  for (const evil of ["1".repeat(200_000), " ".repeat(200_000) + "x", "1:" + "0".repeat(200_000) + "am", "12:30pm" + " ".repeat(200_000) + "!"]) {
    const t0 = performance.now();
    const m = startMinutes(evil);
    const open = tonightOpensAt(night(evil));
    const ok = takesSignIns(night(evil), at("2026-11-19T11:00:00"));
    assert.ok(performance.now() - t0 < 100, `${evil.length} characters read in under 100 ms`);
    assert.ok(m === null || m === 12 * 60 + 30, "only the first 16 characters are read");
    assert.ok(open >= 11 * 60 + 30, "never opens earlier than an hour before a real 12:xx pm start");
    if (m === null) assert.equal(ok, false, "unreadable: not open before noon");
  }
  assert.equal(START_TIME_MAX, 16);
  assert.equal(timeTextProblem({ startTime: "9pm", endTime: "5:30am" }), null);
  assert.equal(timeTextProblem({ startTime: null }), null);
  assert.match(timeTextProblem({ startTime: "x".repeat(17) })!, /Start time is too long/);
  assert.match(timeTextProblem({ endTime: "x".repeat(17) })!, /Finish time is too long/);
  assert.match(timeTextProblem({ startTime: 9 })!, /must be text/);
  // POST /api/jobs and PATCH /api/jobs/:id answer it with a 400 before anything else.
  for (const rel of ["../app/api/jobs/route.ts", "../app/api/jobs/[id]/route.ts"]) {
    const code = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(code, /const timeProblem = timeTextProblem\(body[^)]*\);\r?\n  if \(timeProblem\) return NextResponse\.json\(\{ error: timeProblem \}, \{ status: 400 \}\);/, rel);
  }
});

test("the noon rule is Sydney time across daylight saving (4 Oct 2026 on, 5 Apr 2026 off)", () => {
  const utc = (iso: string) => new Date(iso + "Z");
  // Sat 3 Oct 2026 - AEST (+10): noon = 02:00 UTC.
  const sat = { shift: "NIGHT", date: new Date("2026-10-03T00:00:00.000Z") };
  assert.equal(takesSignIns(sat, utc("2026-10-03T01:59:00")), false, "11:59 AEST");
  assert.equal(takesSignIns(sat, utc("2026-10-03T02:00:00")), true, "12:00 AEST");
  // Sun 4 Oct 2026 - clocks went forward at 2am, AEDT (+11): noon = 01:00 UTC.
  const sun = { shift: "NIGHT", date: new Date("2026-10-04T00:00:00.000Z") };
  assert.equal(takesSignIns(sun, utc("2026-10-04T00:59:00")), false, "11:59 AEDT");
  assert.equal(takesSignIns(sun, utc("2026-10-04T01:00:00")), true, "12:00 AEDT");
  // Sun 5 Apr 2026 - clocks went back at 3am, AEST (+10): noon = 02:00 UTC.
  const apr = { shift: "NIGHT", date: new Date("2026-04-05T00:00:00.000Z") };
  assert.equal(takesSignIns(apr, utc("2026-04-05T01:59:00")), false, "11:59 AEST");
  assert.equal(takesSignIns(apr, utc("2026-04-05T02:00:00")), true, "12:00 AEST");
  // Last night's (Sat 4 Apr) still takes sign-ins until 2pm AEST that day.
  const sat4 = { shift: "NIGHT", date: new Date("2026-04-04T00:00:00.000Z") };
  assert.equal(takesSignIns(sat4, utc("2026-04-05T03:59:00")), true, "1:59pm AEST");
  assert.equal(takesSignIns(sat4, utc("2026-04-05T04:00:00")), false, "2:00pm AEST");
});
