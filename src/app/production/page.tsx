"use client";

// Production (LCI phase 5b, docs/lci/PHASE4-5-DESIGN.md §3): how fast work really goes, per activity code,
// worked out from the supervisors' daily logs - labour hours per unit (hours ÷ the budget's quantity × %
// complete), or for waste load-out the docket quantity per hour - against the approved budget. Hours only,
// never money. A code counts only once it clears the evidence bar; until then it shows as "early" and
// can't be offered. The owner or director access can offer a code to Estimating (one deliberate tap);
// the estimator accepts or rejects it there, and the decision shows here. Managers and Admins read.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { CodeBenchmark } from "@/lib/production/benchmarks";
import type { OfferDTO } from "@/lib/production/store";

type Data = { benchmarks: CodeBenchmark[]; offers: OfferDTO[]; estimatingDown: boolean; canOffer: boolean; bar: { minPct: number; minLogs: number; maxHandShare: number } };
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "?");
const n = (v: number | null, dp = 3) => (v == null ? "-" : Number(v.toFixed(dp)).toString());
const CONF: Record<string, string> = { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence" };
const STATUS: Record<string, { text: string; tone: string }> = {
  PENDING: { text: "Offered - waiting for the estimator", tone: "text-sky-300" },
  ACCEPTED: { text: "Accepted into Estimating's production library", tone: "text-emerald-300" },
  REJECTED: { text: "Rejected by the estimator", tone: "text-red-300" },
};

export default function ProductionPage() {
  const { canEdit, loading } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/production").then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load production."))));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function offer(b: CodeBenchmark) {
    if (!confirm(`Offer ${b.code} (${n(b.hrsPerUnit)} h/${b.unit}) to Estimating? The estimator decides whether it goes in the production library.`)) return;
    setBusy(`${b.code}|${b.unit}`); setFlash(null); setError(null);
    const r = await apiFetch("/api/production/offer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: b.code, unit: b.unit }) });
    setBusy(null);
    if (!r.ok) setError(await serverErrorMessage(r, "Couldn't offer it."));
    else setFlash(`${b.code} offered to Estimating.`);
    load();
  }

  if (loading) return <PageShell title="Production"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit) return <PageShell title="Production"><p className="text-sm text-gray-500">Managers and Admins only.</p></PageShell>;
  const ready = data?.benchmarks.filter((b) => b.confidence) ?? [];
  const latestOffer = (b: CodeBenchmark) => data?.offers.find((o) => o.code === b.code && o.unit === b.unit);

  return (
    <PageShell title="Production" subtitle="How fast work really goes, per activity code, from the supervisors' daily logs - against the approved budget. Hours only.">
      {data && (
        <p className="mb-3 text-xs text-gray-500">
          A code counts once a job has it at least {data.bar.minPct}% complete (or the job is finished), with at least {data.bar.minLogs} logs, one unit that matches the budget, and no more than {Math.round(data.bar.maxHandShare * 100)}% of logs with the crew entered by hand. Hours lost to delays are shown, never taken off.
        </p>
      )}
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {data?.estimatingDown && <div className="mb-3 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200">Estimating didn&apos;t answer, so some budgets couldn&apos;t be read - those jobs show as having no approved budget for now.</div>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p> : (
        <>
          {ready.length === 0 && (
            <div className="mb-4 rounded-xl border border-dashed border-edge p-4 text-sm text-gray-400">
              <div className="font-semibold text-gray-200">Not enough evidence yet</div>
              The daily logs started on 26 Oct 2026. Figures appear here as each job builds up logs and weekly % complete - the codes below show what each one still needs.
            </div>
          )}
          {data.benchmarks.length === 0 ? <p className="text-sm text-gray-500">No daily logs yet.</p> : (
            <div className="space-y-3">
              {data.benchmarks.map((b) => {
                const o = latestOffer(b);
                const offeredThis = o && o.evidenceHash === b.evidenceHash && o.sentStatus === "SENT";
                return (
                  <div key={`${b.code}|${b.unit}`} className="rounded-xl border border-edge bg-panel p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-100">{b.code} <span className="font-normal text-gray-400">· {b.name} · per {b.unit}</span></div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${b.confidence ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-700 text-gray-300"}`}>{b.confidence ? CONF[b.confidence] : "Early - not enough evidence"}</span>
                    </div>
                    {b.confidence ? (
                      <div className="mt-1 text-sm text-gray-200">
                        <b>{n(b.hrsPerUnit)} h/{b.unit}</b>{b.method === "DOCKETS" && b.perHour != null && <span className="text-gray-400"> ({b.perHour} {b.unit}/h)</span>}
                        {b.budgetHrsPerUnit != null ? <span className="text-gray-400"> against the budget&apos;s {n(b.budgetHrsPerUnit)} h/{b.unit}</span> : <span className="text-gray-500"> · no budget figure to compare</span>}
                        <div className="text-xs text-gray-500">{b.jobs.length} job{b.jobs.length === 1 ? "" : "s"} ({b.jobs.join(", ")}) · {b.logs} logs · {day(b.from)} – {day(b.to)} · {b.delayHours} h lost to delays</div>
                      </div>
                    ) : <div className="mt-1 text-xs text-gray-500">No job has cleared the bar for this code yet.</div>}
                    <ul className="mt-2 space-y-1 border-t border-edge/60 pt-2 text-xs">
                      {b.jobFigures.map((f) => (
                        <li key={f.projectId} className="flex flex-wrap gap-x-2">
                          <Link href={`/tracking/${f.projectId}`} className="text-gray-300 hover:underline">{f.projectName}</Link>
                          <span className="text-gray-500">{f.logs.length} logs · {f.hours} h{f.quantity != null && ` · ${f.quantity} ${f.unit}`}{f.pctComplete != null && ` · ${f.pctComplete}% complete`}{f.hrsPerUnit != null && ` · ${n(f.hrsPerUnit)} h/${f.unit}`}{f.delayHours > 0 && ` · ${f.delayHours} h delays`}</span>
                          {f.passes ? <span className="text-emerald-400">counts</span> : <span className="text-amber-400">early: {f.missing.join("; ")}</span>}
                        </li>
                      ))}
                    </ul>
                    {o && (
                      <div className="mt-2 text-xs">
                        {o.sentStatus === "FAILED" ? <span className="text-red-300">Last offer didn&apos;t go: {o.lastError}</span>
                          : <span className={STATUS[o.estimatingStatus ?? "PENDING"]?.tone}>{STATUS[o.estimatingStatus ?? "PENDING"]?.text}{o.decidedBy ? ` (${o.decidedBy}${o.decisionNote ? `: ${o.decisionNote}` : ""})` : ""} · offered by {o.offeredBy}{o.evidenceHash !== b.evidenceHash && " - more evidence since"}</span>}
                      </div>
                    )}
                    {data.canOffer && b.confidence && !offeredThis && (
                      <button className="mt-2 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy === `${b.code}|${b.unit}`} onClick={() => offer(b)}>
                        {o?.sentStatus === "FAILED" && o.evidenceHash === b.evidenceHash ? "Try offering again" : "Offer to Estimating"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
