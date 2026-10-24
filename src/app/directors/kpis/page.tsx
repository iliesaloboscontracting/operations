"use client";

// Directors - how the numbers are worked out (KPI dictionary, 24 Oct 2026).
// Rendered from lib/insights/dictionary.ts, the same definitions the
// overview and its alerts use, so the explanation can't drift from the maths.
import { useEffect } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { KPIS, THRESHOLDS, type KpiStatus } from "@/lib/insights/dictionary";

const STATUS: Record<KpiStatus, { label: string; cls: string }> = {
  READY: { label: "Live", cls: "bg-emerald-500/15 text-emerald-400" },
  CONFIRM: { label: "Live - needs confirming", cls: "bg-amber-500/15 text-amber-300" },
  BLOCKED: { label: "Not available yet", cls: "bg-panel2 text-gray-400" },
};

export default function DirectorsKpisPage() {
  const { isDirector, loading } = useAuth();
  // The "?" links land on #<KPI id>; the list only renders once sign-in is
  // known, after the browser has already looked for the anchor - so jump to it.
  useEffect(() => {
    if (!loading && isDirector && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [loading, isDirector]);
  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="How the numbers work">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  return (
    <PageShell
      title="How the numbers work"
      subtitle="What each figure on the Directors page means, how it's worked out and where it comes from."
      actions={<Link href="/directors" className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2">Back to Directors</Link>}
    >
      <div className="mb-4 rounded-2xl border border-edge bg-panel p-4 text-sm text-gray-300">
        <p>Every cost comes from Project Tracking, worked out the same way as on that page. <b className="text-gray-100">Locked</b> = a day closed in Day Review; <b className="text-gray-100">estimate</b> = an open day or hired plant not yet invoiced; <b className="text-gray-100">invoiced</b> = a supplier invoice; <b className="text-gray-100">booked</b> = on the board ahead.</p>
        <p className="mt-2">Nothing here is margin or profit: Operations knows what jobs cost, not what they earn, until the accounting system is connected.</p>
        <p className="mt-2 text-[12px] text-gray-500">Draft thresholds (not yet confirmed): days not closed - Medium above {THRESHOLDS.daysNotClosedWarn}, High above {THRESHOLDS.daysNotClosedCritical}; idle plant below {Math.round(THRESHOLDS.idlePlantBelow * 100)}% use over {THRESHOLDS.plantWindowDays} days.</p>
      </div>
      <div className="space-y-3">
        {KPIS.map((k) => (
          <div key={k.id} id={k.id} className="scroll-mt-4 rounded-2xl border border-edge bg-panel p-4 target:ring-1 target:ring-brand-500">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-100">{k.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[k.status].cls}`}>{STATUS[k.status].label}</span>
              {k.draft && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">Draft threshold</span>}
              <span className="ml-auto text-[10px] text-gray-600">{k.id}</span>
            </div>
            <div className="mt-1 text-sm text-gray-400">{k.meaning}</div>
            {k.status !== "BLOCKED" ? (
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-[8rem_minmax(0,1fr)]">
                <dt className="text-gray-500">Worked out as</dt><dd className="text-gray-300">{k.formula}</dd>
                <dt className="text-gray-500">Units</dt><dd className="text-gray-300">{k.units}</dd>
                <dt className="text-gray-500">Comes from</dt><dd className="text-gray-300">{k.source}</dd>
                <dt className="text-gray-500">Updates</dt><dd className="text-gray-300">{k.refresh}</dd>
                {k.thresholds && (<><dt className="text-gray-500">Thresholds</dt><dd className="text-gray-300">{k.thresholds}</dd></>)}
                {k.notes && (<><dt className="text-gray-500">Watch out for</dt><dd className="text-gray-300">{k.notes}</dd></>)}
              </dl>
            ) : (
              <div className="mt-2 text-[12px] text-gray-500">Needs: {k.source}</div>
            )}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
