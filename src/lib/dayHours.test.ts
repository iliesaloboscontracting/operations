import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHours, type DayLine } from "./dayHours";

// Sydney wall-clock helper for 26 Oct 2026 (AEDT, UTC+11).
const t = (hhmm: string, day = 26) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 9, day, h - 11, m)); };
const L = (id: string, a: string, b: string | null, o: Partial<DayLine> = {}): DayLine => ({ id, personKey: "carlos", date: "2026-10-26", start: t(a), end: b ? t(b) : null, breakMinutes: 30, ...o });

test("Carlos, Mon 26 Oct: 7 Seater 05:27-18:04 and UNSW 05:58-17:21 count once, with one break", () => {
  const h = dayHours([L("truck", "05:27", "18:04"), L("site", "05:58", "17:21")]);
  assert.deepEqual(h.get("truck"), { hours: 12, overlap: true, breakMinutes: 30 }, "05:27-18:04 is 12h37m, less one 30 min break");
  assert.deepEqual(h.get("site"), { hours: 0, overlap: true, breakMinutes: 0 }, "the site line adds nothing the truck line didn't cover");
});

test("a 4.5 h day gets no break; just over 5 h gets one", () => {
  assert.deepEqual(dayHours([L("a", "07:00", "11:30")]).get("a"), { hours: 4.5, overlap: false, breakMinutes: 0 });
  assert.deepEqual(dayHours([L("a", "07:00", "12:00")]).get("a"), { hours: 5, overlap: false, breakMinutes: 0 }, "exactly 5 h: no break (over 5 h only)");
  assert.deepEqual(dayHours([L("a", "07:00", "12:15")]).get("a"), { hours: 4.75, overlap: false, breakMinutes: 30 });
});

test("a truck and a site on the same day: one break, off the longest line", () => {
  const h = dayHours([L("truck", "06:00", "07:07"), L("site", "07:10", "15:30")]);
  assert.deepEqual(h.get("truck"), { hours: 1, overlap: false, breakMinutes: 0 }, "the short truck line keeps its time (it used to lose 30 min)");
  assert.deepEqual(h.get("site"), { hours: 7.75, overlap: false, breakMinutes: 30 });
});

test("the break is the largest setting among the day's lines; a blank break counts as none", () => {
  const h = dayHours([L("a", "06:00", "10:00", { breakMinutes: 0 }), L("b", "10:30", "16:00", { breakMinutes: 45 })]);
  assert.equal(h.get("b")!.breakMinutes, 45);
  assert.equal(dayHours([L("a", "06:00", "16:00", { breakMinutes: null })]).get("a")!.hours, 10);
});

test("days and people are kept apart; open lines have no hours", () => {
  const h = dayHours([
    L("mon", "07:00", "15:30"),
    L("tue", "07:00", "15:30", { date: "2026-10-27" }),
    L("other", "07:00", "15:30", { personKey: "sam" }),
    L("open", "16:00", null),
  ]);
  for (const id of ["mon", "tue", "other"]) assert.equal(h.get(id)!.hours, 8, id);
  assert.deepEqual(h.get("open"), { hours: null, overlap: false, breakMinutes: 0 });
});

test("one line inside another, and a zero-length line", () => {
  const h = dayHours([L("outer", "06:00", "16:00"), L("inner", "08:00", "09:00"), L("zero", "17:00", "17:00")]);
  assert.equal(h.get("outer")!.hours, 9.5);
  assert.equal(h.get("inner")!.hours, 0);
  assert.equal(h.get("inner")!.overlap && h.get("outer")!.overlap, true);
  assert.equal(h.get("zero")!.hours, 0);
});

test("a break bigger than the longest line spills to the next, never below 0", () => {
  const lines = Array.from({ length: 12 }, (_, i) => L(`l${i}`, `${String(6 + i).padStart(2, "0")}:00`, `${String(6 + i).padStart(2, "0")}:26`));
  const h = dayHours(lines); // 12 x 26 min = 312 min > 5 h
  const total = [...h.values()].reduce((n, x) => n + x.breakMinutes, 0);
  assert.equal(total, 30);
  assert.ok([...h.values()].every((x) => x.hours! >= 0));
});
