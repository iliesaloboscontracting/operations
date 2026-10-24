"use client";

// The questions asked of this login (Phase 2, 25 Oct 2026) - accounts on her
// Invoices page (Queries tab), Nick and Yoel on Directors -> My queries. Each
// one: the question, who asked, by when; answer it (text + an optional file)
// and it goes back to Ilies to close. Answering never changes any record.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { whenText } from "@/lib/requestTypes";
import type { AssigneeQueryView } from "@/lib/findings/queries";

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const STATUS: Record<string, string> = { TODO: "To answer", SEEN: "To answer", NEEDS_INFO: "Follow-up question", ANSWERED: "Answered - with Ilies", DONE: "Closed", DECLINED: "Closed", CANCELLED: "Cancelled" };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That file couldn't be opened."));
    r.readAsDataURL(file);
  });
}

export function useMyQueries() {
  const [rows, setRows] = useState<AssigneeQueryView[] | null>(null);
  const load = useCallback(() => apiFetch("/api/queries").then((r) => (r.ok ? r.json() : { queries: [] })).then((d) => setRows(d.queries)), []);
  useEffect(() => { load(); }, [load]);
  return { rows, load, waiting: (rows ?? []).filter((q) => q.canAnswer).length };
}

export default function MyQueries({ rows, onChange }: { rows: AssigneeQueryView[] | null; onChange: () => void }) {
  if (!rows) return <p className="py-6 text-center text-sm text-gray-500">Loading...</p>;
  const open = rows.filter((q) => q.canAnswer);
  const rest = rows.filter((q) => !q.canAnswer);
  return (
    <div className="space-y-4">
      {open.length === 0 && <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-emerald-400">No questions waiting on you.</p>}
      {open.map((q) => <QueryCard key={q.id} q={q} onChange={onChange} />)}
      {rest.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Answered and closed (last 2 weeks)</div>
          <div className="space-y-2">{rest.map((q) => <QueryCard key={q.id} q={q} onChange={onChange} />)}</div>
        </div>
      )}
    </div>
  );
}

function QueryCard({ q, onChange }: { q: AssigneeQueryView; onChange: () => void }) {
  const [answer, setAnswer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { answer };
      if (file) { body.file = await readAsDataUrl(file); body.fileName = file.name; }
      const res = await apiFetch(`/api/queries/${q.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send your answer."));
      setAnswer(""); setFile(null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`rounded-xl border border-edge bg-panel p-4 ${q.canAnswer ? "" : "opacity-80"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <span>{q.ref} · {q.site} · from {q.askedBy}, {whenText(q.askedAt)}</span>
        <span className={q.canAnswer ? "text-amber-300" : ""}>{STATUS[q.status] ?? q.status}{q.canAnswer ? ` · by ${whenText(q.neededBy)}` : ""}</span>
      </div>
      <p className="mt-1 text-sm font-medium text-gray-100">{q.question}</p>
      {q.finding && <p className="mt-0.5 text-[11px] text-gray-500">About: {q.finding}</p>}
      {q.followUp && <p className="mt-2 text-sm text-amber-300">Follow-up: {q.followUp}</p>}
      {q.answer && <p className="mt-2 text-sm text-sky-300">Your answer: {q.answer}{q.hasFile ? " (file attached)" : ""}</p>}
      {q.outcome && <p className="mt-1 text-sm text-emerald-300">Closed: {q.outcome}</p>}
      {q.canAnswer && (
        <div className="mt-3 space-y-2">
          <textarea rows={3} className={input} placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2">
              <Paperclip size={13} /> {file ? file.name : "Attach a file (optional)"}
              <input type="file" accept="application/pdf,image/*,.xlsx,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <button disabled={busy || answer.trim().length < 2} onClick={send} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              {busy && <Loader2 size={14} className="animate-spin" />} Send answer
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-[11px] text-gray-500">Your answer goes to Ilies to close. It doesn&apos;t change anything in Operations by itself.</p>
        </div>
      )}
    </div>
  );
}
