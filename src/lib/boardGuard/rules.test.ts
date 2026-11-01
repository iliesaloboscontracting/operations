// Allocation guard rules (2 Nov 2026): when the board asks "did you mean another day?", how it learns, and what it
// says changed since a sheet went out. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN, addDaysIso, changesSince, dayLabel, editPrompt, hideMoneyLines, sendDateProblem, sendPrompt, sydney, usualAhead, type BoardSnapshot, type EditStat } from "./rules";

const SUN = "2026-11-01", MON = "2026-11-02";
const at = (h: number, m = 0) => h * 60 + m;
// Monday's sheet went out at 6:12pm Sydney on Sunday 1 Nov (07:12 UTC).
const mondaySent = { date: MON, sentAt: new Date("2026-11-01T07:12:00Z"), sentBy: "Ilies" };

test("1 Nov: Monday's sheet went out, then Sunday (today) is changed -> 'did you mean Mon 2 Nov?'", () => {
  const p = editPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(18, 40), stats: [], laterSend: mondaySent })!;
  assert.equal(p.reason, "SENT_LATER");
  assert.equal(p.suggest, MON);
  assert.match(p.message, /Mon 2 Nov's sheet went out at 6:12pm \(Ilies\)\. You're now changing today, Sun 1 Nov - did you mean Mon 2 Nov\?/);
  // ... and sending Sunday's sheet after that is asked about too
  const s = sendPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(18, 45), laterSend: mondaySent })!;
  assert.equal(s.reason, "SENT_LATER");
  assert.equal(s.suggest, MON);
});

test("a later day is never asked about - planning ahead is the normal job", () => {
  assert.equal(editPrompt({ boardDate: MON, today: SUN, nowMinutes: at(21), stats: [], laterSend: mondaySent }), null);
  assert.equal(sendPrompt({ boardDate: MON, today: SUN, nowMinutes: at(21), laterSend: mondaySent }), null);
});

test("a day already gone is asked about; tomorrow is suggested", () => {
  const p = editPrompt({ boardDate: "2026-10-30", today: SUN, nowMinutes: at(10), stats: [], laterSend: null })!;
  assert.equal(p.reason, "PAST");
  assert.equal(p.suggest, MON);
  assert.equal(sendPrompt({ boardDate: "2026-10-30", today: SUN, nowMinutes: at(7), laterSend: null })!.reason, "SEND_PAST");
});

test("before it has learned: changing today asks from 3pm; sending today's sheet asks from noon", () => {
  assert.equal(editPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(14, 59), stats: [], laterSend: null }), null);
  assert.equal(editPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(15), stats: [], laterSend: null })!.reason, "EVENING");
  assert.equal(sendPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(6, 30), laterSend: null }), null, "a morning send of today's sheet is normal");
  assert.equal(sendPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(12), laterSend: null })!.reason, "SEND_TODAY");
});

test("it learns each person's rhythm: asks only when today is unusual for that time of day", () => {
  const evenings: EditStat[] = Array.from({ length: 25 }, (_, i) => ({ offset: i < 23 ? 1 : 0, minutes: at(19) + (i % 5) * 10 }));
  assert.deepEqual(usualAhead(evenings, at(19, 30)), { known: true, n: 25, aheadShare: 23 / 25 });
  const p = editPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(19, 30), stats: evenings, laterSend: null })!;
  assert.equal(p.reason, "USUAL_AHEAD");
  assert.match(p.message, /usually planning ahead \(92% of your changes are for a later day\)/);
  // Someone who works on today in the evenings (a night-shift fixer) isn't nagged.
  const nightFixer: EditStat[] = Array.from({ length: 25 }, () => ({ offset: 0, minutes: at(19) }));
  assert.equal(editPrompt({ boardDate: SUN, today: SUN, nowMinutes: at(19, 30), stats: nightFixer, laterSend: null }), null);
  // Morning changes to today, learned: no question even after 3pm-style rules would have asked.
  const mornings: EditStat[] = Array.from({ length: 30 }, () => ({ offset: 0, minutes: at(7) }));
  assert.equal(usualAhead(mornings, at(19)).known, false, "mornings say nothing about 7pm");
  assert.equal(usualAhead(evenings.slice(0, LEARN.minSamples - 1), at(19)).known, false, "too few to trust");
  // Around midnight counts as near (23:30 and 00:20).
  assert.equal(usualAhead(Array.from({ length: 20 }, () => ({ offset: 1, minutes: at(23, 30) })), at(0, 20)).known, true);
});

test("what changed since the sheet went out, in plain words", () => {
  const before: BoardSnapshot = { jobs: [
    { key: "p1|DAY", site: "Myers", running: true, start: "06:00", end: "14:30", crew: [{ id: "a", name: "Joe", role: "Supervisor" }, { id: "b", name: "Excavator 5.5t", role: null }] },
    { key: "p2|NIGHT", site: "Coles (night)", running: true, start: "22:00", end: "06:00", crew: [{ id: "c", name: "Sam", role: null }] },
    { key: "p3|DAY", site: "Bronte", running: true, start: "07:00", end: "15:00", crew: [] },
  ] };
  const after: BoardSnapshot = { jobs: [
    { key: "p1|DAY", site: "Myers", running: true, start: "07:00", end: "15:30", crew: [{ id: "a", name: "Joe", role: "Lead" }] },
    { key: "p2|NIGHT", site: "Coles (night)", running: true, start: "22:00", end: "06:00", crew: [{ id: "c", name: "Sam", role: null }, { id: "b", name: "Excavator 5.5t", role: null }] },
    { key: "p3|DAY", site: "Bronte", running: false, start: "07:00", end: "15:00", crew: [] },
    { key: "p4|DAY", site: "Rose Bay", running: true, start: "07:00", end: "15:00", crew: [{ id: "d", name: "Mia", role: null }] },
  ] };
  assert.deepEqual(changesSince(before, after).sort(), [
    "Bronte no longer running", "Excavator 5.5t: Myers -> Coles (night)", "Joe now Lead at Myers", "Mia added to Rose Bay",
    "Myers: 06:00-14:30 -> 07:00-15:30", "Rose Bay added",
  ].sort());
  assert.deepEqual(changesSince(before, before), [], "no changes, nothing listed");
  const many: BoardSnapshot = { jobs: [{ key: "x|DAY", site: "Big", running: true, start: null, end: null, crew: Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, role: null })) }] };
  const lines = changesSince({ jobs: [{ ...many.jobs[0], crew: [] }] }, many);
  assert.equal(lines.length, 31);
  assert.equal(lines.at(-1), "and 10 more");
});

test("BG-001/004: a send is recorded only for a real day, a week back to two weeks ahead", () => {
  assert.equal(sendDateProblem(MON, SUN), null);
  assert.equal(sendDateProblem(addDaysIso(SUN, -7), SUN), null);
  assert.equal(sendDateProblem(addDaysIso(SUN, 14), SUN), null);
  for (const bad of [addDaysIso(SUN, -8), addDaysIso(SUN, 15), "2099-01-01", "2026-02-31", "2026-13-01", "junk", 42, null]) assert.ok(sendDateProblem(bad, SUN), String(bad));
});

test("BG-003: a 'changes since' line with a dollar amount is hidden, the rest kept", () => {
  assert.deepEqual(hideMoneyLines(["Joe added to Myers", "Test $500 job added", "Hino 500 ($90/day) taken off Bronte"]),
    ["Joe added to Myers", "A change (details hidden)", "A change (details hidden)"]);
});

test("dates and Sydney time", () => {
  assert.equal(dayLabel(SUN), "Sun 1 Nov");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(sydney(new Date("2026-11-01T07:12:00Z")), { date: SUN, minutes: at(18, 12) });
  assert.deepEqual(sydney(new Date("2026-11-01T13:30:00Z")), { date: MON, minutes: at(0, 30) }, "after midnight Sydney is the next day");
});
