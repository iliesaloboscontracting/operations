"use client";

// Directors -> Information requests (Task I, 25 Oct 2026): every question
// asked of accounts, Nick or Yoel - plain ones and those raised from a
// finding - open, answered and closed. Who, when, how long it's waited, the
// answer and any file; Close, ask a follow-up, or Nudge (a reminder they see
// on their banner - no phone alert). Ask a new one here; Ilies reviews and
// sends drafted batches on Draft questions. Owner + director access only.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Paperclip } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { whenText } from "@/lib/requestTypes";
import ProposeChange from "@/components/changes/ProposeChange";

type Row = {
  id: string; ref: string; title: string; question: string; need: string | null; why: string | null; infoType: "QUESTION" | "FYI"; batch: string | null;
  finding: string | null; to: string | null; askedBy: string; askedByAi?: boolean; askedAt: string; dueBy: string; status: string; daysWaiting: number | null;
  followUp: string | null; answer: string | null; answeredAt: string | null; readAt: string | null; hasFile: boolean; remindedAt: string | null;
  outcome: string | null; closedAt: string | null;
};
type Person = { id: string; name: string; kind: string };
type Data = { requests: Row[]; people: Person[]; canBatch: boolean };

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const WAITING = ["SENT", "SEEN", "TODO", "NEEDS_INFO"];
const GROUPS: { key: string; label: string; test: (r: Row) => boolean }[] = [
  { key: "answered", label: "Answered - ready to close", test: (r) => r.status === "ANSWERED" },
  { key: "waiting", label: "Waiting on them", test: (r) => WAITING.includes(r.status) },
  { key: "closed", label: "Closed", test: (r) => !WAITING.includes(r.status) && r.status !== "ANSWERED" },
];
const statusWord = (r: Row) =>
  r.status === "ANSWERED" ? "Answered" : r.status === "NEEDS_INFO" ? "Follow-up asked" : WAITING.includes(r.status) ? (r.infoType === "FYI" ? "Not read yet" : "Waiting") :
    r.infoType === "FYI" && r.status === "DONE" ? "Read" : r.status === "DONE" ? "Closed" : r.status === "DECLINED" ? "Declined" : r.status.toLowerCase();

export default function InfoRequestsPage() {
  const { isDirector, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [aiOnly, setAiOnly] = useState(false); // questions Operations AI sent (27 Oct 2026)
  const load = useCallback(() => {
    apiFetch("/api/info-requests").then(async (r) => (r.ok ? setD(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load the requests."))));
  }, []);
  useEffect(() => { if (!loading && isDirector) load(); }, [loading, isDirector, load]);

  if (loading) return null;
  if (!isDirector) {
    return <PageShell title="Information requests"><div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only Iliesa and the directors can see this page.</div></PageShell>;
  }
  const waiting = d?.requests.filter((r) => WAITING.includes(r.status)).length ?? 0;
  const answered = d?.requests.filter((r) => r.status === "ANSWERED").length ?? 0;
  return (
    <PageShell
      title="Information requests"
      subtitle={d ? `${answered} answered to close · ${waiting} waiting on someone · answers never change data by themselves` : undefined}
      actions={d?.canBatch ? <Link href="/directors/requests/drafts" className="rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2">Draft questions</Link> : undefined}
    >
      {error ? <p className="text-sm text-red-400">{error}</p> : !d ? <p className="text-sm text-gray-500">Loading...</p> : (
        <div className="max-w-5xl space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <AskForm people={d.people} onDone={load} />
            {d.requests.some((r) => r.askedByAi) && (
              <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} /> Only sent by Operations AI ({d.requests.filter((r) => r.askedByAi).length})
              </label>
            )}
          </div>
          {GROUPS.filter((g) => g.key !== "closed" || showClosed).map((g) => {
            const rows = d.requests.filter((r) => g.test(r) && (!aiOnly || r.askedByAi));
            return (
              <section key={g.key}>
                <h2 className="mb-2 text-sm font-semibold text-gray-300">{g.label} ({rows.length})</h2>
                {!rows.length ? <p className="text-sm text-gray-500">None.</p> : (
                  <div className="space-y-2">{rows.map((r) => <RequestRow key={r.id} r={r} onDone={load} />)}</div>
                )}
              </section>
            );
          })}
          <button onClick={() => setShowClosed((v) => !v)} className="text-sm text-gray-400 hover:text-gray-200">{showClosed ? "Hide" : "Show"} closed ({d.requests.filter(GROUPS[2].test).length})</button>
        </div>
      )}
    </PageShell>
  );
}

function AskForm({ people, onDone }: { people: Person[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ toUserId: "", type: "QUESTION", title: "", question: "", need: "", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function send() {
    setBusy(true); setMsg(null);
    try {
      const res = await apiFetch("/api/info-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, dueDate: f.dueDate || null }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send it."));
      setF({ toUserId: "", type: "QUESTION", title: "", question: "", need: "", dueDate: "" });
      setMsg({ ok: true, text: "Sent - they'll see it at the top of their screen." });
      onDone();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Ask a question</button>;
  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-100">Ask a question</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] text-gray-400">To
          <select value={f.toUserId} onChange={set("toUserId")} className={`${input} mt-1`}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}
          </select>
        </label>
        <label className="text-[12px] text-gray-400">Type
          <select value={f.type} onChange={set("type")} className={`${input} mt-1`}>
            <option value="QUESTION">Question - needs an answer</option>
            <option value="FYI">FYI - just mark read</option>
          </select>
        </label>
        <label className="text-[12px] text-gray-400">Due (optional)
          <input type="date" value={f.dueDate} onChange={set("dueDate")} className={`${input} mt-1`} />
        </label>
      </div>
      <input value={f.title} onChange={set("title")} placeholder="Short title, e.g. Master tender register" className={`${input} mt-3`} />
      <textarea rows={3} value={f.question} onChange={set("question")} placeholder={f.type === "FYI" ? "The note to pass on" : "The question"} className={`${input} mt-2`} />
      {f.type === "QUESTION" && <input value={f.need} onChange={set("need")} placeholder="What we need (optional), e.g. the spreadsheet saved as CSV" className={`${input} mt-2`} />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button disabled={busy || !f.toUserId || f.title.trim().length < 3 || f.question.trim().length < 5} onClick={send} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />} Send
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

function RequestRow({ r, onDone }: { r: Row; onDone: () => void }) {
  // Managers and Admins (Ilies) may propose any project change; a DIRECTOR login only the contract value.
  const { canEdit } = useAuth();
  const [mode, setMode] = useState<"ASK" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [changeFlash, setChangeFlash] = useState<string | null>(null);
  const waiting = WAITING.includes(r.status);
  const open = waiting || r.status === "ANSWERED";
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch(`/api/info-requests/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't do that."));
      setMode(null); setText(""); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const tone = r.status === "ANSWERED" ? "text-emerald-300" : waiting ? "text-amber-300" : "text-gray-500";
  const late = useMemo(() => waiting && new Date(r.dueBy).getTime() < Date.now(), [waiting, r.dueBy]);
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-gray-100">{r.title}</span>
          {r.askedByAi && <span className="ml-2 rounded-full border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200">Sent by Operations AI</span>}
          <span className="text-[12px] text-gray-500"> · {r.ref} · to {r.to} · {r.infoType === "FYI" ? "FYI · " : ""}asked {whenText(r.askedAt)} by {r.askedBy}</span>
        </div>
        <span className={`text-[12px] font-medium ${tone}`}>
          {statusWord(r)}{r.daysWaiting != null ? ` · ${r.daysWaiting} day${r.daysWaiting === 1 ? "" : "s"} waiting` : ""}{late ? " · past due" : ""}
        </span>
      </div>
      {r.finding && <p className="text-[11px] text-gray-500">From the finding: {r.finding}</p>}
      <p className="mt-1 whitespace-pre-line text-sm text-gray-300">{r.question}</p>
      {r.need && <p className="text-sm text-gray-400"><span className="text-gray-500">What we need:</span> {r.need}</p>}
      {r.followUp && <p className="mt-1 text-sm text-amber-300">Follow-up: {r.followUp}</p>}
      {r.answer && (
        <p className="mt-2 rounded-lg bg-panel2 p-2 text-sm text-sky-200">
          {r.answer}
          {r.hasFile && <> · <a href={`/api/queries/${r.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><Paperclip size={12} /> file</a></>}
          {r.answeredAt && <span className="text-[11px] text-gray-500"> · {whenText(r.answeredAt)}</span>}
        </p>
      )}
      {r.remindedAt && waiting && <p className="mt-1 text-[12px] text-gray-500">Reminded {whenText(r.remindedAt)}</p>}
      {r.outcome && !open && <p className="mt-1 text-[12px] text-gray-500">{r.infoType === "FYI" && r.readAt ? `Read ${whenText(r.readAt)}` : `Closed: ${r.outcome}`}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {r.status === "ANSWERED" && <button disabled={busy} onClick={() => act("CLOSE")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Close - thanks</button>}
        {open && r.infoType === "QUESTION" && <button disabled={busy} onClick={() => setMode(mode ? null : "ASK")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2">Ask a follow-up</button>}
        {waiting && <button disabled={busy} onClick={() => act("NUDGE")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2">Nudge</button>}
        {waiting && <button disabled={busy} onClick={() => act("CLOSE", { outcome: "Closed without an answer" })} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-300">Close without answer</button>}
        {!open && <button disabled={busy} onClick={() => act("REOPEN")} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-gray-300">Reopen</button>}
        {r.answer && <button onClick={() => setProposing(true)} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2">Propose a change from this answer</button>}
      </div>
      {changeFlash && <p className="mt-1 text-sm text-emerald-300">{changeFlash}</p>}
      {/* Controlled changes (LCI phase 4): contract value, job or quote number - approved by someone else, never the person who answered. */}
      {proposing && (
        <ProposeChange kinds={canEdit ? ["PROJECT_CONTRACT_VALUE", "PROJECT_JOB_NO", "PROJECT_QUOTE_NO"] : ["PROJECT_CONTRACT_VALUE"]} fromRequestId={r.id} sourceNote={`${r.ref} - ${r.title}, answered by ${r.to}`}
          onClose={() => setProposing(false)} onDone={(m) => { setChangeFlash(m); setProposing(false); }} />
      )}
      {mode === "ASK" && (
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="The follow-up question" className={input} />
          <button disabled={busy || text.trim().length < 2} onClick={() => act("ASK", { question: text })} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Send</button>
        </div>
      )}
      {err && <p className="mt-1 text-sm text-red-400">{err}</p>}
    </div>
  );
}
