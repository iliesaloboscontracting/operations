"use client";

// Directors -> My queries (Phase 2, 25 Oct 2026): the questions Ilies has
// asked this director to fill an information gap (a contract value, a date,
// an invoice). Answer here; Ilies closes them.
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import MyQueries, { useMyQueries } from "@/components/queries/MyQueries";

export default function DirectorQueriesPage() {
  const { isDirector, loading } = useAuth();
  const { rows, load, waiting } = useMyQueries();
  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="My queries">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  return (
    <PageShell title="My queries" subtitle={waiting ? `${waiting} question${waiting === 1 ? "" : "s"} waiting on you` : "Questions from Ilies to fill gaps in the numbers"}>
      <div className="max-w-2xl"><MyQueries rows={rows} onChange={load} /></div>
    </PageShell>
  );
}
