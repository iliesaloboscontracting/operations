// Calendar tiles (12 Nov 2026). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agenda, assignColours, assignLanes, buildBars, dayMarks, layoutRows, TILE_SLOTS, weekRows, type SpanForBars } from "./calendarTiles";
import { buildCalendarSpans } from "./calendarSpans";

const FROM = "2026-11-02"; // Monday
const TO = "2026-12-06"; // Sunday - five week rows
const span = (o: Partial<SpanForBars>): SpanForBars => ({
  from: FROM, to: TO, finish: null, finishTbc: false, tentative: false, clippedStart: false, clippedEnd: false, ...o,
});

test("weekRows: Monday to Sunday rows covering the range", () => {
  const rows = weekRows("2026-11-12", "2026-11-30");
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0], "2026-11-09"); // the Monday of the week holding the 12th
  assert.equal(rows[0][6], "2026-11-15");
  assert.equal(rows[3][0], "2026-11-30");
  assert.ok(rows.every((r) => r.length === 7));
  assert.equal(weekRows(FROM, TO).length, 5);
});

test("buildBars: a planned span is one bar; past finish days are OVER; TBC fades at the edge", () => {
  const [b] = buildBars("p", span({ from: "2026-11-04", to: "2026-11-20", finish: "2026-11-20" }), [], FROM, TO);
  assert.equal(b.from, "2026-11-04");
  assert.equal(b.to, "2026-11-20");
  assert.equal(b.kinds.length, 17);
  assert.ok(b.kinds.every((k) => k === "PLAN"));
  assert.equal(b.contStart, false);
  assert.equal(b.contEnd, false);

  // Past its expected finish: the carry-on to today is OVER.
  const [o] = buildBars("o", span({ from: FROM, to: "2026-11-12", finish: "2026-11-06", clippedStart: true }), [], FROM, TO);
  assert.deepEqual(o.kinds.slice(0, 5), ["PLAN", "PLAN", "PLAN", "PLAN", "PLAN"]);
  assert.ok(o.kinds.slice(5).every((k) => k === "OVER"));
  assert.equal(o.contStart, true); // the span started before the view

  // TBC finish: runs to the view's edge and fades there.
  const [t] = buildBars("t", span({ from: "2026-11-20", to: TO, finishTbc: true, clippedEnd: true }), [], FROM, TO);
  assert.equal(t.to, TO);
  assert.equal(t.contEnd, true);
  assert.equal(t.fadeEnd, true);

  // Tentative start is carried to the bar.
  assert.equal(buildBars("x", span({ from: "2026-11-23", to: "2026-11-27", finish: "2026-11-27", tentative: true }), [], FROM, TO)[0].tentative, true);
});

test("buildBars: booked days outside the plan join the bar or make their own; back-to-back days join", () => {
  // No dates at all (like the Yard): booked Mon-Fri for two weeks = ONE bar, the weekend bridged.
  const yard = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"];
  const bars = buildBars("yard", undefined, yard, FROM, TO);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].from, "2026-11-02");
  assert.equal(bars[0].to, "2026-11-11");
  assert.deepEqual(bars[0].kinds, ["BOOKED", "BOOKED", "BOOKED", "BOOKED", "BOOKED", "GAP", "GAP", "BOOKED", "BOOKED", "BOOKED"]);
  assert.equal(bars[0].contStart, false); // booked days never claim to run on past the view

  // A weekday gap splits the bar.
  const split = buildBars("s", undefined, ["2026-11-02", "2026-11-03", "2026-11-05"], FROM, TO);
  assert.deepEqual(split.map((b) => [b.from, b.to]), [["2026-11-02", "2026-11-03"], ["2026-11-05", "2026-11-05"]]);

  // Jobs booked straight after the planned finish carry the bar on (BOOKED days), one continuous bar.
  const after = buildBars("a", span({ from: "2026-11-02", to: "2026-11-04", finish: "2026-11-04" }), ["2026-11-05", "2026-11-06"], FROM, TO);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].kinds, ["PLAN", "PLAN", "PLAN", "BOOKED", "BOOKED"]);

  // A booked day inside the plan stays PLAN; booked days outside the range are ignored.
  const inside = buildBars("i", span({ from: "2026-11-02", to: "2026-11-04", finish: "2026-11-04" }), ["2026-11-03", "2026-10-01", "2027-01-01", "junk"], FROM, TO);
  assert.equal(inside.length, 1);
  assert.deepEqual(inside[0].kinds, ["PLAN", "PLAN", "PLAN"]);

  assert.deepEqual(buildBars("none", undefined, [], FROM, TO), []);
});

test("assignLanes: no overlaps in a lane, start-date order, a project keeps its lane", () => {
  const A = buildBars("A", span({ from: "2026-11-02", to: "2026-11-30", finish: "2026-11-30" }), [], FROM, TO);
  const B = buildBars("B", span({ from: "2026-11-05", to: "2026-11-10", finish: "2026-11-10" }), [], FROM, TO);
  const C = buildBars("C", span({ from: "2026-11-12", to: "2026-11-20", finish: "2026-11-20" }), [], FROM, TO);
  // D has two bars (a weekday gap); its second bar goes back to D's lane.
  const D = buildBars("D", undefined, ["2026-11-03", "2026-11-04", "2026-11-11", "2026-11-12"], FROM, TO);
  const bars = [...C, ...D, ...B, ...A];
  const lanes = assignLanes(bars);
  const lane = (k: string, i = 0) => lanes.get(bars.filter((b) => b.key === k)[i].id);
  assert.equal(lane("A"), 0); // first to start
  assert.equal(lane("D", 0), 1);
  assert.equal(lane("B"), 1); // lane 1 is free again after D's first bar
  assert.equal(lane("D", 1), 1); // D's second bar goes back to D's lane
  assert.equal(lane("C"), 2); // lanes 0 and 1 are busy on the 12th
  for (const x of bars)
    for (const y of bars)
      if (x !== y && lanes.get(x.id) === lanes.get(y.id)) assert.ok(x.to < y.from || y.to < x.from, `${x.id} overlaps ${y.id}`);

  // Same start: the given project order breaks the tie.
  const P = buildBars("P", span({ from: "2026-11-02", to: "2026-11-03", finish: "2026-11-03" }), [], FROM, TO);
  const Q = buildBars("Q", span({ from: "2026-11-02", to: "2026-11-03", finish: "2026-11-03" }), [], FROM, TO);
  const l2 = assignLanes([...P, ...Q], ["Q", "P"]);
  assert.equal(l2.get(Q[0].id), 0);
  assert.equal(l2.get(P[0].id), 1);
  // A project with a later bar returns to its own lane when free.
  const E = buildBars("E", undefined, ["2026-11-02", "2026-11-04"], FROM, TO); // two bars (Tue gap)
  const F = buildBars("F", undefined, ["2026-11-02"], FROM, TO);
  const l3 = assignLanes([...F, ...E], ["E", "F"]);
  assert.equal(l3.get(E[0].id), 0);
  assert.equal(l3.get(E[1].id), 0);
});

test("layoutRows: bars wrap across week rows, carry continuation flags, lanes compact per row", () => {
  const long = buildBars("long", span({ from: "2026-11-04", to: "2026-11-25", finish: "2026-11-25" }), [], FROM, TO);
  const short = buildBars("short", span({ from: "2026-11-02", to: "2026-11-05", finish: "2026-11-05" }), [], FROM, TO);
  const tbc = buildBars("tbc", span({ from: "2026-12-01", to: TO, finishTbc: true, clippedEnd: true }), [], FROM, TO);
  const rows = layoutRows([...long, ...short, ...tbc], weekRows(FROM, TO));
  assert.equal(rows.length, 5);
  const segs = (k: string) => rows.flatMap((r, i) => r.segments.filter((s) => s.bar.key === k).map((s) => ({ row: i, ...s })));

  const L = segs("long");
  assert.deepEqual(L.map((s) => [s.row, s.col, s.span]), [[0, 2, 5], [1, 0, 7], [2, 0, 7], [3, 0, 3]]);
  assert.deepEqual(L.map((s) => [s.contLeft, s.contRight]), [[false, true], [true, true], [true, true], [true, false]]);
  assert.deepEqual(L.map((s) => s.startsHere), [true, false, false, false]);

  // Row 0 holds two overlapping bars (long and short) in different lanes; row 1 only long, compacted to lane 0.
  assert.equal(rows[0].lanes, 2);
  assert.equal(rows[1].lanes, 1);
  assert.equal(rows[1].segments[0].lane, 0);

  // TBC: the last row's segment runs on past the view.
  const T = segs("tbc");
  assert.equal(T.length, 1);
  assert.equal(T[0].row, 4);
  assert.equal(T[0].contRight, true);

  // One row covering the whole range (the 3-month timeline) keeps a bar whole.
  const [one] = layoutRows(long, [weekRows(FROM, TO).flat()]);
  assert.equal(one.segments.length, 1);
  assert.equal(one.segments[0].span, 22);
});

test("dayMarks: day / night crew, red no supervisor, amber gear-only, not running, words", () => {
  const J = (o: Partial<Parameters<typeof dayMarks>[0][0]>) => ({ date: "2026-11-12", shift: "DAY", crew: 0, plant: 0, hire: 0, hasSupervisor: true, notRunning: false, ...o });
  const m = dayMarks([
    J({ crew: 2, plant: 1 }),
    J({ shift: "NIGHT", crew: 3, hasSupervisor: false }),
    J({ date: "2026-11-13", plant: 2 }), // gear, nobody on it
    J({ date: "2026-11-14", crew: 2, notRunning: true }),
    J({ date: "2026-11-15" }), // nothing allocated - not shown at all
  ]);
  const d = m.get("2026-11-12")!;
  assert.equal(d.day?.crew, 2);
  assert.equal(d.night?.crew, 3);
  assert.equal(d.warn, "NO_SUPERVISOR");
  assert.equal(d.booked, true);
  assert.equal(d.words, "Day 2 crew, 1 plant · Night 3 crew - no supervisor");
  assert.equal(m.get("2026-11-13")!.warn, "NO_CREW");
  assert.equal(m.get("2026-11-13")!.words, "Day no crew, 2 plant - gear but no crew");
  assert.equal(m.get("2026-11-14")!.notRunning, true);
  assert.equal(m.get("2026-11-14")!.booked, false);
  assert.equal(m.get("2026-11-14")!.words, "Not running");
  assert.equal(m.has("2026-11-15"), false);
});

test("assignColours: keyed by id, stable when the visible set changes, unique up to the slot count, then neutral", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `cproj${i.toString().padStart(3, "0")}`);
  const all = assignColours([ids]);
  const slots = ids.map((i) => all.get(i)!.slot);
  assert.equal(new Set(slots).size, ids.length); // all distinct
  // A new (later) project arriving doesn't repaint anyone.
  const more = assignColours([[...ids, "czz-new"]]);
  assert.ok(ids.every((i) => more.get(i)!.slot === all.get(i)!.slot));
  // Order of the input doesn't matter.
  const rev = assignColours([[...ids].reverse()]);
  assert.ok(ids.every((i) => rev.get(i)!.slot === all.get(i)!.slot));
  // More projects than slots: the rest are neutral (labelled grey).
  const many = Array.from({ length: TILE_SLOTS + 3 }, (_, i) => `c${i}`);
  const m = assignColours([many]);
  assert.equal([...m.values()].filter((c) => c.slot === null).length, 3);
  assert.equal(new Set([...m.values()].filter((c) => c.slot !== null).map((c) => c.slot)).size, TILE_SLOTS);
  // Keys outside the pool (a job with no project) still get one.
  assert.ok(assignColours([ids], ["t:Yard"]).get("t:Yard"));
  // Tiers: the first tier (active) is served before the second (inactive), whatever the ids.
  const tiered = assignColours([["z-active"], many]);
  assert.notEqual(tiered.get("z-active")!.slot, null);
  // A key in a tier and in extra is assigned once.
  assert.equal(assignColours([["a"]], ["a"]).size, 1);
});

test("agenda: each day's running projects, 'continuing' after the first day, weekends bridged are left out", () => {
  const yard = buildBars("yard", undefined, ["2026-11-06", "2026-11-09"], FROM, TO); // Fri, (weekend), Mon
  const plan = buildBars("plan", span({ from: FROM, to: "2026-11-10", finish: "2026-11-10", clippedStart: true }), [], FROM, TO);
  const days = ["2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10", "2026-11-11"];
  const a = agenda([...yard, ...plan], days, ["yard", "plan"]);
  assert.deepEqual(a[0].entries.map((e) => [e.key, e.continuing]), [["yard", false], ["plan", true]]);
  assert.deepEqual(a[1].entries.map((e) => e.key), ["plan"]); // Saturday: the yard's bridged weekend isn't listed
  assert.deepEqual(a[2].entries.map((e) => [e.key, e.continuing, e.lastDay]), [["yard", true, true], ["plan", true, false]]);
  assert.deepEqual(a[3].entries.map((e) => [e.key, e.lastDay]), [["plan", true]]);
  assert.equal(a[4].entries.length, 0);
});

test("calendarSpans output feeds buildBars directly (TBC, past finish, tentative)", () => {
  const res = buildCalendarSpans(
    [
      { id: "tbc", name: "tbc", jobNo: null, status: "ACTIVE", startDate: "2026-11-20", startDateConfidence: null, expectedCompletion: "TBC" },
      { id: "over", name: "over", jobNo: null, status: "ACTIVE", startDate: "2026-10-01", startDateConfidence: "CONFIRMED", expectedCompletion: "2026-11-06" },
      { id: "tent", name: "tent", jobNo: null, status: "ACTIVE", startDate: "2026-11-23", startDateConfidence: "TENTATIVE", expectedCompletion: "2026-12-04" },
    ],
    new Map(),
    FROM,
    TO,
    "2026-11-12"
  );
  const s = (id: string) => res.spans.find((x) => x.projectId === id)!;
  const [tbc] = buildBars("tbc", s("tbc"), [], FROM, TO);
  assert.equal(tbc.fadeEnd, true);
  const [over] = buildBars("over", s("over"), [], FROM, TO);
  assert.equal(over.contStart, true);
  assert.equal(over.to, "2026-11-12");
  assert.equal(over.kinds.filter((k) => k === "OVER").length, 6);
  assert.equal(buildBars("tent", s("tent"), [], FROM, TO)[0].tentative, true);
});
