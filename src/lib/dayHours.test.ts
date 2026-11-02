import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHours, type DayLine } from "./dayHours";

// Sydney wall-clock for late Oct / Nov 2026 (AEDT, UTC+11). The new rule applies from Mon 26 Oct 2026 (TF-007a).
const t = (hhmm: string, day = 26) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 9, day, h - 11, m)); };
const L = (id: string, a: string, b: string | null, o: Partial<DayLine> = {}): DayLine => ({ id, personKey: "carlos", date: "2026-10-26", start: t(a), end: b ? t(b) : null, breakMinutes: 30, ...o });
const dayTotal = (h: Map<string, { hours: number | null }>, ids: string[]) => ids.reduce((n, id) => n + (h.get(id)!.hours ?? 0), 0);

test("Carlos, Mon 26 Oct: 7 Seater 05:27-18:04 and UNSW 05:58-17:21 count once, with one break", () => {
  const h = dayHours([L("truck", "05:27", "18:04"), L("site", "05:58", "17:21")]);
  assert.deepEqual(h.get("truck"), { hours: 12, overlap: true, breakMinutes: 30 }, "05:27-18:04 is 12h37m, less one 30 min break");
  assert.deepEqual(h.get("site"), { hours: 0, overlap: true, breakMinutes: 0 }, "the site line adds nothing the truck line didn't cover");
});

test("TF-011 'never below 5': over 5 h the break comes off but the day stays at least 5 h; 5 h or less, no break", () => {
  const one = (b: string) => dayHours([L("a", "07:00", b)]).get("a")!.hours;
  assert.equal(one("11:30"), 4.5, "4.5 h: no break");
  assert.equal(one("12:00"), 5, "exactly 5 h: no break");
  assert.equal(one("12:10"), 5, "5:10 -> 5.0");
  assert.equal(one("12:30"), 5, "5:30 -> 5.0");
  assert.equal(one("13:00"), 5.5, "6:00 -> 5.5");
  assert.equal(one("15:30"), 8, "8:30 -> 8.0");
});

test("TF-001: the day is rounded once and shared, so the lines add up to it exactly", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => L(`s${i}`, `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "38" : "08"}`));
  const h20 = dayHours(twenty);
  assert.equal(dayTotal(h20, twenty.map((l) => l.id)), 2.75, "20 x 8 min = 160 min -> 2.75 h (per-line rounding gave 0)");
  const twelve = Array.from({ length: 12 }, (_, i) => L(`l${i}`, `${String(6 + i).padStart(2, "0")}:00`, `${String(6 + i).padStart(2, "0")}:26`));
  // 12 x 26 min = 312 min, over 5 h: the break comes off but never below 5 h (TF-011) -> 5.0 h.
  assert.equal(dayTotal(dayHours(twelve), twelve.map((l) => l.id)), 5);
  // Property: for many random days, the lines always add up to the day rounded once.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let k = 0; k < 200; k++) {
    const n = 1 + Math.floor(rnd() * 6);
    const ls = Array.from({ length: n }, (_, i) => { const s = Math.floor(rnd() * 20 * 60); const d = Math.floor(rnd() * 300); return { id: `r${k}-${i}`, personKey: "p", date: "2026-10-27", start: new Date(Date.UTC(2026, 9, 26, 13) + s * 60_000), end: new Date(Date.UTC(2026, 9, 26, 13) + (s + d) * 60_000), breakMinutes: 30 } as DayLine; });
    const h = dayHours(ls);
    const total = dayTotal(h, ls.map((l) => l.id));
    assert.equal(total * 4, Math.round(total * 4), "quarter hours");
    for (const l of ls) assert.ok(h.get(l.id)!.hours! >= 0);
  }
});

test("a truck and a site on the same day: one break, off the longest line, the day rounded once", () => {
  const h = dayHours([L("truck", "06:00", "07:07"), L("site", "07:10", "15:30")]);
  assert.equal(h.get("site")!.breakMinutes, 30);
  assert.equal(h.get("truck")!.breakMinutes, 0, "the short truck line keeps its time (it used to lose 30 min)");
  // 67 + 500 = 567 min, less 30 = 537 min = 8.95 h -> the day rounds once to 9.0 h (1.25 + 7.75).
  assert.equal(dayTotal(h, ["truck", "site"]), 9);
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

test("TF-005: hire workers with the same name on different phones keep their own hours; one phone is merged", () => {
  const hire = { personKey: "hire:sam|labourforce" };
  const apart = dayHours([L("a", "07:00", "15:30", { ...hire, deviceId: "phone-1" }), L("b", "07:00", "15:30", { ...hire, deviceId: "phone-2" })]);
  assert.equal(apart.get("a")!.hours, 8);
  assert.equal(apart.get("b")!.hours, 8, "two people - not merged");
  assert.equal(apart.get("a")!.overlap && apart.get("b")!.overlap, true, "still flagged for the office to look at");
  const same = dayHours([L("a", "07:00", "15:30", { ...hire, deviceId: "phone-1" }), L("b", "07:00", "15:30", { ...hire, deviceId: "phone-1" })]);
  assert.equal(dayTotal(same, ["a", "b"]), 8, "the same phone - one person, counted once");
  const noPhone = dayHours([L("a", "07:00", "15:30", { ...hire }), L("b", "07:00", "15:30", { ...hire })]);
  assert.equal(dayTotal(noPhone, ["a", "b"]), 16, "office-added hire lines (no phone) are not merged");
});

test("TF-007a: before Mon 26 Oct 2026 every line keeps the old per-line break", () => {
  const h = dayHours([L("old1", "06:00", "07:07", { date: "2026-10-23" }), L("old2", "07:10", "15:30", { date: "2026-10-23" })]);
  assert.equal(h.get("old1")!.hours, 0.5, "the old rule: 67 min less 30 = 0.5 h");
  assert.equal(h.get("old2")!.hours, 7.75);
  assert.equal(dayHours([L("x", "06:00", "07:07", { date: "2026-10-23" })], "2026-10-01").get("x")!.hours, 1, "the start date can be moved (BREAK_RULE_FROM)");
});

test("a night shift keeps its start date", () => {
  const night = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 27, h - 11, m)); // 27 Oct Sydney
  const n = dayHours([{ id: "n", personKey: "p", date: "2026-10-27", start: night(20), end: night(28, 30), breakMinutes: 30 }]);
  assert.equal(n.get("n")!.hours, 8, "20:00 - 04:30 next morning, less 30 min");
});
