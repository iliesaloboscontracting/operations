"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import Summary, { type PurchaseDTO } from "@/components/purchases/Summary";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { btn, btnPrimary, input } from "@/components/compliance/shared";

// Accounts -> Purchases (stage 6, docs/accounts/STAGE6-DESIGN.md §3). Victoria checks each request and adds the
// amount, asks the requester a question if needed, then a director approves it and she orders it.
type Data = { toCheck: PurchaseDTO[]; waitingInfo: PurchaseDTO[]; withDirectors: PurchaseDTO[]; toOrder: PurchaseDTO[]; history: PurchaseDTO[] };

function Actions({ r, onChanged }: { r: PurchaseDTO; onChanged: () => void }) {
  const [open, setOpen] = useState<"CHECK" | "ASK_INFO" | "CLOSE" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/accounts/purchases/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: r.version, ...extra }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save."));
    setOpen(null); setAmount(""); setNote("");
    onChanged();
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {r.status === "REQUESTED" && <>
          <button className={btn} onClick={() => setOpen("CHECK")}>Check and price it</button>
          <button className={btn} onClick={() => setOpen("ASK_INFO")}>Ask them a question</button>
        </>}
        {(r.status === "REQUESTED" || r.status === "NEEDS_INFO") && <button className={btn} onClick={() => setOpen("CLOSE")}>Close (not needed / duplicate)</button>}
        {r.status === "APPROVED" && <button disabled={busy} className={btn} onClick={() => act("ORDERED")}>Mark ordered</button>}
      </div>
      {open === "CHECK" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-gray-400">Amount ex GST<input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label className="text-xs text-gray-400 sm:col-span-2">Note for the directors (optional)<input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cheapest of 3 quotes" /></label>
          <div className="flex gap-2 sm:col-span-3"><button disabled={busy} className={btnPrimary} onClick={() => act("CHECK", { amountExGst: amount, accountsNote: note })}>Send to a director</button><button className={btn} onClick={() => setOpen(null)}>Cancel</button></div>
        </div>
      )}
      {(open === "ASK_INFO" || open === "CLOSE") && (
        <div className="flex flex-wrap gap-2">
          <input className={`${input} max-w-md`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={open === "ASK_INFO" ? "Your question (they see it - no prices)" : "Why it's closed"} />
          <button disabled={busy} className={btnPrimary} onClick={() => act(open, open === "ASK_INFO" ? { question: note } : { reason: note })}>{open === "ASK_INFO" ? "Send question" : "Close it"}</button>
          <button className={btn} onClick={() => setOpen(null)}>Cancel</button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function Group({ title, rows, empty, onChanged }: { title: string; rows: PurchaseDTO[]; empty?: string; onChanged: () => void }) {
  if (!rows.length && !empty) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold text-gray-200">{title} <span className="text-gray-500">{rows.length}</span></h2>
      <div className="space-y-2">
        {rows.map((r) => <Summary key={r.id} r={r}><Actions r={r} onChanged={onChanged} /></Summary>)}
        {!rows.length && <p className="text-sm text-gray-500">{empty}</p>}
      </div>
    </section>
  );
}

export default function AccountsPurchasesPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(() => apiFetch("/api/accounts/purchases").then((r) => (r.ok ? r.json() : null)).then((x) => x && setD(x)), []);
  useEffect(() => { load(); }, [load]);
  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Purchases"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  return (
    <PageShell title="Purchases" subtitle="Check and price each request; Ilies or a director approves it; you order it."
      actions={<Link href="/purchases" className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-panel2">Ask for something</Link>}>
      {!d ? <p className="text-sm text-gray-500">Loading…</p> : <>
        <Group title="To check" rows={d.toCheck} empty="Nothing to check." onChanged={load} />
        <Group title="Approved - to order" rows={d.toOrder} onChanged={load} />
        <Group title="Waiting on their answer" rows={d.waitingInfo} onChanged={load} />
        <Group title="With a director" rows={d.withDirectors} onChanged={load} />
        <Group title="Done (last 90 days)" rows={d.history} onChanged={load} />
      </>}
    </PageShell>
  );
}
