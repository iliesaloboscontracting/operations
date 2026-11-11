import { test } from "node:test";
import assert from "node:assert/strict";
import { break4hFrom, breakRuleFor, dayHours, type DayLine } from "./dayHours";

// Sydney wall-clock for late Oct / Nov 2026 (AEDT, UTC+11). The day rule applies from Mon 26 Oct 2026 (TF-007a). These
// first tests are on 26 / 27 Oct - the 5-hour rule (26 Oct - 1 Nov). The 4-hour rule (from 2 Nov) is further down.
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

// ---- 12 Nov 2026, Ilies: "change it to over 4 hours from this week but adjust the hours on the new rule from last week
// aswell" (from Mon 2 Nov 2026, BREAK_4H_FROM); "Alex is on salary and therefore this rule wouldnt apply to him or anyone
// else on salary"; labour hire "same new rule". ----
const nov = (hhmm: string, day = 2) => { const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(2026, 10, day, h - 11, m)); };
const N = (id: string, a: string, b: string | null, o: Partial<DayLine> = {}): DayLine => ({ id, personKey: "carlos", date: "2026-11-02", start: nov(a), end: b ? nov(b) : null, breakMinutes: 30, ...o });

test("from Mon 2 Nov 2026: the whole break comes off any day over 4 h, no floor; 4 h or less, no break", () => {
  const one = (b: string, o: Partial<DayLine> = {}) => dayHours([N("a", "07:00", b, o)]).get("a")!;
  assert.deepEqual(one("11:00"), { hours: 4, overlap: false, breakMinutes: 0 }, "exactly 4:00 -> no break");
  assert.equal(one("10:30").hours, 3.5, "3:30 -> no break");
  assert.deepEqual(one("11:01"), { hours: 3.5, overlap: false, breakMinutes: 30 }, "4:01 -> 3.5");
  assert.equal(one("11:37").hours, 4, "4:37 -> 4:07 -> 4.0");
  assert.equal(one("12:03").hours, 4.5, "5:03 -> 4:33 -> 4.5");
  assert.equal(one("12:28").hours, 5, "5:28 -> 4:58 -> 5.0");
  assert.equal(one("12:10").hours, 4.75, "5:10 -> 4:40 -> 4.75 (the 5-hour rule gave 5.0)");
  assert.equal(one("15:30").hours, 8, "8:30 -> 8.0, as before");
});

test("each date gets its own rule: 2 Nov the 4-hour rule, 30 Oct the 5-hour rule, 20 Oct the old per-line rule", () => {
  const h = dayHours([
    N("nov2", "07:00", "11:30"),
    N("oct30", "07:00", "11:30", { date: "2026-10-30" }),
    N("oct30b", "07:00", "12:10", { date: "2026-10-30", personKey: "sam" }),
    N("oct20a", "06:00", "07:07", { date: "2026-10-20" }),
    N("oct20b", "07:10", "11:30", { date: "2026-10-20" }),
  ]);
  assert.equal(h.get("nov2")!.hours, 4, "2 Nov: 4:30 over 4 h -> 4.0");
  assert.equal(h.get("oct30")!.hours, 4.5, "30 Oct: 4:30 is not over 5 h -> no break");
  assert.equal(h.get("oct30b")!.hours, 5, "30 Oct: 5:10 never below 5 -> 5.0 (TF-011 kept for 26 Oct - 1 Nov)");
  assert.equal(h.get("oct20a")!.hours, 0.5, "20 Oct: each line its own break (67 min less 30)");
  assert.equal(h.get("oct20b")!.hours, 3.75, "20 Oct: 4:20 less 30 -> 3.75 on its own");
  assert.equal(dayHours([N("x", "07:00", "11:30", { date: "2026-11-01" })]).get("x")!.hours, 4.5, "Sun 1 Nov is still the 5-hour rule");
});

test("salaried staff: no break at all from 2 Nov; before it, unchanged", () => {
  const sal = { noBreak: true };
  assert.deepEqual(dayHours([N("a", "07:00", "15:30", sal)]).get("a"), { hours: 8.5, overlap: false, breakMinutes: 0 }, "8:30 -> 8.5, nothing off");
  assert.equal(dayHours([N("a", "07:00", "11:01", sal)]).get("a")!.hours, 4, "4:01 -> 4.0 (rounded once, no break)");
  // A salaried person's whole day: a truck line and a site line, no break off either, rounded once.
  const two = dayHours([N("truck", "06:00", "07:07", sal), N("site", "07:10", "15:30", sal)]);
  assert.equal(dayTotal(two, ["truck", "site"]), 9.5, "67 + 500 = 567 min -> 9.45 h -> 9.5");
  assert.equal(two.get("site")!.breakMinutes + two.get("truck")!.breakMinutes, 0);
  // Before 2 Nov the flag changes nothing.
  assert.deepEqual(dayHours([N("b", "07:00", "15:30", { ...sal, date: "2026-10-30" })]).get("b"), dayHours([N("b", "07:00", "15:30", { date: "2026-10-30" })]).get("b"));
  assert.equal(dayHours([N("b", "07:00", "15:30", { ...sal, date: "2026-10-30" })]).get("b")!.hours, 8, "30 Oct: the 5-hour rule, break off");
  assert.equal(dayHours([N("c", "07:00", "15:30", { ...sal, date: "2026-10-20" })]).get("c")!.hours, 8, "20 Oct: the old per-line rule, break off");
  // A hire line is never salaried, whatever the flag says.
  assert.equal(dayHours([N("h", "07:00", "15:30", { ...sal, personKey: "hire:sam|labourforce" })]).get("h")!.hours, 8);
});

test("overlaps with the 4-hour rule: the shared time counts once, then one break if the merged day is over 4 h", () => {
  // Truck 06:00-09:00 and site 08:00-10:15: merged 06:00-10:15 = 4:15, over 4 h -> less 30 = 3:45.
  const h = dayHours([N("truck", "06:00", "09:00"), N("site", "08:00", "10:15")]);
  assert.equal(dayTotal(h, ["truck", "site"]), 3.75);
  assert.equal(h.get("truck")!.overlap && h.get("site")!.overlap, true);
  assert.equal(h.get("truck")!.breakMinutes + h.get("site")!.breakMinutes, 30, "one break for the day");
  // Merged to exactly 4:00 -> no break even though the two lines add up to more.
  const four = dayHours([N("a", "07:00", "10:00"), N("b", "09:00", "11:00")]);
  assert.equal(dayTotal(four, ["a", "b"]), 4);
});

test("labour hire (no register person) gets the same 4-hour rule", () => {
  const hire = { personKey: "hire:sam|labourforce", deviceId: "phone-1" };
  assert.equal(dayHours([N("a", "07:00", "11:01", hire)]).get("a")!.hours, 3.5, "4:01 -> 3.5");
  assert.equal(dayHours([N("a", "07:00", "11:00", hire)]).get("a")!.hours, 4, "4:00 -> no break");
  assert.equal(dayHours([N("a", "07:00", "12:03", hire)]).get("a")!.hours, 4.5, "5:03 -> 4.5");
});

test("BREAK_4H_FROM moves the start of the 4-hour rule (argument and environment)", () => {
  const line = N("a", "07:00", "11:30", { date: "2026-11-02" });
  assert.equal(dayHours([line], "2026-10-26", "2026-11-09").get("a")!.hours, 4.5, "4-hour rule from 9 Nov: 2 Nov is still the 5-hour rule");
  assert.equal(dayHours([{ ...line, date: "2026-10-28" }], "2026-10-26", "2026-10-27").get("a")!.hours, 4, "4-hour rule from 27 Oct");
  const before = process.env.BREAK_4H_FROM;
  try {
    process.env.BREAK_4H_FROM = "2026-11-09";
    assert.equal(break4hFrom(), "2026-11-09");
    assert.equal(dayHours([line]).get("a")!.hours, 4.5, "from the environment");
    process.env.BREAK_4H_FROM = "not a date";
    assert.equal(break4hFrom(), "2026-11-02", "a bad value falls back to 2 Nov 2026");
  } finally {
    if (before === undefined) delete process.env.BREAK_4H_FROM; else process.env.BREAK_4H_FROM = before;
  }
  assert.equal(breakRuleFor("2026-10-20"), "PER_LINE");
  assert.equal(breakRuleFor("2026-11-01"), "OVER_5H");
  assert.equal(breakRuleFor("2026-11-02"), "OVER_4H");
});
