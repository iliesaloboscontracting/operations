import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClock } from "./shiftTimes";
import {
  bulkSignOuts, clockLabel, confirmReminderDue, confirmReminderTargets, confirmReminderText, flagsForJobRows, flagSummary,
  jobStartAt, lateSignIn, longShift, signedInEarlierIds, SIGNIN_FLAG_LIMITS, sydneyClock, type FlagRow,
} from "./signinFlags";

// Ilies, 10 Nov 2026: "do A and B" - Monday 9 Nov 2026 (AEDT, UTC+11).
const syd = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 11, m));
};
const MON = "2026-11-09";
const job = { date: MON, shift: "DAY", start: "7am", end: "3:30pm" };
const row = (o: Partial<FlagRow> & { id: string }): FlagRow => ({ signInAt: syd(MON, "07:00"), signOutAt: syd(MON, "15:30"), signOutMethod: "SUPERVISOR_QR", status: "CONFIRMED", ...o });

test("time parsing: the board's free-text times", () => {
  assert.equal(parseClock("7am"), 7 * 60);
  assert.equal(parseClock("6:30am"), 6 * 60 + 30);
  assert.equal(parseClock("3:30pm"), 15 * 60 + 30);
  assert.equal(parseClock("7:00"), 7 * 60, "7:00 with no am/pm - an hour of 6 or more reads as written");
  assert.equal(parseClock("3:30"), null, "3:30 with no am/pm - morning or afternoon? skipped");
  for (const junk of ["", "TBC", "early", "25:00", "7.5", null, undefined]) assert.equal(parseClock(junk as string | null), null, String(junk));
  assert.equal(clockLabel(7 * 60), "7am");
  assert.equal(clockLabel(15 * 60 + 30), "3:30pm");
  assert.equal(clockLabel(12 * 60), "12pm");
  assert.equal(clockLabel(0), "12am");
  assert.equal(sydneyClock(syd(MON, "15:05")), "3:05pm");
});

test("job start: day shift on its day; a night shift starting before midday is the next morning; unclear = none", () => {
  assert.equal(jobStartAt(MON, "DAY", "7am")?.toISOString(), syd(MON, "07:00").toISOString());
  assert.equal(jobStartAt(MON, "NIGHT", "10pm")?.toISOString(), syd(MON, "22:00").toISOString());
  assert.equal(jobStartAt(MON, "NIGHT", "12:30am")?.toISOString(), syd("2026-11-10", "00:30").toISOString());
  assert.equal(jobStartAt(MON, "DAY", "TBC"), null);
});

test("late sign-in: more than 60 min after the start (Rivkin House: 3:05pm on a 7am job)", () => {
  assert.equal(lateSignIn(row({ id: "a", signInAt: syd(MON, "15:05") }), job), "Signed in 3:05pm – job starts 7am");
  assert.equal(lateSignIn(row({ id: "b", signInAt: syd(MON, "08:00") }), job), null, "exactly 60 min - not late");
  assert.ok(lateSignIn(row({ id: "c", signInAt: syd(MON, "08:01") }), job), "61 min - late");
  assert.equal(lateSignIn(row({ id: "d", signInAt: syd(MON, "06:30") }), job), null, "early is fine");
  assert.equal(lateSignIn(row({ id: "e", signInAt: syd(MON, "15:05"), status: "REJECTED" }), job), null, "a rejected line isn't flagged");
  assert.equal(lateSignIn(row({ id: "f", signInAt: syd(MON, "15:05"), signedInEarlier: true }), job), null, "already signed in somewhere earlier that day");
  assert.equal(lateSignIn(row({ id: "g", signInAt: syd(MON, "15:05") }), { ...job, start: "TBC" }), null, "unclear start - skipped");
  assert.equal(lateSignIn(row({ id: "h", signInAt: syd(MON, "15:05") }), { ...job, start: "3:30" }), null, "ambiguous start - skipped");
  assert.equal(SIGNIN_FLAG_LIMITS.lateSignInMinutes, 60);
});

test("long day: signed out more than 2 h after the finish (Winston Hills: 10:47pm on a 7am-3:30pm job), or over 12 h", () => {
  assert.equal(longShift(row({ id: "a", signOutAt: syd(MON, "22:47") }), job), "Signed out 10:47pm – job ends 3:30pm");
  assert.equal(longShift(row({ id: "b", signOutAt: syd(MON, "17:30") }), job), null, "exactly 2 h after - not flagged");
  assert.ok(longShift(row({ id: "c", signOutAt: syd(MON, "17:31") }), job), "2 h 1 min after - flagged");
  assert.equal(longShift(row({ id: "d", signOutAt: null }), job), null, "still on site / no sign-out - other flags cover it");
  assert.equal(longShift(row({ id: "e", signOutAt: syd("2026-11-10", "02:10") }), job), "Signed out 2:10am (next day) – job ends 3:30pm");
  // Over 12 h on a job with no clear finish.
  const noTimes = { ...job, start: null, end: null };
  assert.equal(longShift(row({ id: "f", signInAt: syd(MON, "06:00"), signOutAt: syd(MON, "19:30") }), noTimes), "Signed in 13.5h (6am – 7:30pm)");
  assert.equal(longShift(row({ id: "g", signInAt: syd(MON, "06:00"), signOutAt: syd(MON, "18:00") }), noTimes), null, "exactly 12 h - not flagged");
  // A night shift ending in the morning: 10pm-6am, signed out 6:30am - fine.
  const night = { date: MON, shift: "NIGHT", start: "10pm", end: "6am" };
  assert.equal(longShift(row({ id: "h", signInAt: syd(MON, "22:00"), signOutAt: syd("2026-11-10", "06:30") }), night), null);
  assert.equal(longShift(row({ id: "i", signInAt: syd(MON, "22:00"), signOutAt: syd(MON, "22:00"), status: "REJECTED" }), job), null);
});

test("bulk sign-out: 3+ signed out in the same minute by the supervisor / office; crew scanning out never count", () => {
  const out = syd(MON, "22:47");
  const rows = [
    row({ id: "1", signOutAt: new Date(out.getTime() + 5_000), signOutMethod: "MANUAL" }),
    row({ id: "2", signOutAt: new Date(out.getTime() + 20_000), signOutMethod: "MANUAL" }),
    row({ id: "3", signOutAt: new Date(out.getTime() + 40_000), signOutMethod: "MANUAL" }),
    row({ id: "4", signOutAt: new Date(out.getTime() + 50_000), signOutMethod: "MANUAL" }),
    row({ id: "5", signOutAt: out, signOutMethod: "SUPERVISOR_QR" }),
    row({ id: "6", signOutAt: out, signOutMethod: "SUPERVISOR_QR" }),
    row({ id: "7", signOutAt: out, signOutMethod: "SUPERVISOR_QR" }),
  ];
  const b = bulkSignOuts(rows);
  assert.deepEqual([...b.keys()].sort(), ["1", "2", "3", "4"]);
  assert.equal(b.get("1")?.count, 4);
  assert.equal(b.get("1")?.by, "supervisor");
  assert.equal(bulkSignOuts(rows.slice(0, 2)).size, 0, "two together isn't 'several'");
  const office = [1, 2, 3].map((i) => row({ id: `o${i}`, signOutAt: syd(MON, "15:30"), signOutMethod: "OFFICE" }));
  assert.equal(bulkSignOuts(office).get("o1")?.by, "office");
  assert.equal(bulkSignOuts([...office.slice(0, 2), row({ id: "m", signOutAt: syd(MON, "15:30"), signOutMethod: "MANUAL" })]).size, 0, "office and supervisor aren't one group");
});

test("flags for a job: late + long day + signed out together; the crew signed out together at the finish aren't noted", () => {
  const late = row({ id: "late", signInAt: syd(MON, "15:05"), signOutAt: syd(MON, "15:30"), signOutMethod: "POSTER", status: "TO_CONFIRM" });
  const winston = [1, 2, 3, 4].map((i) => row({ id: `w${i}`, signOutAt: syd(MON, "22:47"), signOutMethod: "MANUAL" }));
  const atFinish = [1, 2, 3].map((i) => row({ id: `f${i}`, signOutAt: syd(MON, "15:31"), signOutMethod: "MANUAL" }));
  const f = flagsForJobRows([late, ...winston, ...atFinish], job);
  assert.deepEqual(f.get("late")?.flags, ["LATE_IN"]);
  assert.equal(f.get("late")?.notes.LATE_IN, "Signed in 3:05pm – job starts 7am");
  assert.deepEqual(f.get("w1")?.flags, ["LONG_SHIFT", "BULK_OUT"]);
  assert.equal(f.get("w1")?.notes.BULK_OUT, "4 signed out together at 10:47pm by the supervisor");
  assert.deepEqual(f.get("f1")?.flags, [], "a normal 'sign out selected' at the finish is not a flag");
});

test("signed in earlier that day: the first line isn't 'earlier', a later one is; rejected lines don't count", () => {
  const ids = signedInEarlierIds([
    { id: "truck", key: "p1", signInAt: syd(MON, "06:00"), status: "CONFIRMED" },
    { id: "site", key: "p1", signInAt: syd(MON, "09:30"), status: "CONFIRMED" },
    { id: "x", key: "p2", signInAt: syd(MON, "05:00"), status: "REJECTED" },
    { id: "y", key: "p2", signInAt: syd(MON, "15:05"), status: "TO_CONFIRM" },
  ]);
  assert.deepEqual([...ids].sort(), ["site"]);
});

test("summary strip counts", () => {
  const s = flagSummary([
    { rows: [{ flags: ["TO_CONFIRM", "LATE_IN"] }, { flags: ["LONG_SHIFT", "BULK_OUT"] }, { flags: ["TO_CONFIRM"] }], noShows: [{ id: "a", nowhere: true }, { id: "b", nowhere: false }, { id: "tile" }] },
    { rows: [{ flags: ["LONG_DAY"] }, { flags: ["TO_CONFIRM", "NO_LOCATION"] }, { flags: ["FAR_FROM_SITE"] }], noShows: [{ id: "c" }] },
  ]);
  // location (11 Nov 2026): poster sign-ins with no location / far from the site.
  assert.deepEqual(s, { toConfirm: 3, late: 1, longDay: 2, noSignIn: 1, location: 2 });
});

test("A: the confirm reminder is due at 3:30pm on a day shift (up to 4 h late), 30 min after a night shift's finish", () => {
  assert.equal(confirmReminderDue(job, syd(MON, "15:29")), false);
  assert.equal(confirmReminderDue(job, syd(MON, "15:30")), true);
  assert.equal(confirmReminderDue(job, syd(MON, "19:30")), true);
  assert.equal(confirmReminderDue(job, syd(MON, "19:31")), false, "never after the 4-hour window");
  assert.equal(confirmReminderDue({ ...job, start: null, end: null }, syd(MON, "15:31")), true, "a day shift with no times still gets it at 3:30pm");
  const night = { date: MON, shift: "NIGHT", start: "10pm", end: "6am" };
  assert.equal(confirmReminderDue(night, syd(MON, "15:31")), false, "night shifts aren't reminded at 3:30pm");
  assert.equal(confirmReminderDue(night, syd("2026-11-10", "06:29")), false);
  assert.equal(confirmReminderDue(night, syd("2026-11-10", "06:30")), true);
  assert.equal(confirmReminderDue({ ...night, end: "TBC" }, syd("2026-11-10", "06:30")), false, "unclear night finish - no reminder");
});

test("A: who gets it - the Supervisor / Lead's own link, else any crew member's supervisor link, plus hand-overs", () => {
  const crew = [{ resourceId: "sup", role: "Supervisor" }, { resourceId: "lab", role: "Labourer" }, { resourceId: "lab2", role: null }];
  const links = [{ id: "L-sup", resourceId: "sup" }, { id: "L-lab", resourceId: "lab" }, { id: "L-other", resourceId: "elsewhere" }];
  assert.deepEqual(confirmReminderTargets(crew, links, ["H1"]), ["L-sup", "H1"]);
  assert.deepEqual(confirmReminderTargets(crew, links.slice(1), []), ["L-lab"], "the Supervisor has no link - a crew member's supervisor link");
  assert.deepEqual(confirmReminderTargets(crew, [{ id: "L-other", resourceId: "elsewhere" }], []), [], "never someone not on the job");
  assert.deepEqual(confirmReminderTargets([], [], ["H1", "H1"]), ["H1"], "no repeats");
  const t = confirmReminderText(3, "Rivkin House");
  assert.equal(t.body, "3 sign-ins at Rivkin House are waiting for you to confirm – open your link.");
  assert.equal(confirmReminderText(1, "X").body, "1 sign-in at X is waiting for you to confirm – open your link.");
  assert.ok(!/\$\s?\d/.test(t.title + t.body), "no money");
});
