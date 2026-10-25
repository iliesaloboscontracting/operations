// Tender pipeline on the Directors screen (Phase 3 piece G5, 25 Oct 2026).
// Reads Lobos Estimating's own summaries - pipeline.v1 (GET api/pipeline)
// and won-tenders.v1 (GET api/tenders/won) - over ESTIMATING_URL on the same
// server. Nothing is recomputed from tender rows here: counts, values and win
// rates are Estimating's. Two adjustments, both from the Estimating agent's
// contract notes (E9):
//   - data_quality.outcome_unknown (imported tenders never given an outcome)
//     are still in counts.submitted, so they come off the open count here.
//     values_ex_gst.submitted_open already leaves them out.
//   - won rows with `imported: true` came from the one-off register import,
//     so no Operations project is expected for them. Missing = false.
// Pipeline value is never added to revenue or work in hand: it isn't won.
// Plain functions, no server imports; `npm test` (pipeline.test.ts).
import type { Confidence } from "./kpis";
import type { HealthTile } from "./health";

export interface PipelineV1 {
  schema_version: "pipeline.v1";
  generated_at: string;
  as_at: string;
  period: { from: string; to: string };
  counts: Record<string, number>; // received | estimating | submitted | won | lost | withdrawn | declined
  values_ex_gst: { submitted_open: number; won_period: number; lost_period: number };
  win_rates: { win_rate_by_count: number | null; win_rate_by_value: number | null; definition: string };
  due_soon: { quoteNo: string; name: string; due_date: string; overdue: boolean; estimator: string; status: string; builders: number }[];
  by_estimator: { estimator: string; open: number; submitted_period: number; won_period: number }[];
  by_work_type: { work_type: string; open: number; submitted_period: number; won_period: number }[];
  stale: { submitted_over_90_days: number };
  data_quality: {
    outcomes_overdue: number; duplicate_numbers_unresolved: number; open_without_due_date: number;
    outcome_unknown?: number; needs_review?: number; // E9, may be absent
  };
}

export interface WonTenderRow {
  tender_id: string; quoteNo: string; jobNo: string | null; name: string; client: string; builder_awarded: string;
  site: string; work_type: string; won_date: string | null; estimator: string; awarded_value_ex_gst: number | null;
  imported?: boolean; // E9, may be absent (= false)
}
export interface WonTendersV1 {
  schema_version: "won-tenders.v1";
  generated_at: string;
  as_at: string;
  count: number;
  tenders: WonTenderRow[];
  data_quality: { won_without_job_no: number; won_without_estimate?: number; won_without_budget?: number };
}

export const isPipelineV1 = (b: unknown): b is PipelineV1 =>
  !!b && (b as PipelineV1).schema_version === "pipeline.v1" && typeof (b as PipelineV1).counts === "object";
export const isWonTendersV1 = (b: unknown): b is WonTendersV1 =>
  !!b && (b as WonTendersV1).schema_version === "won-tenders.v1" && Array.isArray((b as WonTendersV1).tenders);

// ---------- open work ----------

export function openWork(p: PipelineV1) {
  const unknown = p.data_quality.outcome_unknown ?? 0;
  return {
    beingPriced: (p.counts.received ?? 0) + (p.counts.estimating ?? 0),
    submittedOpen: Math.max(0, (p.counts.submitted ?? 0) - unknown),
    outcomeUnknown: unknown,
    needsReview: p.data_quality.needs_review ?? 0,
    total: Object.values(p.counts).reduce((n, c) => n + c, 0),
  };
}

// Never HIGH: the register is kept by hand. LOW while outcomes are missing
// or imported rows still need a person - the win rate can't be trusted then.
export function pipelineConfidence(p: PipelineV1): { level: Confidence; why: string } {
  const o = openWork(p);
  const gaps = [
    o.outcomeUnknown ? `${o.outcomeUnknown} imported tender${o.outcomeUnknown === 1 ? "" : "s"} with no outcome` : "",
    o.needsReview ? `${o.needsReview} imported tender${o.needsReview === 1 ? "" : "s"} still to check` : "",
    p.data_quality.outcomes_overdue ? `${p.data_quality.outcomes_overdue} submitted over 90 days with no outcome` : "",
  ].filter(Boolean);
  if (o.total === 0) return { level: "LOW", why: "The tender register is empty so far" };
  return gaps.length
    ? { level: "LOW", why: `Win rate and open work are uncertain: ${gaps.join("; ")}` }
    : { level: "MEDIUM", why: "From Estimating's tender register, kept by the estimators; outcomes are up to date" };
}

// ---------- won tender -> Operations project ----------

export type ProjectKey = { id: string; name: string; jobNo: string | null; quoteNo: string | null };
export type WonMatch = WonTenderRow & { project: { id: string; name: string } | null; matchedOn: "jobNo" | "quoteNo" | null };

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

// A won tender matches a project when the tender's job number or quote
// number equals the project's job number or quote number (they come from
// the same numbering). Imported tenders are left out.
export function matchWon(rows: WonTenderRow[], projects: ProjectKey[]): WonMatch[] {
  const byNo = new Map<string, ProjectKey>();
  for (const p of projects) for (const k of [p.jobNo, p.quoteNo]) if (norm(k) && !byNo.has(norm(k))) byNo.set(norm(k), p);
  return rows.filter((r) => r.imported !== true).map((r) => {
    const viaJob = norm(r.jobNo) ? byNo.get(norm(r.jobNo)) : undefined;
    const viaQuote = !viaJob && norm(r.quoteNo) ? byNo.get(norm(r.quoteNo)) : undefined;
    const p = viaJob ?? viaQuote;
    return { ...r, project: p ? { id: p.id, name: p.name } : null, matchedOn: viaJob ? "jobNo" : viaQuote ? "quoteNo" : null };
  });
}

// ---------- the health-band tile ----------

export type PipelineState =
  | { ok: true; pipeline: PipelineV1; won: WonMatch[] | null }
  | { ok: false; reason: "UNREACHABLE" | "BAD_FORMAT" };

const money = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `$${Math.round(a / 1000)}k`;
  return `$${Math.round(a).toLocaleString("en-AU")}`;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function pipelineTile(s: PipelineState): HealthTile {
  const base = { id: "pipeline" as const, title: "Pipeline", source: "Lobos Estimating tender register", kpi: "C1", href: "/directors/pipeline" };
  if (!s.ok) {
    return {
      ...base, status: "NOT_CONNECTED", statusWord: s.reason === "UNREACHABLE" ? "Estimating not reachable" : "Estimating sent an unknown format",
      headline: null, lines: [], asAt: null, confidence: null, confidenceWhy: "No data this time",
      missing: s.reason === "UNREACHABLE" ? "Estimating to answer on the server - try again shortly" : "A pipeline.v1 summary from Estimating",
    };
  }
  const p = s.pipeline;
  const o = openWork(p);
  const conf = pipelineConfidence(p);
  const overdue = p.due_soon.filter((d) => d.overdue).length;
  const noProject = s.won?.filter((w) => !w.project).length ?? null;
  const rate = p.win_rates.win_rate_by_count;
  if (o.total === 0) {
    return { ...base, status: "INFO", statusWord: "No tenders yet", headline: "—", lines: ["The tender register in Estimating is empty so far"], asAt: p.generated_at, confidence: conf.level, confidenceWhy: conf.why, missing: null };
  }
  return {
    ...base,
    status: overdue || noProject ? "WATCH" : "INFO",
    statusWord: overdue ? `${plural(overdue, "tender")} past due` : noProject ? `${noProject} won, no project` : "Live",
    headline: money(p.values_ex_gst.submitted_open),
    lines: [
      `${plural(o.submittedOpen, "tender")} submitted, waiting on an outcome · ${o.beingPriced} being priced`,
      `Due in 14 days: ${p.due_soon.length}${overdue ? ` (${overdue} overdue)` : ""}`,
      `Won in the last 12 months: ${plural(countWonPeriod(p), "tender")} (${money(p.values_ex_gst.won_period)})${rate != null ? ` · win rate ${Math.round(rate * 100)}% by count` : ""}`,
      ...(noProject ? [`${plural(noProject, "won tender")} not in Operations yet`] : []),
    ],
    asAt: p.generated_at,
    confidence: conf.level,
    confidenceWhy: conf.why,
    missing: o.outcomeUnknown ? `Outcomes for ${o.outcomeUnknown} imported tenders` : null,
  };
}

// Won in the period = sum of won_period over the estimators (pipeline.v1
// gives the count per estimator, not overall).
export function countWonPeriod(p: PipelineV1) {
  return p.by_estimator.reduce((n, e) => n + e.won_period, 0);
}
