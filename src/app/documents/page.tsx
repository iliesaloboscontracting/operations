"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { snippetParts } from "@/lib/docsearch/query";

// Documents (LCI phase 6, docs/lci/PHASE6-DESIGN.md): search the approved SharePoint folders - SWMS, scopes,
// drawings, contracts - by the words in them. Managers and Admins; what each login sees is decided on the server.
// The link opens the document in SharePoint, which checks the person's own Microsoft permission again.
type Hit = { id: string; name: string; folder: string; path: string; webUrl: string | null; modified: string | null; revision: string | null; snippet: string };
type Status = {
  connected: boolean; why: string | null; documents: number; notReadable: number; canRefresh: boolean;
  lastRun: { startedAt: string; finishedAt: string | null; error: string | null } | null; unreadable?: { name: string; folder: string; why: string | null }[];
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function DocumentsPage() {
  const { canEdit, loading } = useAuth();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const loadStatus = useCallback(() => apiFetch("/api/documents/status").then((r) => (r.ok ? r.json() : null)).then((d) => d && setSt(d)), []);
  useEffect(() => { if (canEdit) loadStatus(); }, [canEdit, loadStatus]);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const r = await apiFetch(`/api/documents?q=${encodeURIComponent(q)}`);
    setBusy(false);
    if (!r.ok) return setMsg(await serverErrorMessage(r, "Couldn't search."));
    const d = await r.json();
    setMsg(d.off ?? null);
    setHits(d.hits);
  }
  async function refresh() {
    setMsg("Refreshing…");
    const r = await apiFetch("/api/documents/refresh", { method: "POST" });
    setMsg(r.ok ? "Index refreshed." : await serverErrorMessage(r, "Couldn't refresh."));
    loadStatus();
  }

  if (!loading && !canEdit) return <PageShell title="Documents"><p className="text-sm text-gray-400">Document search is for Managers and Admins.</p></PageShell>;
  return (
    <PageShell title="Documents" subtitle="Search SWMS, scopes, drawings and contracts in the approved SharePoint folders. Opening a document goes through SharePoint's own permissions.">
      {st && (
        <p className="mb-3 text-xs text-gray-500">
          {st.connected ? `${st.documents} documents searchable${st.notReadable ? ` · ${st.notReadable} not readable` : ""}${st.lastRun ? ` · last refreshed ${when(st.lastRun.finishedAt ?? st.lastRun.startedAt)}` : " · not refreshed yet"}` : st.why}
          {st.lastRun?.error && <span className="ml-1 text-amber-300">· last refresh stopped: {st.lastRun.error}</span>}
          {st.canRefresh && st.connected && <button onClick={refresh} className="ml-2 inline-flex items-center gap-1 text-sky-400 hover:underline"><RefreshCw size={11} /> Refresh now</button>}
        </p>
      )}
      <form onSubmit={go} className="mb-4 flex max-w-2xl gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. night works spotter, hoarding, asbestos removal" className="w-full rounded-lg border border-edge bg-panel2 py-2 pl-8 pr-3 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
        </div>
        <button disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />} Search</button>
      </form>
      {msg && <p className="mb-3 text-sm text-gray-400">{msg}</p>}
      {hits && (hits.length === 0 ? <p className="text-sm text-gray-500">No documents match.</p> : (
        <div className="max-w-3xl space-y-2">
          {hits.map((h) => (
            <div key={h.id} className="rounded-xl border border-edge bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-100">{h.name}</span>
                {h.revision && <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-gray-300">{h.revision}</span>}
                <span className="ml-auto text-xs text-gray-500">{when(h.modified)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-gray-500" title={h.path}>{h.folder} · {h.path.split("/").slice(0, -1).join(" / ")}</p>
              <p className="mt-1 text-sm text-gray-300">{snippetParts(h.snippet).map((p, i) => (p.hit ? <mark key={i} className="rounded bg-amber-400/30 px-0.5 text-amber-100">{p.text}</mark> : <span key={i}>{p.text}</span>))}</p>
              {h.webUrl && <a href={h.webUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"><ExternalLink size={11} /> Open in SharePoint</a>}
            </div>
          ))}
        </div>
      ))}
      {st?.unreadable && st.unreadable.length > 0 && (
        <details className="mt-6 max-w-3xl text-xs text-gray-500">
          <summary className="cursor-pointer">Not readable ({st.unreadable.length}) - scans with no text, old formats, files over 25 MB</summary>
          <ul className="mt-1 space-y-0.5">{st.unreadable.map((u, i) => <li key={i}>{u.folder} · {u.name}{u.why ? ` - ${u.why}` : ""}</li>)}</ul>
        </details>
      )}
    </PageShell>
  );
}
