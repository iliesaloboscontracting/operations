"use client";

// Directors -> Production (LCI 5b follow-on, 27 Oct 2026): the read-only view of how fast work really goes,
// per activity code, against the approved budget - the same list as Operations -> Production. Hours only;
// no offer button. A job links to its Directors job page (directorHref) - never into Operations for a
// directors-only login.
import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { DLink } from "@/components/directors/parts";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import ProductionList, { ProductionIntro, type ProductionData } from "@/components/production/ProductionList";

export default function DirectorsProductionPage() {
  const { isDirector, loading } = useAuth();
  const [data, setData] = useState<ProductionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !isDirector) return;
    apiFetch("/api/directors/production")
      .then(async (r) => (r.ok ? setData(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load production."))))
      .catch(() => setError("Couldn't load production."));
  }, [loading, isDirector]);

  if (loading) return null;
  if (!isDirector) return <PageShell title="Production"><p className="text-sm text-gray-500">This screen is for the directors.</p></PageShell>;
  return (
    <PageShell title="Production" subtitle="How fast work really goes, per activity code, from the supervisors' daily logs - against the approved budget. Hours only; read-only.">
      {data && <ProductionIntro data={data} />}
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!data ? (error ? null : <p className="py-8 text-center text-sm text-gray-500">Loading...</p>) : (
        <ProductionList data={data} jobLink={(id, name) => <DLink href={`/tracking/${id}`} className="text-gray-300 hover:underline">{name}</DLink>} />
      )}
    </PageShell>
  );
}
