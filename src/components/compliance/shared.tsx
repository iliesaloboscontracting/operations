"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";

// Shared bits for the Accounts compliance pages (stage 5, 26 Oct 2026).
export const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
export const btn = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
export const btnPrimary = "rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50";
export const dmy = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "-");

export type FileDTO = { id: string; originalName: string; mime: string; size: number; createdAt: string; uploadedBy: string };
export type State = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED" | "NONE" | null;

export function StateChip({ state }: { state: State }) {
  if (!state) return <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[11px] text-gray-300">Archived</span>;
  const [label, tone] =
    state === "EXPIRED" ? ["Expired", "bg-red-900/70 text-red-100"]
    : state === "EXPIRING" ? ["Expires within 30 days", "bg-amber-900/70 text-amber-100"]
    : state === "NONE" ? ["No tickets", "bg-gray-700 text-gray-300"]
    : state === "NO_EXPIRY" ? ["No expiry", "bg-emerald-900/50 text-emerald-200"]
    : ["OK", "bg-emerald-900/50 text-emerald-200"];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>;
}

// Files on a ticket or document: open in a new tab (behind the login), attach, or remove (hidden, never deleted).
export function Files({ files, owner, onChanged }: { files: FileDTO[]; owner: { ticketId: string } | { documentId: string }; onChanged: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = file.type.startsWith("image/") ? await resizePhoto(file, 2200, 0.88) : await new Promise<string>((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => no(r.error);
        r.readAsDataURL(file);
      });
      const res = await apiFetch("/api/compliance/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...owner, dataUrl, originalName: file.name }) });
      if (!res.ok) setError(await serverErrorMessage(res, "Couldn't attach the file."));
      else onChanged();
    } catch {
      setError("Couldn't read that file.");
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  async function remove(id: string) {
    if (!confirm("Remove this file from the record? (It's kept in the archive, not deleted.)")) return;
    const res = await apiFetch(`/api/compliance/files/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REMOVE" }) });
    if (!res.ok) setError(await serverErrorMessage(res, "Couldn't remove it."));
    else onChanged();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((f) => (
        <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-edge px-2 py-0.5 text-xs text-gray-300">
          <FileText size={12} />
          <a href={`/api/compliance/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="max-w-[12rem] truncate hover:underline">{f.originalName}</a>
          <button onClick={() => remove(f.id)} className="text-gray-500 hover:text-red-300" title="Remove from the record">×</button>
        </span>
      ))}
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={`${btn} inline-flex items-center gap-1`}>
        <Paperclip size={12} /> {busy ? "Attaching…" : "Attach photo / PDF"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
