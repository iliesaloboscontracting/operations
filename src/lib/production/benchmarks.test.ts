// Production benchmarks (LCI 5b, design §3.5): the h/unit maths (several packages sharing one code), the
// evidence bar, docket quantities per unit (de-duplicated), delay hours shown but never taken off, the
// confidence word, the evidence fingerprint, and no money in the offer. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSuggestion, combine, confidenceOf, jobFigures, suggestionIsSafe, type EvidenceLog, type JobEvidence } from "./benchmarks";

const log = (i: number, x: Partial<EvidenceLog> = {}): EvidenceLog => ({ id: `L${i}`, date: `2026-11-${String(i).padStart(2, "0")}`, crewOk: true, delayHours: 0, labour: [{ code: "STR-02", hours: 8 }], dockets: [], ...x });
const job = (x: Partial<JobEvidence> = {}): JobEvidence => ({
  projectId: "P1", projectName: "Myers", jobRef: "26_401", finished: false,
  logs: [1, 2, 3, 4].map((i) => log(i)), // 32 h on STR-02
  packages: [{ packageId: "a", code: "STR-02", qty: 400, unit: "m²", labourHrs: 64 }],
  pct: new Map([["pkg:a", 50]]), receiptDockets: [], ...x,
});
const fig = (j: JobEvidence, code = "STR-02") => jobFigures(j).find((f) => f.code === code)!;

test("h/unit = hours on the code ÷ (budget quantity × latest %): the design's STR-02 example", () => {
  const f = fig(job());
  assert.equal(f.quantity, 200, "400 m² × 50%");
  assert.equal(f.hrsPerUnit, 0.16, "32 h ÷ 200 m²");
  assert.equal(f.budgetHrsPerUnit, 0.16, "64 h ÷ 400 m²");
  assert.equal(f.pctComplete, 50);
});

test("several packages sharing one code are added together", () => {
  const f = fig(job({
    packages: [{ packageId: "a", code: "STR-02", qty: 400, unit: "m²", labourHrs: 64 }, { packageId: "b", code: "STR-02", qty: 100, unit: "m²", labourHrs: 30 }],
    pct: new Map([["pkg:a", 50], ["pkg:b", 100]]),
  }));
  assert.equal(f.quantity, 300, "200 + 100 done");
  assert.equal(f.hrsPerUnit, Number((32 / 300).toFixed(4)));
  assert.equal(f.budgetHrsPerUnit, Number((94 / 500).toFixed(4)));
  assert.equal(f.pctComplete, 60, "300 of 500, by quantity");
  const mixed = fig(job({ packages: [{ packageId: "a", code: "STR-02", qty: 400, unit: "m²", labourHrs: 64 }, { packageId: "b", code: "STR-02", qty: 50, unit: "lm", labourHrs: 10 }], pct: new Map([["pkg:a", 50], ["pkg:b", 50]]) }));
  assert.equal(mixed.passes, false);
  assert.match(mixed.missing.join(), /different units/);
});

test("the evidence bar: 50% (or finished), 5 logs, the unit, no more than 20% crew by hand", () => {
  assert.match(fig(job()).missing.join(), /4 logs \(needs 5\)/, "4 logs isn't enough");
  const five = job({ logs: [1, 2, 3, 4, 5].map((i) => log(i)) });
  assert.equal(fig(five).passes, true);
  assert.match(fig({ ...five, pct: new Map([["pkg:a", 40]]) }).missing.join(), /only 40% complete/);
  assert.equal(fig({ ...five, pct: new Map([["pkg:a", 40]]), finished: true }).passes, true, "a finished job counts below 50%");
  assert.match(fig({ ...five, pct: new Map() }).missing.join(), /no % complete yet/);
  const hand = job({ logs: [1, 2, 3, 4, 5].map((i) => log(i, { crewOk: i > 2 })) });
  assert.match(fig(hand).missing.join(), /2 of 5 logs had the crew entered by hand/, "40% by hand");
  const oneHand = job({ logs: [1, 2, 3, 4, 5].map((i) => log(i, { crewOk: i > 1 })) });
  assert.equal(fig(oneHand).passes, true, "20% by hand is allowed");
  assert.match(fig({ ...five, packages: null }).missing.join(), /no approved budget/);
  assert.match(fig({ ...five, packages: [{ packageId: "a", code: "STR-02", qty: 4, unit: "each", labourHrs: 8 }] }).missing.join(), /isn't one of STR-02's units/);
});

test("docket codes: quantity per unit from the logs' dockets and read tip dockets, same docket counted once", () => {
  const j = job({
    logs: [1, 2, 3, 4, 5].map((i) => log(i, { labour: [{ code: "DEM-10", hours: 4 }], dockets: i <= 2 ? [{ code: "DEM-10", quantity: 6, unit: "t", docketNo: `A${i}` }] : [] })),
    packages: [{ packageId: "w", code: "DEM-10", qty: 100, unit: "t", labourHrs: 40 }], pct: new Map([["pkg:w", 50]]),
    receiptDockets: [{ code: "DEM-10", quantity: 6, unit: "t", docketNo: "a-1" }, { code: "DEM-10", quantity: 8, unit: "t", docketNo: "B9" }],
  });
  const f = fig(j, "DEM-10");
  assert.equal(f.method, "DOCKETS");
  assert.equal(f.quantity, 20, "6 + 6 + 8 - the receipt for A1 isn't counted twice");
  assert.equal(f.hrsPerUnit, 1, "20 h ÷ 20 t");
  assert.equal(f.perHour, 1);
  assert.equal(f.budgetHrsPerUnit, 0.4);
  assert.equal(f.passes, true);
  const m3 = fig({ ...j, receiptDockets: [], logs: j.logs.map((l) => ({ ...l, dockets: l.dockets.map((d) => ({ ...d, unit: "m³" })) })) }, "DEM-10");
  assert.match(m3.missing.join(), /docket unit m³ doesn't match the budget's t/);
});

test("delay hours are shown, never taken off the hours", () => {
  const f = fig(job({ logs: [1, 2, 3, 4, 5].map((i) => log(i, { delayHours: i === 1 ? 3 : 0 })) }));
  assert.equal(f.delayHours, 3);
  assert.equal(f.hours, 40, "still all 40 h");
});

test("across jobs: only jobs that clear the bar count; confidence; the evidence fingerprint", () => {
  const a = job({ logs: [1, 2, 3, 4, 5].map((i) => log(i)) });
  const b = job({ projectId: "P2", projectName: "Bronte", jobRef: "26_402", logs: [1, 2, 3, 4, 5, 6].map((i) => log(i, { id: `M${i}` } as Partial<EvidenceLog>)), pct: new Map([["pkg:a", 100]]) });
  const early = job({ projectId: "P3", projectName: "Early", jobRef: "26_403" });
  const [c] = combine([...jobFigures(a), ...jobFigures(b), ...jobFigures(early)]);
  assert.deepEqual(c.jobs, ["26_401", "26_402"], "the early job is listed but doesn't count");
  assert.equal(c.jobFigures.length, 3);
  assert.equal(c.hrsPerUnit, Number(((40 + 48) / (200 + 400)).toFixed(4)));
  assert.equal(c.logs, 11);
  assert.equal(c.confidence, "MEDIUM");
  assert.equal(confidenceOf(3, 15), "HIGH");
  assert.equal(confidenceOf(1, 5), "LOW");
  assert.equal(confidenceOf(0, 40), null);
  const [again] = combine([...jobFigures(b), ...jobFigures(a)]);
  assert.equal(again.evidenceHash, c.evidenceHash, "the same evidence gives the same fingerprint, in any order");
  const [more] = combine([...jobFigures(a), ...jobFigures({ ...b, logs: [...b.logs, log(9, { id: "M9" } as Partial<EvidenceLog>)] })]);
  assert.notEqual(more.evidenceHash, c.evidenceHash, "a new log is new evidence");
  const [none] = combine(jobFigures(early));
  assert.equal(none.confidence, null);
  assert.equal(buildSuggestion(none, "abcdef123"), null, "below the bar: never offered");
});

test("the offer: exactly the agreed keys, hours only - no money words anywhere", () => {
  const [c] = combine(jobFigures(job({ logs: [1, 2, 3, 4, 5].map((i) => log(i)) })));
  const s = buildSuggestion(c, "cmabc123456")!;
  assert.deepEqual(Object.keys(s), ["schema_version", "suggestion_id", "code", "unit", "labour_hrs_per_unit", "budget_hrs_per_unit", "sample", "delays_hrs", "confidence", "evidence_hash"]);
  assert.equal(s.schema_version, "production-suggestion.v1");
  assert.ok(suggestionIsSafe(s));
  assert.equal(suggestionIsSafe({ ...s, sample: { ...s.sample, jobs: ["Value Street demo"] } }), false, "Estimating treats 'value' as money - caught before sending");
  assert.equal(suggestionIsSafe({ ...s, confidence: "$400" } as unknown as typeof s), false);
  assert.equal(suggestionIsSafe({ ...s, extra: 1 } as typeof s), false, "no extra keys");
});
