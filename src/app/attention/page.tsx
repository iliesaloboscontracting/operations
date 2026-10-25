"use client";

// Operations -> Attention (Task J, 25 Oct 2026; Ilies: operational matters
// don't belong in the directors' box). The open operational findings - crew
// short, no supervisor, starts not ready, days not closed, hire, project
// dates, uncosted lines, plant not booked - worst first, with the same
// Details panel: acknowledge, give it an owner, resolve, dismiss, comment,
// ask someone. Ilies, Admins and Managers act on these.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import FindingsList, { type FindingsMeta } from "@/components/findings/FindingsList";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { FindingDTO } from "@/lib/findings/view";

export default function AttentionPage() {
  const { canEdit, loading } = useAuth();
  const [d, setD] = useState<{ findings: FindingDTO[]; meta: FindingsMeta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/attention").then(async (r) => (r.ok ? setD(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load what needs attention."))));
  }, []);
  useEffect(() => { if (!loading && canEdit) load(); }, [loading, canEdit, load]);

  if (loading) return null;
  if (!canEdit) return <PageShell title="Attention"><p className="text-sm text-gray-400">This page is for managers.</p></PageShell>;
  return (
    <PageShell title="Attention" subtitle="Operational matters the system has spotted - crew, supervisors, starts, hire, dates and gaps in the data. They close themselves once fixed, or you close them here.">
      <div className="max-w-4xl">
        {error ? <p className="text-sm text-red-400">{error}</p> : !d ? <p className="text-sm text-gray-500">Loading...</p> : (
          <FindingsList title="Needs attention" findings={d.findings} meta={d.meta} emptyText="All clear - nothing operational needs attention right now." onRefresh={load} help={false} />
        )}
      </div>
    </PageShell>
  );
}
