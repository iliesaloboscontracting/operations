"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import Summary, { type PurchaseDTO } from "@/components/purchases/Summary";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { btn, btnPrimary, input } from "@/components/compliance/shared";

// Accounts -> Purchases (stage 6, docs/accounts/STAGE6-DESIGN.md §3). Since 28 Oct 2026 (Ilies: "accounts removed as
// it has no authority to approve") requests go straight to Ilies or a director; this screen is what they've approved,
// for Victoria to order (noting the price if she likes), and the history.
type Data = { toOrder: PurchaseDTO[]; history: PurchaseDTO[] };

function Order({ r, onChanged }: { r: PurchaseDTO; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function ordered() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/accounts/purchases/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ORDERED", amountExGst: amount, note, version: r.version }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save."));
    onChanged();
  }
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-3">
      <label className="text-xs text-gray-400">Amount ex GST (optional)<input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
      <label className="text-xs text-gray-400 sm:col-span-2">Note (optional)<input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ordered from Sydney Tools, PO 1234" /></label>
      <div className="flex items-center gap-2 sm:col-span-3"><button disabled={busy} className={btnPrimary} onClick={ordered}>Mark ordered</button>{error && <span className="text-xs text-red-400">{error}</span>}</div>
    </div>
  );
}

export default function AccountsPurchasesPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(() => apiFetch("/api/accounts/purchases").then((r) => (r.ok ? r.json() : null)).then((x) => x && setD(x)), []);
  useEffect(() => { load(); }, [load]);
  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Purchases"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  return (
    <PageShell title="Purchases" subtitle="Ilies or a director approves each request; you order what's approved."
      actions={<Link href="/purchases" className={`${btn} font-medium`}>Ask for something</Link>}>
      {!d ? <p className="text-sm text-gray-500">Loading…</p> : <>
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-gray-200">Approved - to order <span className="text-gray-500">{d.toOrder.length}</span></h2>
          <div className="space-y-2">
            {d.toOrder.map((r) => <Summary key={r.id} r={r}><Order r={r} onChanged={load} /></Summary>)}
            {!d.toOrder.length && <p className="text-sm text-gray-500">Nothing approved to order.</p>}
          </div>
        </section>
        {d.history.length > 0 && (
          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-gray-200">Done (last 90 days) <span className="text-gray-500">{d.history.length}</span></h2>
            <div className="space-y-2">{d.history.map((r) => <Summary key={r.id} r={r} />)}</div>
          </section>
        )}
      </>}
    </PageShell>
  );
}
