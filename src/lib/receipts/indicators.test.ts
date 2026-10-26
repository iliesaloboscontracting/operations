// Receipts R4 - indicators (design §Indicators): per job loads / tonnes / tip cost / $/t / asbestos
// and new tip sites; per truck km a day, fuel by day and week, L/100 km between odometer readings and
// the 25%-above-its-own-8-week-average flag. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intervals, jobTips, newTipSites, truckIndicators, weekOf, type JobDocket } from "./indicators";

const D = (id: string, x: Partial<JobDocket> = {}): JobDocket => ({ id, day: "2026-10-20", tipSite: "Bingo Eastern Creek", tonnes: 5, asbestos: false, amount: 600, ...x });

test("per job: loads, tonnes, tip cost, $/tonne over priced loads, asbestos, unpriced", () => {
  const t = jobTips([D("a"), D("b", { tonnes: 3, amount: 450 }), D("c", { tonnes: 2, amount: null, asbestos: true }), D("d", { tonnes: null, amount: 100 })]);
  assert.deepEqual(t, { loads: 4, tonnes: 10, tipCost: 1150, perTonne: 131.25, asbestosLoads: 1, unpriced: 1 });
  assert.equal(jobTips([]).perTonne, null);
  assert.equal(jobTips([D("x", { amount: null })]).tipCost, 0);
});

test("a tip site the job hadn't used before - never its first site", () => {
  const n = newTipSites([D("1", { day: "2026-10-01" }), D("2", { day: "2026-10-02", tipSite: "bingo  eastern creek" }), D("3", { day: "2026-10-05", tipSite: "Cleanaway Erskine Park" }), D("4", { day: "2026-10-06", tipSite: "Cleanaway Erskine Park" }), D("5", { tipSite: null })]);
  assert.deepEqual(n.map((x) => x.id), ["3"]);
  assert.deepEqual(newTipSites([D("only")]), []);
});

const at = (s: string) => new Date(s);
const NOW = at("2026-10-27T00:00:00Z");

test("L/100 km: fuel bought after one reading up to the next, over the distance between them", () => {
  const iv = intervals(
    [{ at: at("2026-10-20T20:00:00Z"), km: 100_000 }, { at: at("2026-10-22T20:00:00Z"), km: 100_400 }, { at: at("2026-10-23T20:00:00Z"), km: 100_400 }],
    [{ at: at("2026-10-21T03:00:00Z"), litres: 80, total: 170 }, { at: at("2026-10-22T20:00:00Z"), litres: 40, total: 85 }, { at: at("2026-10-20T19:00:00Z"), litres: 999, total: 0 }],
  );
  assert.equal(iv.length, 1, "no distance -> no interval; fuel before the first reading isn't counted");
  assert.deepEqual([iv[0].km, iv[0].litres, iv[0].per100], [400, 120, 30]);
});

test("per truck: km a day, fuel by day and week, the 25% flag against its own 8-week average", () => {
  // Readings every 2 days, 500 km apart; 150 L between each (30 L/100 km), then the latest at 200 L (40 L/100 km).
  const odos = [0, 2, 4, 6, 8].map((d, i) => ({ at: new Date(at("2026-10-18T20:00:00Z").getTime() + d * 86_400_000), km: 200_000 + i * 500 }));
  const fuel = [1, 3, 5].map((d) => ({ at: new Date(at("2026-10-18T22:00:00Z").getTime() + d * 86_400_000), litres: 150, total: 320 }))
    .concat([{ at: new Date(at("2026-10-25T22:00:00Z").getTime()), litres: 200, total: 430 }]);
  const t = truckIndicators(odos, fuel, NOW);
  assert.equal(t.lastKm, 202_000);
  assert.equal(t.kmPerDay, 250, "2,000 km over 8 days");
  assert.deepEqual([t.latestPer100, t.avgPer100, t.highConsumption], [40, 30, true], "40 is more than 25% above 30");
  assert.equal(t.fuelByWeek.reduce((n, w) => n + w.litres, 0), 650);
  assert.ok(t.fuelByDay.length >= 3 && t.fuelByDay[0].day >= t.fuelByDay[1].day, "newest day first");
  const calm = truckIndicators(odos, fuel.map((f) => ({ ...f, litres: 150 })), NOW);
  assert.equal(calm.highConsumption, false, "steady use: no flag");
  assert.equal(truckIndicators(odos.slice(0, 2), fuel.slice(0, 1), NOW).avgPer100, null, "one interval: nothing to compare with, no flag");
  assert.deepEqual(truckIndicators([], [], NOW), { lastKm: null, lastKmAt: null, kmPerDay: null, fuelByDay: [], fuelByWeek: [], latestPer100: null, avgPer100: null, highConsumption: false, intervals: 0 });
});

test("weeks start on Monday", () => {
  assert.equal(weekOf("2026-10-26"), "2026-10-26"); // a Monday
  assert.equal(weekOf("2026-11-01"), "2026-10-26"); // Sunday
  assert.equal(weekOf("2026-10-25"), "2026-10-19");
});
