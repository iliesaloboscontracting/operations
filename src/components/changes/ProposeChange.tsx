"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { A3_RULES, type ChangeKind } from "@/lib/changes/config";

// Propose a change (LCI phase 4, A3): one field of one record, with why and
// where the new value came from. Nothing changes until a different person
// approves it on Changes. Opened from a hire item, a "still needed" request,
// an answered query, or the Changes page itself.

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const SOURCE_TYPES = [["Phone", "Phone call"], ["Email", "Email"], ["Document", "Document"], ["Other", "Other"]] as const;

type Project = { id: string; name: string; jobNo: string | null; quoteNo: string | null };
type HireItem = { id: string; name: string; offHireDate: string | null };

export default function ProposeChange({
  kinds, recordId, recordName, fromRequestId, sourceNote, current, onClose, onDone,
}: {
  kinds: ChangeKind[];
  recordId?: string;          // the record, when it's already known (a hire item)
  recordName?: string;
  fromRequestId?: string;     // a "still needed" request or an answered query - the server reads record and source from it
  sourceNote?: string;        // shown: what it's being proposed from
  current?: string | null;    // the value now, when known
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [kind, setKind] = useState<ChangeKind>(kinds[0]);
  const isProject = A3_RULES[kind].recordType === "Project";
  const needsRecord = !recordId && !(fromRequestId && kind === "HIRE_OFF_HIRE_DATE");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [hire, setHire] = useState<HireItem[] | null>(null);
  const [pick, setPick] = useState(recordId ?? "");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [srcType, setSrcType] = useState<string>("Phone");
  const [srcText, setSrcText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsRecord) return;
    if (isProject && !projects) apiFetch("/api/changes?projects=1").then((r) => (r.ok ? r.json() : { projects: [] })).then((d) => setProjects(d.projects));
    if (!isProject && !hire) apiFetch("/api/resources?type=HIRE").then((r) => (r.ok ? r.json() : [])).then((rows: HireItem[]) => setHire(rows));
  }, [needsRecord, isProject, projects, hire]);

  const picked = projects?.find((p) => p.id === pick);
  const now = current !== undefined ? current
    : kind === "PROJECT_JOB_NO" ? picked?.jobNo ?? null : kind === "PROJECT_QUOTE_NO" ? picked?.quoteNo ?? null
    : !isProject ? hire?.find((h) => h.id === pick)?.offHireDate ?? null : undefined;

  async function send() {
    setBusy(true); setError(null);
    const valueKey = A3_RULES[kind].field;
    const body: Record<string, unknown> = {
      kind, recordId: pick || undefined, fromRequestId, reason, [valueKey]: value,
      ...(kind === "PROJECT_CONTRACT_VALUE" && notes.trim() ? { contractValueNotes: notes } : {}),
      sources: srcText.trim() ? [{ type: srcType, label: srcText.trim() }] : [],
    };
    const res = await apiFetch("/api/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setError(res ? await serverErrorMessage(res, "Couldn't propose it.") : "Couldn't reach the server.");
    const d = await res.json();
    onDone(`Proposed P-${String(d.number).padStart(4, "0")} - it changes nothing until someone else approves it on Changes.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-edge bg-panel p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-100">Propose a change</h2>
            <p className="text-xs text-gray-500">Nothing changes until a different person approves it.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-panel2" aria-label="Close"><X size={16} /></button>
        </div>
        {sourceNote && <p className="mb-3 rounded-lg bg-panel2 px-3 py-2 text-xs text-gray-300">From: {sourceNote}</p>}
        <div className="space-y-3 text-sm">
          {kinds.length > 1 && (
            <label className="block"><span className="mb-1 block text-gray-400">What to change</span>
              <select className={input} value={kind} onChange={(e) => { setKind(e.target.value as ChangeKind); setValue(""); }}>
                {kinds.map((k) => <option key={k} value={k}>{A3_RULES[k].label}</option>)}
              </select></label>
          )}
          {needsRecord && (
            <label className="block"><span className="mb-1 block text-gray-400">{isProject ? "Project" : "Hire item"}</span>
              <select className={input} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose...</option>
                {(isProject ? projects ?? [] : hire ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
          )}
          {recordName && <p className="text-gray-300">{recordName}</p>}
          {now !== undefined && <p className="text-xs text-gray-500">Now: {now ?? "empty"}</p>}
          <label className="block"><span className="mb-1 block text-gray-400">New {A3_RULES[kind].label.toLowerCase()}</span>
            {kind === "HIRE_OFF_HIRE_DATE" ? <input type="date" className={input} value={value} onChange={(e) => setValue(e.target.value)} />
              : <input className={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "PROJECT_CONTRACT_VALUE" ? "e.g. 1,250,000 (ex GST)" : "e.g. 26_408"} />}
          </label>
          {kind === "PROJECT_CONTRACT_VALUE" && (
            <label className="block"><span className="mb-1 block text-gray-400">Notes (optional - e.g. ex GST, per letter of award)</span>
              <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          )}
          <label className="block"><span className="mb-1 block text-gray-400">Why</span>
            <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Still needed for the slab - supplier agreed" /></label>
          <div>
            <span className="mb-1 block text-gray-400">Where the new value came from{fromRequestId ? " (optional - the request is cited already)" : ""}</span>
            <div className="flex gap-2">
              <select className={`${input} w-32`} value={srcType} onChange={(e) => setSrcType(e.target.value)}>
                {SOURCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input className={input} value={srcText} onChange={(e) => setSrcText(e.target.value)} placeholder="e.g. Hire Express, Sam, 25 Oct" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">{A3_RULES[kind].alsoMoves}</p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={send} disabled={busy || !value.trim() || reason.trim().length < 3 || (needsRecord && !pick)} className="flex-1 rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white disabled:opacity-40">Propose</button>
            <button onClick={onClose} className="rounded-lg border border-edge px-3 py-2 text-gray-400">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
