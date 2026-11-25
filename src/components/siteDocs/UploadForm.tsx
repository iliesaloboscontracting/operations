"use client";

// Upload a plan / drawing or a new SWMS version for a project (site documents, 25 Nov 2026) - the office's Site
// documents page and the coordinator's dashboard card share it (Ilies: "allow him to upload documents aswell from his
// dashboard which the crew get on their apps"). PDF / JPEG / PNG (a SWMS is a PDF), 7 MB a file - the server checks the
// bytes. The file then shows on the supervisors' links for that project.
import { useState } from "react";
import { Upload } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { UPLOAD_FILE_MAX, UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";
import { readAsDataUrl } from "@/lib/siteDocs/browser";

const inputCls = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";

export default function UploadForm({ projectId, kind, onDone }: { projectId: string; kind: "PLAN" | "SWMS"; onDone: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  async function send() {
    if (!file) return;
    if (file.size > UPLOAD_FILE_MAX) return setError(UPLOAD_TOO_LARGE);
    setBusy(true); setError(null);
    const dataUrl = await readAsDataUrl(file).catch(() => null);
    if (!dataUrl) { setBusy(false); return setError("That file couldn't be read."); }
    const r = await apiFetch("/api/site-documents/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, kind, title: title || file.name.replace(/\.[^.]+$/, ""), fileName: file.name, dataUrl }) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't upload it."));
    setTitle(""); setFile(null); setKey((k) => k + 1); onDone();
  }
  if (!user) return null;
  return (
    <div className="space-y-2 rounded-lg border border-edge/70 bg-panel2/40 p-3">
      <input className={inputCls} maxLength={120} placeholder={kind === "SWMS" ? "Title - e.g. Demolition SWMS" : "Title - e.g. Level 2 demolition plan"} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <input key={key} type="file" accept={kind === "SWMS" ? "application/pdf,.pdf" : "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"} className="text-xs text-gray-300" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className={btn} disabled={!file || busy} onClick={send}><Upload size={14} /> {busy ? "Uploading…" : kind === "SWMS" ? "Upload new version" : "Upload"}</button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
