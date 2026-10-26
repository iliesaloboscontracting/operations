"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import DocumentForm, { type DocumentDTO } from "@/components/compliance/DocumentForm";
import { Files, StateChip, btn, dmy, input, type State } from "@/components/compliance/shared";

// Accounts stage 5 (Compliance & HR, 26 Oct 2026): workers' tickets and onboarding, and company / subcontractor
// documents with expiries. Accounts login + Admins. Expiry reminders appear on To do and Due dates through the
// Accounts calendar. Design: docs/accounts/STAGE5-DESIGN.md.
type Worker = {
  id: string; name: string; role: string | null; category: string | null; worst: State; activeTickets: number;
  expired: string[]; expiring: string[]; nextExpiry: string | null; onboarding: { done: number; of: number };
};

function Workers() {
  const [rows, setRows] = useState<Worker[] | null>(null);
  const [q, setQ] = useState("");
  const [attention, setAttention] = useState(false);
  useEffect(() => { apiFetch("/api/compliance/workers").then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.workers)); }, []);
  const list = useMemo(() => (rows ?? []).filter((w) => (!attention || w.worst === "EXPIRED" || w.worst === "EXPIRING" || w.worst === "NONE")
    && (!q || `${w.name} ${w.role ?? ""} ${w.category ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, attention]);
  if (!rows) return <p className="text-sm text-gray-500">Loading…</p>;
  const counts = { expired: rows.filter((w) => w.worst === "EXPIRED").length, expiring: rows.filter((w) => w.worst === "EXPIRING").length };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${input} max-w-xs`} placeholder="Search workers" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm text-gray-300"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Needs attention only</label>
        <span className="text-xs text-gray-500">{counts.expired} with an expired ticket · {counts.expiring} expiring within 30 days</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-edge text-left text-xs text-gray-500">
            <tr><th className="px-3 py-2">Worker</th><th className="px-3 py-2">Tickets</th><th className="px-3 py-2">Expired / expiring</th><th className="px-3 py-2">Next expiry</th><th className="px-3 py-2">Onboarding</th></tr>
          </thead>
          <tbody className="divide-y divide-edge/60">
            {list.map((w) => (
              <tr key={w.id} className="hover:bg-panel2">
                <td className="px-3 py-2"><Link href={`/accounts/compliance/workers/${w.id}`} className="font-medium text-brand-300 hover:underline">{w.name}</Link><span className="block text-xs text-gray-500">{[w.role, w.category].filter(Boolean).join(" · ")}</span></td>
                <td className="px-3 py-2"><StateChip state={w.worst} /> <span className="ml-1 text-xs text-gray-500">{w.activeTickets}</span></td>
                <td className="px-3 py-2 text-xs">{w.expired.length > 0 && <span className="block text-red-300">{w.expired.join(", ")}</span>}{w.expiring.length > 0 && <span className="block text-amber-300">{w.expiring.join(", ")}</span>}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{dmy(w.nextExpiry)}</td>
                <td className="px-3 py-2 text-xs text-gray-400">{w.onboarding.done} of {w.onboarding.of}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-sm text-gray-500">No workers match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Documents() {
  const [data, setData] = useState<{ documents: DocumentDTO[]; holders: string[] } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<DocumentDTO | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiFetch(`/api/compliance/documents${showArchived ? "?all=1" : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)), [showArchived]);
  useEffect(() => { load(); }, [load]);

  async function act(d: DocumentDTO, action: "ARCHIVE" | "RESTORE") {
    const reason = action === "ARCHIVE" ? prompt("Why archive it? (e.g. replaced by the new policy)") : "";
    if (action === "ARCHIVE" && !reason) return;
    const res = await apiFetch(`/api/compliance/documents/${d.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    if (!res.ok) setError(await serverErrorMessage(res, "Couldn't change it."));
    else { setError(null); load(); }
  }

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setEditing("new")} className={`${btn} inline-flex items-center gap-1`}><Plus size={12} /> Add a document</button>
        <label className="flex items-center gap-1.5 text-sm text-gray-300"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {editing && <div className="mb-3"><DocumentForm doc={editing === "new" ? undefined : editing} holders={data.holders} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} /></div>}
      <div className="space-y-2">
        {data.documents.map((d) => (
          <div key={d.id} className="rounded-xl border border-edge bg-panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-100">{d.title}</span>
              <StateChip state={d.state} />
              <span className="text-xs text-gray-500">{d.holderName} · {d.kindLabel}{d.reference ? ` · ${d.reference}` : ""}</span>
              <span className="ml-auto text-xs text-gray-400">{d.expiryDate ? `Expires ${dmy(d.expiryDate)}` : "No expiry"}</span>
            </div>
            {d.archivedReason && <p className="mt-1 text-xs text-gray-500">Archived: {d.archivedReason}</p>}
            {d.notes && <p className="mt-1 text-xs text-gray-400">{d.notes}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Files files={d.files} owner={{ documentId: d.id }} onChanged={load} />
              <span className="ml-auto flex gap-2">
                {d.status === "ACTIVE" ? <><button className={btn} onClick={() => setEditing(d)}>Edit</button><button className={btn} onClick={() => act(d, "ARCHIVE")}>Archive</button></> : <button className={btn} onClick={() => act(d, "RESTORE")}>Restore</button>}
              </span>
            </div>
          </div>
        ))}
        {data.documents.length === 0 && <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-500">No documents yet. Add the company insurances and licences, and each subcontractor&apos;s.</p>}
      </div>
    </>
  );
}

// useSearchParams needs a Suspense boundary in Next 15.
export default function CompliancePage() {
  return <Suspense fallback={null}><Compliance /></Suspense>;
}

function Compliance() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "documents" ? "documents" : "workers";
  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Compliance"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  return (
    <PageShell title="Compliance" subtitle="Tickets and onboarding per worker, and company / subcontractor documents. Expiries remind you on To do 30 days ahead.">
      <div className="mb-4 flex gap-2 text-sm">
        {([["workers", "Workers"], ["documents", "Company & subcontractors"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => router.replace(k === "workers" ? "/accounts/compliance" : "/accounts/compliance?tab=documents")}
            className={`rounded-full px-3 py-1 ${tab === k ? "bg-brand-600 text-white" : "border border-edge text-gray-300"}`}>{l}</button>
        ))}
      </div>
      {tab === "workers" ? <Workers /> : <Documents />}
    </PageShell>
  );
}
