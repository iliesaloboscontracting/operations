"use client";

// The live read-only Xero connection on Directors -> Accounts data (G3, 25
// Oct 2026). Says plainly whether it's set up, connected, and when Xero was
// last read. Only Iliesa connects or disconnects; directors can ask for a
// fresh read (at most every 15 minutes). Never shows a token or key.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

type Status = {
  setUp: boolean; setupMessage: string | null; canConnect: boolean;
  connection: { tenantName: string; status: string; connectedBy: string; connectedAt: string; lastSyncAt: string | null; lastError: string | null } | null;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "not yet");

export default function XeroConnectionCard({ onSynced }: { onSynced?: () => void }) {
  const params = useSearchParams();
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(() =>
    params.get("xero") === "connected" ? { ok: true, text: "Xero is connected. The first read runs now - refresh in a minute." }
      : params.get("xero") === "error" ? { ok: false, text: params.get("msg") ?? "Xero wasn't connected." } : null,
  );
  const load = useCallback(() => {
    apiFetch("/api/directors/xero").then(async (r) => (r.ok ? setS(await r.json()) : setMsg({ ok: false, text: await serverErrorMessage(r, "Couldn't load the Xero connection.") })));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post(path: "sync" | "disconnect") {
    if (path === "disconnect" && !window.confirm("Disconnect Xero? Directors keep the figures already read, but they stop updating.")) return;
    setBusy(path);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/directors/xero/${path}`, { method: "POST" });
      if (!res.ok) throw new Error(await serverErrorMessage(res, path === "sync" ? "Couldn't read Xero." : "Couldn't disconnect."));
      const r = await res.json();
      setMsg({ ok: true, text: path === "sync" ? `Read ${r.invoices} sales invoices and credit notes, ${r.bills} bills and ${r.pnlLines} P&L lines from Xero.` : "Xero is disconnected." });
      if (path === "sync") onSynced?.();
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!s) return null;
  const c = s.connection?.status === "DISCONNECTED" ? null : s.connection;
  return (
    <div className={`mb-5 max-w-5xl rounded-2xl border p-4 ${c?.status === "NEEDS_REAUTH" ? "border-red-500/40 bg-red-500/10" : "border-edge bg-panel"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-100"><PlugZap size={15} /> Live Xero connection (read-only)</h2>
          {!s.setUp ? (
            <p className="mt-1 text-sm text-gray-400">Not set up yet. Iliesa creates the Xero app and the server keys are added first - until then, accounts&apos; uploads below are the source.</p>
          ) : !c ? (
            <p className="mt-1 text-sm text-gray-400">Not connected. {s.canConnect ? "Connect it once and Xero is read every night, plus whenever a director asks." : "Iliesa connects it from here."}</p>
          ) : c.status === "NEEDS_REAUTH" ? (
            <p className="mt-1 text-sm text-red-300">Xero needs connecting again - {c.lastError ?? "the connection ended"}. Figures shown are from the last good read ({when(c.lastSyncAt)}).</p>
          ) : (
            <p className="mt-1 text-sm text-gray-300">
              Connected to <span className="font-medium text-gray-100">{c.tenantName}</span> by {c.connectedBy} · last read {when(c.lastSyncAt)}
              {c.lastError && <span className="block text-[12px] text-amber-300">Last try didn&apos;t finish: {c.lastError}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {s.setUp && c?.status === "ACTIVE" && (
            <button disabled={!!busy} onClick={() => post("sync")} className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 hover:bg-panel2 disabled:opacity-40">
              {busy === "sync" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh now
            </button>
          )}
          {s.canConnect && (!c || c.status === "NEEDS_REAUTH") && (
            // A full-page visit: the browser goes to Xero to allow access, then comes back here.
            <a href="/api/directors/xero/connect" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500">{c ? "Connect again" : "Connect Xero"}</a>
          )}
          {s.canConnect && c && (
            <button disabled={!!busy} onClick={() => post("disconnect")} className="rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-40">Disconnect</button>
          )}
        </div>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
