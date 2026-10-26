"use client";

// Production (LCI phase 5b, docs/lci/PHASE4-5-DESIGN.md §3): how fast work really goes, per activity code,
// worked out from the supervisors' daily logs - labour hours per unit (hours ÷ the budget's quantity × %
// complete), or for waste load-out the docket quantity per hour - against the approved budget. Hours only,
// never money. A code counts only once it clears the evidence bar; until then it shows as "early" and
// can't be offered. The owner or director access can offer a code to Estimating (one deliberate tap);
// the estimator accepts or rejects it there, and the decision shows here. Managers and Admins read.
// The list itself is shared with Directors -> Production (components/production/ProductionList.tsx).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import ProductionList, { hrs, ProductionIntro, type ProductionData } from "@/components/production/ProductionList";
import type { CodeBenchmark } from "@/lib/production/benchmarks";

type Data = ProductionData & { canOffer: boolean };

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
    if (!confirm(`Offer ${b.code} (${hrs(b.hrsPerUnit)} h/${b.unit}) to Estimating? The estimator decides whether it goes in the production library.`)) return;
    setBusy(`${b.code}|${b.unit}`); setFlash(null); setError(null);
    const r = await apiFetch("/api/production/offer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: b.code, unit: b.unit }) });
    setBusy(null);
    if (!r.ok) setError(await serverErrorMessage(r, "Couldn't offer it."));
    else setFlash(`${b.code} offered to Estimating.`);
    load();
  }

  if (loading) return <PageShell title="Production"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit) return <PageShell title="Production"><p className="text-sm text-gray-500">Managers and Admins only.</p></PageShell>;

  return (
    <PageShell title="Production" subtitle="How fast work really goes, per activity code, from the supervisors' daily logs - against the approved budget. Hours only.">
      {data && <ProductionIntro data={data} />}
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p> : (
        <ProductionList
          data={data}
          jobLink={(id, name) => <Link href={`/tracking/${id}`} className="text-gray-300 hover:underline">{name}</Link>}
          action={(b, o) => {
            const offeredThis = o && o.evidenceHash === b.evidenceHash && o.sentStatus === "SENT";
            return data.canOffer && b.confidence && !offeredThis ? (
              <button className="mt-2 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy === `${b.code}|${b.unit}`} onClick={() => offer(b)}>
                {o?.sentStatus === "FAILED" && o.evidenceHash === b.evidenceHash ? "Try offering again" : "Offer to Estimating"}
              </button>
            ) : null;
          }}
        />
      )}
    </PageShell>
  );
}
