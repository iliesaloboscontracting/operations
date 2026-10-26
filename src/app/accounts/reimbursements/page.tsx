"use client";

// Accounts -> Reimbursements (stage 3, docs/accounts/STAGE3-DESIGN.md): money paid back to a worker for
// something they bought. A claim comes from a receipt sent from a link, or accounts enter it; it reads
// "Reimburse to <person>" until Victoria ticks it paid. The same receipt, the same photo, or the same receipt
// number + amount + date can't be claimed twice. Never a job cost; nothing on any link.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";
import type { ClaimDTO, ReceiptToClaimDTO } from "@/lib/reimbursements/store";

type Data = { today: string; toPay: ClaimDTO[]; done: ClaimDTO[]; toPayTotal: number; receipts: ReceiptToClaimDTO[]; people: { id: string; name: string }[] };
const money = (n: number | null) => (n == null ? "-" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" }));
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const field = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200";
const blank = { resourceId: "", description: "", supplier: "", refNo: "", amountIncGst: "", spentOn: "", photo: "" };

function Claim({ c, busy, onPay, onCancel }: { c: ClaimDTO; busy: boolean; onPay?: () => void; onCancel?: () => void }) {
  return (
    <tr className="align-top">
      <td className="px-2 py-1.5"><div className="text-sm text-gray-100">Reimburse to {c.personName}</div><div className="text-gray-500">{c.source === "RECEIPT" ? `From a ${c.receiptKind === "FUEL" ? "fuel receipt" : "tip docket"}` : `Entered by ${c.createdBy}`}</div></td>
      <td className="px-2 py-1.5"><div className="text-gray-200">{c.description}</div><div className="text-gray-500">{[c.supplier, c.refNo && `No. ${c.refNo}`].filter(Boolean).join(" · ")}</div>{c.warnings.map((w) => <div key={w} className="text-amber-300">{w}</div>)}</td>
      <td className="px-2 py-1.5 tabular-nums text-gray-300">{c.spentOn}</td>
      <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-gray-100">{money(c.amountIncGst)}</td>
      <td className="px-2 py-1.5">{c.hasPhoto && <a className="text-sky-400" href={`/api/accounts/reimbursements/${c.id}/photo`} target="_blank" rel="noreferrer">Photo</a>}</td>
      <td className="px-2 py-1.5">
        {c.status === "TO_PAY" ? (
          <div className="flex flex-wrap gap-1"><button className={btn} disabled={busy} onClick={onPay}>Paid</button><button className={quiet} disabled={busy} onClick={onCancel}>Cancel</button></div>
        ) : c.status === "PAID" ? <div className="text-emerald-300">Paid {c.paidOn}{c.paidRef ? ` · ${c.paidRef}` : ""}<div className="text-gray-500">{c.paidBy}</div></div>
          : <div className="text-gray-500">Cancelled: {c.cancelReason}</div>}
      </td>
    </tr>
  );
}

export default function ReimbursementsPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dupes, setDupes] = useState<ClaimDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    apiFetch("/api/accounts/reimbursements").then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load."))));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function send(body: Record<string, unknown>, done: string, key: string) {
    setBusy(key); setError(null); setFlash(null); setDupes([]);
    const r = await apiFetch("/api/accounts/reimbursements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Couldn't save."); setDupes(j.duplicates ?? []); return false; }
    setFlash(`${done}${j.warnings?.length ? ` - check: ${j.warnings.join("; ")}` : ""}`);
    load();
    return true;
  }
  async function act(c: ClaimDTO, action: "PAY" | "CANCEL") {
    const body: Record<string, unknown> = { action };
    if (action === "PAY") {
      const paidOn = prompt(`Date paid to ${c.personName} (YYYY-MM-DD)`, data!.today);
      if (!paidOn) return;
      body.paidOn = paidOn; body.paidRef = prompt("Reference (optional) - e.g. the bank transfer or pay run") ?? "";
    } else {
      const reason = prompt("Why is this claim being cancelled?");
      if (!reason) return;
      body.reason = reason;
    }
    setBusy(c.id); setError(null);
    const r = await apiFetch(`/api/accounts/reimbursements/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save."));
    setFlash(`${c.personName}: ${action === "PAY" ? "marked paid" : "cancelled"}.`);
    load();
  }
  async function claimReceipt(r: ReceiptToClaimDTO) {
    let amountIncGst: string | undefined;
    if (r.amountIncGst == null) {
      amountIncGst = prompt(`This ${r.kind === "FUEL" ? "fuel receipt" : "docket"} hasn't been read. Amount paid by ${r.sentBy} (inc GST)?`) ?? "";
      if (!amountIncGst) return;
    }
    await send({ receiptId: r.id, amountIncGst }, `Reimburse to ${r.sentBy} - added.`, r.id);
  }
  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (await send({ ...form, photo: form.photo || undefined }, "Claim added.", "form")) { setForm(blank); setAdding(false); }
  }

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Reimbursements"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  const table = (rows: ClaimDTO[]) => (
    <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
      <table className="w-full min-w-[760px] text-xs">
        <thead><tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="px-2 py-1.5">To</th><th className="px-2 py-1.5">What</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5"></th><th className="px-2 py-1.5"></th></tr></thead>
        <tbody className="divide-y divide-edge/60">{rows.map((c) => <Claim key={c.id} c={c} busy={busy === c.id} onPay={() => act(c, "PAY")} onCancel={() => act(c, "CANCEL")} />)}</tbody>
      </table>
    </div>
  );

  return (
    <PageShell title="Reimbursements" subtitle="Money paid back to a worker for something they bought. Claim it from a receipt they sent, or enter it; tick it paid when it's paid. A receipt can only be claimed once. Never a job cost.">
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && (
        <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">
          {error}
          {dupes.map((d) => <div key={d.id} className="mt-1 text-xs text-red-200">Already claimed: {d.personName} · {d.description}{d.refNo ? ` · No. ${d.refNo}` : ""} · {d.spentOn} · {money(d.amountIncGst)} · {d.status === "PAID" ? `paid ${d.paidOn}` : "to pay"}</div>)}
        </div>
      )}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">{error ? "" : "Loading..."}</p> : (
        <>
          <section className="mb-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-100">To pay <span className="font-normal text-gray-500">· {data.toPay.length} · {money(data.toPayTotal)}</span></span>
              <button className={quiet} onClick={() => setAdding(!adding)}>{adding ? "Close" : "Enter a claim"}</button>
            </div>
            {adding && (
              <form onSubmit={addManual} className="mb-3 grid gap-2 rounded-xl border border-edge bg-panel p-3 md:grid-cols-3">
                <select className={field} required value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
                  <option value="">Reimburse to...</option>
                  {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className={field} required placeholder="What it was for" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                <input className={field} placeholder="Supplier (optional)" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
                <input className={field} placeholder="Receipt / docket number" value={form.refNo} onChange={(e) => setForm({ ...form, refNo: e.target.value })} />
                <input className={field} required inputMode="decimal" placeholder="Amount inc GST" value={form.amountIncGst} onChange={(e) => setForm({ ...form, amountIncGst: e.target.value })} />
                <input className={field} required type="date" max={data.today} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} />
                <label className="text-xs text-gray-400 md:col-span-2">Photo of the receipt (optional) <input type="file" accept="image/*" className="mt-1 block text-xs" onChange={async (e) => { const f = e.target.files?.[0]; setForm({ ...form, photo: f ? await resizePhoto(f) : "" }); }} /></label>
                <button className={btn} disabled={busy === "form"}>Add claim</button>
              </form>
            )}
            {data.toPay.length ? table(data.toPay) : <p className="text-sm text-gray-500">Nothing waiting to be paid.</p>}
          </section>

          <section className="mb-5">
            <div className="mb-1 text-sm font-semibold text-gray-100">Receipts sent in the last 60 days <span className="font-normal text-gray-500">· not claimed · claim one when the worker paid it themselves</span></div>
            {data.receipts.length === 0 ? <p className="text-sm text-gray-500">None.</p> : (
              <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
                <table className="w-full min-w-[640px] text-xs">
                  <tbody className="divide-y divide-edge/60">
                    {data.receipts.map((r) => (
                      <tr key={r.id}>
                        <td className="px-2 py-1.5 text-gray-200">{r.kind === "FUEL" ? "Fuel" : "Tip docket"}{r.where ? ` · ${r.where}` : ""}{r.refNo ? ` · No. ${r.refNo}` : ""}</td>
                        <td className="px-2 py-1.5 text-gray-400">{r.sentBy}</td>
                        <td className="px-2 py-1.5 tabular-nums text-gray-400">{r.sentOn}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-200">{r.amountIncGst == null ? <span className="text-gray-500">not read</span> : money(r.amountIncGst)}</td>
                        <td className="px-2 py-1.5 text-right"><button className={quiet} disabled={busy === r.id} onClick={() => claimReceipt(r)}>Reimburse to {r.sentBy}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.done.length > 0 && (
            <section>
              <div className="mb-1 text-sm font-semibold text-gray-100">Paid and cancelled <span className="font-normal text-gray-500">· last 90 days</span></div>
              {table(data.done)}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
