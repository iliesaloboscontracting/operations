"use client";

// Directors -> Purchases to approve (Accounts stage 6, 27 Oct 2026). The owner or a DIRECTOR login other than the
// person who asked approves or declines each request, picking the supplier's quote to go with (2 Nov 2026), then
// accounts order it. Prices are shown.
import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/resource";
import PageShell from "@/components/PageShell";
import Summary, { type PurchaseDTO } from "@/components/purchases/Summary";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { btn, btnPrimary, input } from "@/components/compliance/shared";

function Decide({ r, onChanged }: { r: PurchaseDTO; onChanged: () => void }) {
  const [note, setNote] = useState("");
  // D3 (Ilies, 2 Nov 2026): approving picks the supplier's quote to go with; a single quote is pre-selected.
  const [pick, setPick] = useState<string>(r.quotes.length === 1 ? r.quotes[0].id : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (r.cannotDecide) return <p className="mt-2 text-sm text-gray-400">{r.cannotDecide}</p>;
  async function act(action: "APPROVE" | "DECLINE" | "ASK_INFO") {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/directors/purchases/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note, question: note, version: r.version, ...(action === "APPROVE" && pick ? { chosenQuoteId: pick } : {}) }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save."));
    onChanged();
  }
  return (
    <div className="mt-2 space-y-2">
      {r.quotes.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-gray-400">Go with</legend>
          {r.quotes.map((q) => (
            <label key={q.id} className="flex items-center gap-2 text-sm text-gray-200">
              <input type="radio" name={`pick-${r.id}`} checked={pick === q.id} onChange={() => setPick(q.id)} />
              {q.supplier}{q.priceExGst != null ? ` - ${money(q.priceExGst)} ex GST` : ""}
            </label>
          ))}
        </fieldset>
      )}
    <div className="flex flex-wrap items-center gap-2">
      <input className={`${input} max-w-md`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note or question (needed to decline or ask; the requester sees it)" />
      <button disabled={busy || (r.quotes.length > 1 && !pick)} title={r.quotes.length > 1 && !pick ? "Pick the supplier first" : undefined} className={btnPrimary} onClick={() => act("APPROVE")}>Approve</button>
      <button disabled={busy} className={btn} onClick={() => act("DECLINE")}>Decline</button>
      <button disabled={busy || note.trim().length < 3} className={btn} onClick={() => act("ASK_INFO")}>Ask a question</button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
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
