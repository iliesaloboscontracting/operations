"use client";

// Directors -> Pipeline (G5, 25 Oct 2026): tenders from Lobos Estimating's
// register - open work, due soon, won and lost, win rate, by estimator and
// work type, data gaps - and won tenders that aren't an Operations project
// yet. Figures are Estimating's own (pipeline.v1, won-tenders.v1). Pipeline
// value is never revenue or work in hand: it isn't won.
import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/tracking/parts";
import { ConfidenceBadge, DLink, Help } from "@/components/directors/parts";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { countWonPeriod, type PipelineV1, type WonMatch, type openWork } from "@/lib/insights/pipeline";
import type { Confidence } from "@/lib/insights/kpis";

type Data =
  | { reachable: false; reason: "UNREACHABLE" | "BAD_FORMAT" }
  | { reachable: true; pipeline: PipelineV1; open: ReturnType<typeof openWork>; confidence: { level: Confidence; why: string }; won: WonMatch[] | null };

const aud = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }));
const day = (iso: string | null) => (iso ? fmtDay(iso, { day: "numeric", month: "short", year: "numeric" }) : "—");
const STATUS_LABEL: Record<string, string> = { received: "Received", estimating: "Estimating", submitted: "Submitted", won: "Won", lost: "Lost", withdrawn: "Withdrawn", declined: "Declined" };

export default function PipelinePage() {
  const { isDirector, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !isDirector) return;
    apiFetch("/api/directors/pipeline")
      .then(async (r) => (r.ok ? setD(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load the pipeline."))))
      .catch(() => setError("Couldn't load the pipeline."));
  }, [loading, isDirector]);

  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="Pipeline">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  const subtitle = d?.reachable ? `From Estimating · as at ${new Date(d.pipeline.generated_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ex GST · last 12 months` : undefined;

  return (
    <PageShell title="Pipeline" subtitle={subtitle}>
      {error ? (
        <p className="py-10 text-center text-sm text-red-400">{error}</p>
      ) : !d ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading...</p>
      ) : !d.reachable ? (
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-400">
          {d.reason === "UNREACHABLE" ? "Estimating not reachable right now - no pipeline figures to show. Try again shortly." : "Estimating sent a summary this screen doesn't understand, so nothing is shown."}
        </div>
      ) : (
        <Body d={d} />
      )}
    </PageShell>
  );
}

function Body({ d }: { d: Extract<Data, { reachable: true }> }) {
  const p = d.pipeline;
  const o = d.open;
  const rateC = p.win_rates.win_rate_by_count, rateV = p.win_rates.win_rate_by_value;
  const noProject = d.won?.filter((w) => !w.project) ?? [];
  return (
    <div className="max-w-6xl space-y-4">
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">Open work and results <Help id="C1" /></h2>
          <ConfidenceBadge level={d.confidence.level} why={d.confidence.why} />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Fig label="Submitted, waiting on outcome" value={aud(p.values_ex_gst.submitted_open)} sub={`${o.submittedOpen} tender${o.submittedOpen === 1 ? "" : "s"} · value counted once per tender`} />
          <Fig label="Being priced" value={String(o.beingPriced)} sub={`${p.counts.received ?? 0} received · ${p.counts.estimating ?? 0} estimating`} />
          <Fig label="Won" value={aud(p.values_ex_gst.won_period)} sub={`${countWonPeriod(p)} tender${countWonPeriod(p) === 1 ? "" : "s"} · lost ${aud(p.values_ex_gst.lost_period)}`} />
          <Fig label="Win rate" value={rateC == null ? "—" : `${Math.round(rateC * 100)}%`} sub={rateV == null ? "by count · no decisions yet" : `by count · ${Math.round(rateV * 100)}% by value`} />
        </div>
        <p className="mt-3 text-[11px] text-gray-500">{d.confidence.why}. Win rate = {p.win_rates.definition}. Pipeline value is not revenue: it isn&apos;t won.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-100">Due in the next 14 days</h2>
          {!p.due_soon.length ? <p className="text-sm text-gray-500">Nothing due.</p> : (
            <ul className="divide-y divide-edge text-sm">
              {p.due_soon.map((t) => (
                <li key={t.quoteNo} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <span className="min-w-0 text-gray-200">{t.quoteNo} · {t.name || "Untitled"} <span className="text-gray-500">· {t.estimator || "no estimator"} · {STATUS_LABEL[t.status] ?? t.status}</span></span>
                  <span className={`whitespace-nowrap text-[12px] ${t.overdue ? "font-semibold text-red-400" : "text-gray-400"}`}>{t.overdue ? "Overdue · " : ""}{day(t.due_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-100">Won, not in Operations yet <Help id="C2" /></h2>
          {d.won === null ? <p className="text-sm text-gray-500">Estimating&apos;s won-tender list didn&apos;t load.</p> : !noProject.length ? (
            <p className="text-sm text-gray-500">Every won tender has an Operations project.</p>
          ) : (
            <ul className="divide-y divide-edge text-sm">
              {noProject.map((w) => (
                <li key={w.tender_id} className="py-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-gray-200">{w.quoteNo}{w.jobNo && w.jobNo !== w.quoteNo ? ` / job ${w.jobNo}` : ""} · {w.name || "Untitled"}</span>
                    <span className="whitespace-nowrap font-medium text-gray-200">{aud(w.awarded_value_ex_gst)}</span>
                  </div>
                  <div className="text-[12px] text-gray-500">{w.builder_awarded || w.client || "—"} · won {day(w.won_date)}{w.jobNo ? "" : " · no job number in Estimating yet"}</div>
                </li>
              ))}
            </ul>
          )}
          {d.won && d.won.some((w) => w.project) && (
            <p className="mt-2 text-[11px] text-gray-500">
              Already in Operations: {d.won.filter((w) => w.project).map((w, i) => (
                <span key={w.tender_id}>{i ? ", " : ""}<DLink href={`/tracking/${w.project!.id}`} className="hover:text-gray-300">{w.quoteNo} {w.project!.name}</DLink></span>
              ))}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="By estimator" rows={p.by_estimator.map((r) => [r.estimator, r.open, r.submitted_period, r.won_period])} />
        <Table title="By work type" rows={p.by_work_type.map((r) => [r.work_type, r.open, r.submitted_period, r.won_period])} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-100">All tenders by status</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {Object.entries(p.counts).map(([k, n]) => <span key={k} className="rounded-full bg-panel2 px-2.5 py-1 text-gray-300">{STATUS_LABEL[k] ?? k} {n}</span>)}
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-gray-100">Gaps in the register</h2>
          <ul className="space-y-1 text-sm text-gray-300">
            <Gap n={p.data_quality.outcomes_overdue} label="submitted over 90 days ago with no outcome" />
            <Gap n={o.outcomeUnknown} label="imported tenders with no outcome (not counted as open)" />
            <Gap n={o.needsReview} label="imported tenders still to be checked" />
            <Gap n={p.data_quality.open_without_due_date} label="open tenders with no due date" />
            <Gap n={p.data_quality.duplicate_numbers_unresolved} label="duplicate quote numbers to sort out" />
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight text-gray-100">{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

function Gap({ n, label }: { n: number; label: string }) {
  return <li className={n ? "" : "text-gray-500"}><span className={`font-semibold ${n ? "text-amber-300" : ""}`}>{n}</span> {label}</li>;
}

function Table({ title, rows }: { title: string; rows: (string | number)[][] }) {
  return (
    <Card className="overflow-x-auto">
      <h2 className="mb-2 text-sm font-semibold text-gray-100">{title}</h2>
      {!rows.length ? <p className="text-sm text-gray-500">No tenders yet.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th className="py-1 font-semibold" />
              <th className="py-1 text-right font-semibold">Open now</th>
              <th className="py-1 text-right font-semibold">Submitted</th>
              <th className="py-1 text-right font-semibold">Won</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {rows.map((r) => (
              <tr key={String(r[0])}>
                <td className="py-1.5 text-gray-300">{r[0] || "Unassigned"}</td>
                <td className="py-1.5 text-right text-gray-200">{r[1]}</td>
                <td className="py-1.5 text-right text-gray-200">{r[2]}</td>
                <td className="py-1.5 text-right text-gray-200">{r[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-1 text-[11px] text-gray-500">Submitted and won: last 12 months. Open now: received, estimating or submitted.</p>
    </Card>
  );
}
