"use client";

// The production benchmarks list (LCI 5b), shared by Operations -> Production and Directors -> Production so
// both read the same figures the same way. Hours only. The caller decides where a job links to (Tracking, or
// the Directors job page / plain text via directorHref) and whether there's an action (the offer button is
// Operations-only - offering stays with the owner and director-access Admins).
import type { ReactNode } from "react";
import type { CodeBenchmark } from "@/lib/production/benchmarks";
import type { OfferDTO } from "@/lib/production/store";

export type ProductionData = { benchmarks: CodeBenchmark[]; offers: OfferDTO[]; estimatingDown: boolean; bar: { minPct: number; minLogs: number; maxHandShare: number } };

const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "?");
export const hrs = (v: number | null, dp = 3) => (v == null ? "-" : Number(v.toFixed(dp)).toString());
const CONF: Record<string, string> = { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence" };
const STATUS: Record<string, { text: string; tone: string }> = {
  PENDING: { text: "Offered - waiting for the estimator", tone: "text-sky-300" },
  ACCEPTED: { text: "Accepted into Estimating's production library", tone: "text-emerald-300" },
  REJECTED: { text: "Rejected by the estimator", tone: "text-red-300" },
};

export function ProductionIntro({ data }: { data: ProductionData }) {
  return (
    <>
      <p className="mb-3 text-xs text-gray-500">
        A code counts once a job has it at least {data.bar.minPct}% complete (or the job is finished), with at least {data.bar.minLogs} logs, one unit that matches the budget, and no more than {Math.round(data.bar.maxHandShare * 100)}% of logs with the crew entered by hand. Hours lost to delays are shown, never taken off.
      </p>
      {data.estimatingDown && <div className="mb-3 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200">Estimating didn&apos;t answer, so some budgets couldn&apos;t be read - those jobs show as having no approved budget for now.</div>}
    </>
  );
}

export default function ProductionList({ data, jobLink, action }: {
  data: ProductionData;
  jobLink: (projectId: string, name: string) => ReactNode;
  action?: (b: CodeBenchmark, latestOffer: OfferDTO | undefined) => ReactNode;
}) {
  const ready = data.benchmarks.filter((b) => b.confidence);
  const latestOffer = (b: CodeBenchmark) => data.offers.find((o) => o.code === b.code && o.unit === b.unit);
  return (
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
            return (
              <div key={`${b.code}|${b.unit}`} className="rounded-xl border border-edge bg-panel p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-100">{b.code} <span className="font-normal text-gray-400">· {b.name} · per {b.unit}</span></div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${b.confidence ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-700 text-gray-300"}`}>{b.confidence ? CONF[b.confidence] : "Early - not enough evidence"}</span>
                </div>
                {b.confidence ? (
                  <div className="mt-1 text-sm text-gray-200">
                    <b>{hrs(b.hrsPerUnit)} h/{b.unit}</b>{b.method === "DOCKETS" && b.perHour != null && <span className="text-gray-400"> ({b.perHour} {b.unit}/h)</span>}
                    {b.budgetHrsPerUnit != null ? <span className="text-gray-400"> against the budget&apos;s {hrs(b.budgetHrsPerUnit)} h/{b.unit}</span> : <span className="text-gray-500"> · no budget figure to compare</span>}
                    <div className="text-xs text-gray-500">{b.jobs.length} job{b.jobs.length === 1 ? "" : "s"} ({b.jobs.join(", ")}) · {b.logs} logs · {day(b.from)} – {day(b.to)} · {b.delayHours} h lost to delays</div>
                  </div>
                ) : <div className="mt-1 text-xs text-gray-500">No job has cleared the bar for this code yet.</div>}
                <ul className="mt-2 space-y-1 border-t border-edge/60 pt-2 text-xs">
                  {b.jobFigures.map((f) => (
                    <li key={f.projectId} className="flex flex-wrap gap-x-2">
                      {jobLink(f.projectId, f.projectName)}
                      <span className="text-gray-500">{f.logs.length} logs · {f.hours} h{f.quantity != null && ` · ${f.quantity} ${f.unit}`}{f.pctComplete != null && ` · ${f.pctComplete}% complete`}{f.hrsPerUnit != null && ` · ${hrs(f.hrsPerUnit)} h/${f.unit}`}{f.delayHours > 0 && ` · ${f.delayHours} h delays`}</span>
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
                {action?.(b, o)}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
