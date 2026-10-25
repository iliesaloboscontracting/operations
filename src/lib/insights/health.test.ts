// Company health band (G1, 25 Oct 2026): six tiles, Operations data only;
// pipeline / revenue / cash never show a number until connected; headroom
// is contract less Tracking's forecast; status and confidence rules. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyHealth, contractJobs, type HealthInput } from "./health";

const job = (health: string, contractValue: number | null, forecastCost: number, status = "ACTIVE") =>
  ({ status, health, contractValue, forecastCost }) as HealthInput["projects"][number];

const base = (x: Partial<HealthInput> = {}): HealthInput => ({
  asAt: "2026-10-25T01:00:00.000Z",
  projects: [job("ON_TRACK", 100_000, 50_000), job("WATCH", 200_000, 170_000), job("OVERHEAD", null, 9_000), job("ON_TRACK", 50_000, 10_000, "COMPLETED")],
  workload: { active: 2, starting: [{ confidence: "CONFIRMED" }, { confidence: "TENTATIVE" }], completing: [{}] },
  cost: { health: { act: 0, watch: 1, onTrack: 1, cantAssess: 0 }, stillToCome: 12_000 },
  costConfidence: "MEDIUM",
  capacity: { available: 12, shortDays: [] },
  supervisorGaps: 0,
  activeCrew: 12,
  hours: [
    { week: "2026-10-12", staff: 0, hire: 0, partial: false, incomplete: true },
    { week: "2026-10-19", staff: 400, hire: 120, partial: false, incomplete: true },
    { week: "2026-10-26", staff: 50, hire: 0, partial: true, incomplete: false },
  ],
  ...x,
});
const tile = (h: ReturnType<typeof companyHealth>, id: string) => h.find((t) => t.id === id)!;

test("six tiles in the plan's order; the three unconnected sources show no number and no as-at", () => {
  const h = companyHealth(base());
  assert.deepEqual(h.map((t) => t.id), ["pipeline", "workInHand", "costVsContract", "revenue", "cash", "people"]);
  for (const id of ["pipeline", "revenue", "cash"]) {
    const t = tile(h, id);
    assert.equal(t.status, "NOT_CONNECTED");
    assert.equal(t.headline, null);
    assert.equal(t.asAt, null);
    assert.equal(t.confidence, null);
    assert.match(t.statusWord, /Not connected/);
  }
});

test("contract jobs: active only, overhead buckets out, no-value jobs counted apart; headroom = contract - forecast", () => {
  const c = contractJobs([...base().projects, job("CANT_ASSESS", null, 5_000)]);
  assert.deepEqual([c.active, c.valued, c.noValue], [3, 2, 1]);
  assert.equal(c.contract, 300_000);
  assert.equal(c.headroom, 80_000);
  assert.equal(Math.round(c.usedPct! * 100), 73);
  assert.equal(contractJobs([job("ACT", 100_000, 130_000)]).over, 1);
});

test("work in hand: provisional, never HIGH; LOW when contract values are missing", () => {
  const h = companyHealth(base());
  const w = tile(h, "workInHand");
  assert.equal(w.statusWord, "Provisional");
  assert.equal(w.headline, "$300k");
  assert.equal(w.confidence, "MEDIUM");
  assert.match(w.lines.join(" "), /73% of the contract value/);
  assert.match(w.lines.join(" "), /Starting in 30 days: 2 \(1 confirmed\)/);
  const gaps = companyHealth(base({ projects: [job("ON_TRACK", 100_000, 50_000), job("CANT_ASSESS", null, 1), job("CANT_ASSESS", null, 1)] }));
  assert.equal(tile(gaps, "workInHand").confidence, "LOW");
  assert.match(tile(gaps, "workInHand").lines[0], /1 of 3 active jobs have a contract value/);
  assert.match(w.lines[0], /2 active jobs, all with a contract value/);
});

test("cost vs contract: Act beats Watch beats On track; confidence never above the cost confidence or MEDIUM", () => {
  assert.equal(tile(companyHealth(base()), "costVsContract").status, "WATCH");
  assert.equal(tile(companyHealth(base()), "costVsContract").headline, "$80k");
  const act = companyHealth(base({ cost: { health: { act: 2, watch: 1, onTrack: 0, cantAssess: 3 }, stillToCome: 0 } }));
  assert.equal(tile(act, "costVsContract").status, "ACT");
  assert.equal(tile(act, "costVsContract").statusWord, "Act on 2 jobs");
  assert.match(tile(act, "costVsContract").missing!, /3 jobs/);
  const ok = companyHealth(base({ cost: { health: { act: 0, watch: 0, onTrack: 4, cantAssess: 0 }, stillToCome: 0 }, costConfidence: "HIGH" }));
  assert.equal(tile(ok, "costVsContract").status, "OK");
  assert.equal(tile(ok, "costVsContract").confidence, "MEDIUM");
  assert.equal(tile(companyHealth(base({ costConfidence: "LOW" })), "costVsContract").confidence, "LOW");
  const none = companyHealth(base({ cost: { health: { act: 0, watch: 0, onTrack: 0, cantAssess: 2 }, stillToCome: 0 }, projects: [job("CANT_ASSESS", null, 0)] }));
  assert.equal(tile(none, "costVsContract").statusWord, "Can't assess");
  assert.equal(tile(none, "costVsContract").headline, null);
});

test("people: last full week's hours (trial week flagged, LOW); short crew days or missing leads -> Watch", () => {
  const p = tile(companyHealth(base()), "people");
  assert.equal(p.status, "OK");
  assert.match(p.lines[0], /520 hours signed \(120 hire\) - trial week/);
  assert.equal(p.confidence, "LOW");
  assert.match(p.lines[2], /incident register not connected/);
  const short = tile(companyHealth(base({ capacity: { available: 12, shortDays: [{}, {}] }, supervisorGaps: 1 })), "people");
  assert.equal(short.status, "WATCH");
  assert.equal(short.statusWord, "Short of crew on 2 days");
  const full = base();
  full.hours[1].incomplete = false;
  assert.equal(tile(companyHealth(full), "people").confidence, "MEDIUM");
  assert.equal(p.headline, "12 crew");
  const none = base();
  none.hours[1] = { ...none.hours[1], staff: 0, hire: 0 };
  assert.equal(tile(companyHealth(none), "people").lines[0], "No full tracked week of sign-ins yet");
});

test("no dollar figure on a not-connected tile, and nothing is called margin", () => {
  const h = companyHealth(base());
  for (const t of h.filter((x) => x.status === "NOT_CONNECTED")) assert.ok(!JSON.stringify(t).match(/\$\s?\d/));
  assert.ok(!JSON.stringify(h).match(/margin/i));
});
