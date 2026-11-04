"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import StockTakeView from "@/components/yard/StockTakeView";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { Summary } from "@/lib/stockTake/rules";

// The yard stock take (Yard Stage B, Ilies 4 Nov 2026): start one, count, finish; the finished ones below, each
// viewable read-only. The yard computer, the coordinator and Managers / Admins count; Viewers look. Same access as
// the rest of Tools (/api/stock-takes, lib/auth.ts guardTools). No dollar figures.
type Row = { id: string; status: string; startedAt: string; startedBy: string | null; finishedAt: string | null; finishedBy: string | null; note: string | null; summary: Summary };

const btn = "rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

export default function StockTakePage() {
  const { canEdit, coordinatorOnly, yardOnly, loading } = useAuth();
  const canWork = canEdit || coordinatorOnly || yardOnly;
  const [data, setData] = useState<{ open: Row | null; history: Row[] } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/stock-takes");
    if (r.ok) setData(await r.json());
    else setError(await serverErrorMessage(r, "Couldn't load the stock takes."));
  }, []);
  useEffect(() => {
    load();
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setViewing(id);
  }, [load]);

  const show = (id: string | null) => {
    setViewing(id);
    window.history.replaceState(null, "", id ? `/yard/stocktake?id=${encodeURIComponent(id)}` : "/yard/stocktake");
  };

  async function start() {
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/stock-takes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "YARD", note }) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't start the stock take."));
    setNote("");
    await load();
  }

  if (loading) return <PageShell title="Stock take"><p className="text-sm text-gray-500">Loading…</p></PageShell>;
  const past = viewing && viewing !== data?.open?.id ? viewing : null;

  return (
    <PageShell
      title="Stock take"
      subtitle="Count the yard against the register: tick each tool (or photograph the shelves), then finish."
      actions={coordinatorOnly ? <Link href="/tools" className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Tools</Link>
        : <Link href="/yard" className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Yard jobs</Link>}
    >
      <div className="max-w-5xl space-y-6">
        {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
        {past ? (
          <>
            <button className="text-xs text-brand-300 hover:underline" onClick={() => show(null)}>← Back</button>
            <StockTakeView key={past} id={past} canWork={false} onClosed={() => show(null)} />
          </>
        ) : !data ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : data.open ? (
          <StockTakeView key={data.open.id} id={data.open.id} canWork={canWork} onClosed={() => { show(null); load(); }} />
        ) : canWork ? (
          <div className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
            <div className="mb-2 text-sm font-semibold text-gray-100">Start a stock take of the yard</div>
            <p className="mb-3 text-xs text-gray-400">
              Every tool the register has in the yard (no home toolbox) is listed to tick off - tools marked Missing too, so one that turns up goes back on the register. New tools: Register by photo on the Tools page.
            </p>
            <div className="flex flex-wrap gap-2">
              <input className="min-w-0 flex-1 rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. end of month count" maxLength={500} />
              <button className={btn} disabled={busy} onClick={start}>Start stock take</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No stock take is open.</p>
        )}

        {!past && data && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-300">Earlier stock takes</h2>
            {data.history.length === 0 ? <p className="text-xs text-gray-500">None yet.</p> : (
              <ul className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-panel">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => show(h.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-sm hover:bg-panel2/60">
                      <span className="w-44 shrink-0 text-gray-200">{day(h.finishedAt ?? h.startedAt)}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${h.status === "FINISHED" ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-700 text-gray-300"}`}>{h.status === "FINISHED" ? "Finished" : "Cancelled"}</span>
                      <span className="min-w-0 flex-1 text-xs text-gray-400">
                        {h.summary.found} of {h.summary.expected} found · {h.summary.confirmedMissing} marked missing · {h.summary.needsRepair} need repair · {h.summary.extras} from elsewhere
                      </span>
                      <span className="text-xs text-gray-500">{h.finishedBy ?? h.startedBy ?? ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
