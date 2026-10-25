// Pipeline on the Directors screen (G5, 25 Oct 2026): open work with
// outcome-unknown imports taken off, confidence, won tender -> project
// matching (imported rows skipped), the tile's states including "Estimating
// not reachable", and the won-tender finding. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchWon, openWork, pipelineConfidence, pipelineTile, type PipelineV1, type WonTenderRow } from "./pipeline";
import { buildSignals, notChecked, wonNoProjectSignals, type WonTenderInput } from "../findings/signals";
import { planRun, type FindingState } from "../findings/engine";

const pipe = (x: Partial<PipelineV1> = {}, dq: Partial<PipelineV1["data_quality"]> = {}): PipelineV1 => ({
  schema_version: "pipeline.v1", generated_at: "2026-10-25T01:00:00.000Z", as_at: "2026-10-25", period: { from: "2025-10-25", to: "2026-10-25" },
  counts: { received: 2, estimating: 3, submitted: 10, won: 4, lost: 6, withdrawn: 0, declined: 1 },
  values_ex_gst: { submitted_open: 850_000, won_period: 400_000, lost_period: 600_000 },
  win_rates: { win_rate_by_count: 0.4, win_rate_by_value: 0.4, definition: "won / (won + lost)" },
  due_soon: [{ quoteNo: "26_901", name: "A", due_date: "2026-10-27", overdue: false, estimator: "Ilies", status: "estimating", builders: 2 }],
  by_estimator: [{ estimator: "Ilies", open: 15, submitted_period: 12, won_period: 3 }, { estimator: "Yoel", open: 0, submitted_period: 2, won_period: 1 }],
  by_work_type: [],
  stale: { submitted_over_90_days: 0 },
  data_quality: { outcomes_overdue: 0, duplicate_numbers_unresolved: 0, open_without_due_date: 0, ...dq },
  ...x,
});
const won = (x: Partial<WonTenderRow>): WonTenderRow => ({
  tender_id: "t1", quoteNo: "26_168", jobNo: "26_168", name: "Westfield", client: "", builder_awarded: "Built", site: "", work_type: "",
  won_date: "2026-10-10", estimator: "Ilies", awarded_value_ex_gst: 64_000, ...x,
});

test("open work: outcome-unknown imports come off the submitted count (E9); missing keys = 0", () => {
  assert.equal(openWork(pipe()).submittedOpen, 10);
  assert.equal(openWork(pipe()).beingPriced, 5);
  const e9 = openWork(pipe({}, { outcome_unknown: 7, needs_review: 3 }));
  assert.deepEqual([e9.submittedOpen, e9.outcomeUnknown, e9.needsReview], [3, 7, 3]);
  assert.equal(openWork(pipe({}, { outcome_unknown: 99 })).submittedOpen, 0);
});

test("confidence: never HIGH; LOW while outcomes are missing or the register is empty", () => {
  assert.equal(pipelineConfidence(pipe()).level, "MEDIUM");
  assert.equal(pipelineConfidence(pipe({}, { outcome_unknown: 1 })).level, "LOW");
  assert.equal(pipelineConfidence(pipe({}, { needs_review: 2 })).level, "LOW");
  assert.equal(pipelineConfidence(pipe({}, { outcomes_overdue: 4 })).level, "LOW");
  assert.equal(pipelineConfidence(pipe({ counts: { received: 0, submitted: 0 } })).level, "LOW");
});

test("won tenders match projects on job or quote number; imported ones are skipped; missing `imported` = false", () => {
  const projects = [{ id: "p1", name: "Westfield L2", jobNo: "26_168", quoteNo: null }, { id: "p2", name: "Myers", jobNo: "26_100", quoteNo: "26_099" }];
  const rows = matchWon([
    won({}),
    won({ tender_id: "t2", quoteNo: "26_099", jobNo: null }),
    won({ tender_id: "t3", quoteNo: "26_500", jobNo: "26_500" }),
    won({ tender_id: "t4", quoteNo: "24_010", jobNo: null, imported: true }),
    won({ tender_id: "t5", quoteNo: "26_501", jobNo: " 26_168 ", imported: false }),
  ], projects);
  assert.deepEqual(rows.map((r) => [r.tender_id, r.project?.id ?? null, r.matchedOn]), [
    ["t1", "p1", "jobNo"], ["t2", "p2", "quoteNo"], ["t3", null, null], ["t5", "p1", "jobNo"],
  ]);
});

test("tile: live figures; 'Estimating not reachable' shows no number; empty register says so", () => {
  const live = pipelineTile({ ok: true, pipeline: pipe(), won: [] });
  assert.equal(live.headline, "$850k");
  assert.equal(live.statusWord, "Live");
  assert.equal(live.href, "/directors/pipeline");
  assert.match(live.lines.join(" "), /10 tenders submitted.*5 being priced/);
  assert.match(live.lines.join(" "), /Won in the last 12 months: 4 tenders \(\$400k\) · win rate 40%/);
  const down = pipelineTile({ ok: false, reason: "UNREACHABLE" });
  assert.equal(down.statusWord, "Estimating not reachable");
  assert.equal(down.headline, null);
  assert.equal(down.asAt, null);
  assert.deepEqual(down.lines, []);
  assert.equal(pipelineTile({ ok: true, pipeline: pipe({ counts: {} }), won: null }).statusWord, "No tenders yet");
  const overdue = pipe({ due_soon: [{ quoteNo: "26_9", name: "", due_date: "2026-10-20", overdue: true, estimator: "", status: "received", builders: 0 }] });
  assert.equal(pipelineTile({ ok: true, pipeline: overdue, won: null }).statusWord, "1 tender past due");
  const unmatched = matchWon([won({ jobNo: "26_777", quoteNo: "26_777" })], []);
  assert.equal(pipelineTile({ ok: true, pipeline: pipe(), won: unmatched }).statusWord, "1 won, no project");
});

const input = (x: Partial<WonTenderInput>): WonTenderInput => ({
  tender_id: "t1", quoteNo: "26_168", jobNo: "26_168", name: "Westfield", builder_awarded: "Built", won_date: "2026-10-10", awarded_value_ex_gst: 64_000, project: null, ...x,
});

test("won-tender finding: after 7 days with no project, directors only; none once matched or still in grace", () => {
  const s = wonNoProjectSignals([input({}), input({ tender_id: "t2", won_date: "2026-10-22" }), input({ tender_id: "t3", project: { id: "p", name: "P" } })], "2026-10-25");
  assert.equal(s.length, 1);
  assert.equal(s[0].audience, "DIRECTOR");
  assert.equal(s[0].severity, "MEDIUM");
  assert.equal(s[0].dedupeKey, "TENDER_WON_NO_PROJECT:TENDER:t1");
  assert.match(s[0].title, /Won tender 26_168 Westfield has no Operations project \(won 15 days ago\)/);
  const noJob = wonNoProjectSignals([input({ jobNo: null })], "2026-10-25")[0];
  assert.equal(noJob.provisional, true);
  assert.equal(noJob.values.missing, "job number in Estimating");
});

test("Estimating down: the won-tender check is 'not checked', and its open findings are left alone", () => {
  assert.deepEqual(notChecked({ wonTenders: null }), ["TENDER_WON_NO_PROJECT"]);
  assert.deepEqual(notChecked({ wonTenders: [] }), []);
  const f: FindingState = {
    id: "f1", dedupeKey: "TENDER_WON_NO_PROJECT:TENDER:t1", ruleCode: "TENDER_WON_NO_PROJECT", severity: "MEDIUM", status: "OPEN",
    currentValue: null, signalClearedAt: null, clearRuns: 0, resolvedWhileFiring: false, resolvedAt: null, verifiedAt: null,
    dismissKind: null, suppressUntil: null, seenCount: 3,
  } as FindingState;
  const latest = new Map([[f.dedupeKey, f]]);
  const ctx = { now: new Date("2026-10-25T01:00:00Z"), today: "2026-10-25", sydneyDay: (d: Date) => d.toISOString().slice(0, 10) };
  assert.equal(planRun([], latest, ctx, ["TENDER_WON_NO_PROJECT"]).length, 0); // untouched
  const cleared = planRun([], latest, ctx, []); // checked and gone -> signal cleared as usual
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].events[0].action, "SIGNAL_CLEARED");
  // buildSignals leaves the kind out entirely when not checked
  const base = { today: "2026-10-25", rules: { watchAt: 0.8, actAt: 1, recentDays: 14, noContractMinSpend: 0, hireUninvoicedDays: 30 }, projects: [], idleHire: [], overdueHire: [], dates: [], starts: [], supervisorGaps: [], crewShortDays: [], crewAvailable: 0, daysNotClosed: [], plant: { fleetPct: null, confidence: "MEDIUM" as const, allocatedDays: 0, machines: 0, workingDays: 0, from: "", to: "" } };
  assert.equal(buildSignals({ ...base, wonTenders: null }).filter((x) => x.kind === "TENDER_WON_NO_PROJECT").length, 0);
  assert.equal(buildSignals({ ...base, wonTenders: [input({})] }).filter((x) => x.kind === "TENDER_WON_NO_PROJECT").length, 1);
});
