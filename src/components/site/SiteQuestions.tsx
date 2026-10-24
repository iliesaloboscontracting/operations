"use client";

// Questions from the office on a person's own site link (Phase 2, 25 Oct
// 2026). Shows only when the office has asked this person something: the
// question, by when, and a box to answer. Operational and money-free only -
// the server never sends anything else to a link. Nothing on screen when
// there are no questions.
import { useCallback, useEffect, useState } from "react";
import { HelpCircle, Loader2 } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { whenText } from "@/lib/requestTypes";
import type { AssigneeQueryView } from "@/lib/findings/queries";

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";

export default function SiteQuestions({ api }: { api: string }) {
  const [rows, setRows] = useState<AssigneeQueryView[]>([]);
  const load = useCallback(async () => {
    const res = await fetch(`${api}/queries`).catch(() => null);
    if (res?.ok) setRows(((await res.json()) as { queries: AssigneeQueryView[] }).queries);
  }, [api]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const open = rows.filter((q) => q.canAnswer);
  if (!open.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200">
        <HelpCircle size={18} /> {open.length === 1 ? "A question from the office" : `${open.length} questions from the office`}
      </div>
      <div className="space-y-3">{open.map((q) => <Question key={q.id} q={q} api={api} onDone={load} />)}</div>
    </div>
  );
}

function Question({ q, api, onDone }: { q: AssigneeQueryView; api: string; onDone: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${api}/queries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: q.id, answer }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal."));
      setAnswer("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-lg bg-panel p-3">
      <div className="text-[11px] text-gray-500">{q.site} · from {q.askedBy} · by {whenText(q.neededBy)}</div>
      <p className="mt-1 text-base text-gray-100">{q.question}</p>
      {q.followUp && <p className="mt-1 text-sm text-amber-300">Follow-up: {q.followUp}</p>}
      <textarea rows={2} className={`${input} mt-2`} placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
      <button disabled={busy || answer.trim().length < 2} onClick={send} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-base font-semibold text-white disabled:opacity-40">
        {busy && <Loader2 size={16} className="animate-spin" />} Send answer
      </button>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
