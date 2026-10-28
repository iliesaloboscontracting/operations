"use client";

// Directors -> Purchases to approve (Accounts stage 6, 27 Oct 2026). Accounts have checked and priced each request;
// a DIRECTOR login other than the person who asked approves or declines it, then accounts order it. Money is
// shown - directors only.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import Summary, { type PurchaseDTO } from "@/components/purchases/Summary";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { btn, btnPrimary, input } from "@/components/compliance/shared";

function Decide({ r, onChanged }: { r: PurchaseDTO; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (r.cannotDecide) return <p className="mt-2 text-sm text-gray-400">{r.cannotDecide}</p>;
  async function act(action: "APPROVE" | "DECLINE" | "ASK_INFO") {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/directors/purchases/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note, question: note, version: r.version }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save."));
    onChanged();
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={`${input} max-w-md`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note or question (needed to decline or ask; the requester sees it - no prices)" />
      <button disabled={busy} className={btnPrimary} onClick={() => act("APPROVE")}>Approve</button>
      <button disabled={busy} className={btn} onClick={() => act("DECLINE")}>Decline</button>
      <button disabled={busy || note.trim().length < 3} className={btn} onClick={() => act("ASK_INFO")}>Ask a question</button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

export default function DirectorPurchasesPage() {
  const { isDirector, loading } = useAuth();
  const [d, setD] = useState<{ requests: PurchaseDTO[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiFetch("/api/directors/purchases").then(async (r) => (r.ok ? setD(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load.")))), []);
  useEffect(() => { if (!loading && isDirector) load(); }, [loading, isDirector, load]);

  if (loading) return null;
  if (!isDirector) return <PageShell title="Purchases to approve"><div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div></PageShell>;
  // 28 Oct 2026: requests come straight here (no accounts check first); older CHECKED ones are decided the same way.
  const waiting = d?.requests.filter((r) => r.status === "REQUESTED" || r.status === "CHECKED") ?? [];
  const answering = d?.requests.filter((r) => r.status === "NEEDS_INFO") ?? [];
  const decided = d?.requests.filter((r) => !["REQUESTED", "CHECKED", "NEEDS_INFO"].includes(r.status)) ?? [];
  return (
    <PageShell title="Purchases to approve" subtitle={d ? `${waiting.length ? `${waiting.length} waiting` : "Nothing waiting"} · accounts order it once approved · ${d.note}` : undefined}>
      {error ? <p className="py-10 text-center text-sm text-red-400">{error}</p> : !d ? <p className="py-10 text-center text-sm text-gray-500">Loading...</p> : (
        <div className="max-w-4xl space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-200">Waiting for a decision</h2>
            <div className="space-y-2">{waiting.map((r) => <Summary key={r.id} r={r}><Decide r={r} onChanged={load} /></Summary>)}{!waiting.length && <p className="text-sm text-gray-500">Nothing waiting.</p>}</div>
          </section>
          {answering.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-200">Waiting on their answer</h2>
              <div className="space-y-2">{answering.map((r) => <Summary key={r.id} r={r} />)}</div>
            </section>
          )}
          {decided.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-200">Decided (last 30 days)</h2>
              <div className="space-y-2">{decided.map((r) => <Summary key={r.id} r={r} />)}</div>
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}
