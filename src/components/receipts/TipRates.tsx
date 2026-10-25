"use client";

// Tip rates on /receipts (Receipts R3): $/tonne ex GST per tip site and waste type, from the date
// they start. A docket with a weight but no printed price is costed from the rate in force on its
// date. Admins add and retire; Managers read. A price change is a new rate with a later start date -
// the old one stays as history. Also lists the site + waste combinations on dockets with no rate yet.
import { useCallback, useEffect, useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { TipRateDTO } from "@/lib/receipts/tipStore";

type Data = { rates: TipRateDTO[]; missing: { tipSite: string; wasteType: string; dockets: number }[] };
const input = "w-full rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200";
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const BLANK = { tipSite: "", wasteType: "", ratePerTonneExGst: "", validFrom: "", source: "", note: "" };

export default function TipRates({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState(BLANK);
  const [showOld, setShowOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/tip-rates").then(async (r) => (r.ok ? setData(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load the tip rates."))));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setBusy(true); setError(null);
    const r = await apiFetch("/api/tip-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't add the rate."));
    setFlash(`Rate added for ${form.tipSite}${form.wasteType ? ` (${form.wasteType})` : ""}.`); setForm(BLANK); load();
  }
  async function retire(rate: TipRateDTO) {
    const reason = prompt(`Retire the ${money(rate.ratePerTonneExGst)}/t rate for ${rate.tipSite}? Say why (e.g. typed wrong):`);
    if (!reason) return;
    const r = await apiFetch(`/api/tip-rates/${rate.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "RETIRE", reason }) });
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't retire the rate."));
    setFlash("Rate retired."); load();
  }
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  if (!data) return <p className="py-8 text-center text-sm text-gray-500">{error ?? "Loading..."}</p>;
  const shown = data.rates.filter((r) => showOld || (r.inForce && !r.retired) || (!r.retired && r.validFrom > new Date().toISOString().slice(0, 10)));

  return (
    <div className="space-y-4">
      {flash && <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {data.missing.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="mb-1 font-semibold text-amber-200">Add a tip rate - dockets that can&apos;t be priced yet</div>
          <ul className="space-y-0.5 text-xs text-amber-100">
            {data.missing.map((m) => (
              <li key={`${m.tipSite}|${m.wasteType}`} className="flex flex-wrap items-center gap-2">
                <span>{m.tipSite}{m.wasteType ? ` · ${m.wasteType}` : ""} - {m.dockets} docket{m.dockets === 1 ? "" : "s"}</span>
                {isAdmin && <button className="text-brand-300 underline" onClick={() => setForm({ ...BLANK, tipSite: m.tipSite, wasteType: m.wasteType })}>Add a rate</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isAdmin && (
        <div className="grid gap-2 rounded-xl border border-edge bg-panel p-3 sm:grid-cols-3">
          <div className="text-sm font-semibold text-gray-100 sm:col-span-3">Add a rate</div>
          <label className="text-xs text-gray-400">Tip site<input className={input} value={form.tipSite} onChange={set("tipSite")} placeholder="as on the docket, e.g. Bingo Eastern Creek" /></label>
          <label className="text-xs text-gray-400">Waste type<input className={input} value={form.wasteType} onChange={set("wasteType")} placeholder="blank = any waste at that site" /></label>
          <label className="text-xs text-gray-400">$ per tonne ex GST<input className={input} inputMode="decimal" value={form.ratePerTonneExGst} onChange={set("ratePerTonneExGst")} /></label>
          <label className="text-xs text-gray-400">Starts<input className={input} type="date" value={form.validFrom} onChange={set("validFrom")} /></label>
          <label className="text-xs text-gray-400 sm:col-span-2">Where it comes from<input className={input} value={form.source} onChange={set("source")} placeholder="e.g. Bingo quote Q-2231, 1 Oct 2026" /></label>
          <label className="text-xs text-gray-400 sm:col-span-3">Note (optional)<input className={input} value={form.note} onChange={set("note")} /></label>
          <div className="sm:col-span-3"><button className={btn} disabled={busy || !form.tipSite || !form.ratePerTonneExGst || !form.validFrom || !form.source} onClick={add}>Add rate</button></div>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-100">Rates</div>
          <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show older and retired</label>
        </div>
        {shown.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-6 text-center text-sm text-gray-500">No tip rates yet{isAdmin ? " - add the first one above." : "."}</p> : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
            {shown.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm ${r.retired || !r.inForce ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1 text-gray-200">{r.tipSite}<span className="text-gray-500"> · {r.wasteType || "any waste"}</span></span>
                <span className="tabular-nums font-medium text-gray-100">{money(r.ratePerTonneExGst)}/t</span>
                <span className="text-xs text-gray-500">from {day(r.validFrom)}{r.retired ? ` · retired by ${r.retired.by}: ${r.retired.reason}` : r.inForce ? " · in force" : r.validFrom > new Date().toISOString().slice(0, 10) ? " · starts later" : " · replaced"}</span>
                <span className="w-full text-[11px] text-gray-500">{r.source} · added by {r.createdBy}{r.note ? ` · ${r.note}` : ""}</span>
                {isAdmin && !r.retired && <button className="text-xs text-gray-400 hover:text-red-300" onClick={() => retire(r)}>Retire</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
