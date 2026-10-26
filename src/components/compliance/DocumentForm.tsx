"use client";

import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { DOCUMENT_KINDS } from "@/lib/compliance/rules";
import { btnPrimary, input } from "./shared";

// Add or edit a company / subcontractor document (stage 5). No cover amounts or premiums: no money here.
export type DocumentDTO = {
  id: string; holderType: string; holderName: string; kind: string; kindLabel: string; title: string; reference: string | null;
  issueDate: string | null; expiryDate: string | null; status: string; archivedReason: string | null; notes: string | null;
  state: "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED" | null; files: import("./shared").FileDTO[];
};

export default function DocumentForm({ doc, holders, onDone, onCancel }: { doc?: DocumentDTO; holders: string[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    holderType: doc?.holderType ?? "COMPANY", holderName: doc?.holderName ?? "Lobos Contracting", kind: doc?.kind ?? "PUBLIC_LIABILITY",
    title: doc?.title ?? "", reference: doc?.reference ?? "", issueDate: doc?.issueDate ?? "", expiryDate: doc?.expiryDate ?? "", notes: doc?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...f, title: f.title || DOCUMENT_KINDS.find(([k]) => k === f.kind)?.[1] };
    const res = doc
      ? await apiFetch(`/api/compliance/documents/${doc.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "EDIT", ...body }) })
      : await apiFetch("/api/compliance/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save the document."));
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <p className="text-sm font-medium text-gray-200">{doc ? "Edit document" : "Add a document"}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Whose<select className={input} value={f.holderType} onChange={set("holderType")}><option value="COMPANY">Company (Lobos)</option><option value="SUBCONTRACTOR">Subcontractor / labour hire</option></select></label>
        <label className="text-xs text-gray-400 sm:col-span-2">Name<input className={input} list="compliance-holders" value={f.holderName} onChange={set("holderName")} />
          <datalist id="compliance-holders">{holders.map((h) => <option key={h} value={h} />)}</datalist></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Kind<select className={input} value={f.kind} onChange={set("kind")}>{DOCUMENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs text-gray-400 sm:col-span-2">Title<input className={input} value={f.title} onChange={set("title")} placeholder="e.g. Public liability 2026-27" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Policy / licence number<input className={input} value={f.reference} onChange={set("reference")} /></label>
        <label className="text-xs text-gray-400">Issued / from<input type="date" className={input} value={f.issueDate} onChange={set("issueDate")} /></label>
        <label className="text-xs text-gray-400">Expires (blank = no expiry)<input type="date" className={input} value={f.expiryDate} onChange={set("expiryDate")} /></label>
      </div>
      <textarea className={input} rows={2} placeholder="Notes (no amounts)" value={f.notes} onChange={set("notes")} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={btnPrimary}>{doc ? "Save" : "Add"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-edge px-3.5 py-2 text-sm text-gray-300 hover:bg-panel2">Cancel</button>
      </div>
    </form>
  );
}
