"use client";

// One stored finding, opened from the Directors "Needs attention" list
// (Phase 2, 25 Oct 2026): what it is, its measured values, its history, the
// evidence (including answers to queries), and - for Ilies and directors -
// what to do about it: acknowledge, give it an owner, resolve, dismiss,
// comment, verify, or ask someone a question. Asking never changes a record.
import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { whenText } from "@/lib/requestTypes";
import type { FindingDetail } from "@/app/api/findings/[id]/route";
import { DLink, Help, PriorityPill } from "./parts";

type People = { owners: { id: string; name: string }[]; opsOwners?: { id: string; name: string }[]; askUsers: { id: string; name: string; kind: string }[]; askLinks: { id: string; name: string; role: string | null }[] };
type Mode = null | "ASSIGN" | "RESOLVE" | "DISMISS" | "COMMENT" | "VERIFY" | "ASK";

const input = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const STATUS_LABEL: Record<string, string> = { OPEN: "Open", ACKNOWLEDGED: "Acknowledged", ACTIONED: "Being actioned", RESOLVED: "Resolved", DISMISSED: "Dismissed", VERIFIED: "Verified" };
const EVENT_LABEL: Record<string, string> = {
  OPENED: "Opened", ESCALATED: "Got worse", DEESCALATED: "Eased", ACKNOWLEDGED: "Acknowledged", ASSIGNED: "Owner set", QUERY_CREATED: "Question asked",
  ANSWERED: "Answered", QUERY_CLOSED: "Question closed", ACTIONED: "Actioned", RESOLVED: "Resolved", AUTO_RESOLVED: "Closed itself", SIGNAL_CLEARED: "No longer showing",
  SIGNAL_RETURNED: "Showing again", NOT_FIXED: "Fix didn't take", DISMISSED: "Dismissed", REOPENED: "Reopened", RECURRED: "Came back", VERIFIED: "Verified", COMMENT: "Comment",
};
const OPENISH = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const valueText = (v: unknown) => (typeof v === "number" ? (Math.abs(v) < 2 && !Number.isInteger(v) ? `${Math.round(v * 100)}%` : v.toLocaleString("en-AU", { maximumFractionDigits: 2 })) : String(v));

export default function FindingPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<FindingDetail | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(() => apiFetch(`/api/findings/${id}`).then(async (r) => (r.ok ? setD(await r.json()) : setError("Couldn't load this finding."))), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (d?.canAct && !people) apiFetch("/api/findings/people").then(async (r) => r.ok && setPeople(await r.json()));
  }, [d?.canAct, people]);

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save."));
      setMode(null);
      setForm({});
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const act = (action: string, extra: Record<string, unknown> = {}) => post(`/api/findings/${id}`, { action, ...extra });

  function submit() {
    if (mode === "ASSIGN") return act("ASSIGN", { ownerUserId: form.owner, note: form.note });
    if (mode === "RESOLVE") return act("RESOLVE", { note: form.note });
    if (mode === "DISMISS") return act("DISMISS", { kind: form.kind ?? "FALSE_ALARM", reason: form.note, until: form.until });
    if (mode === "COMMENT") return act("COMMENT", { note: form.note });
    if (mode === "VERIFY") return act("VERIFY", { result: form.result ?? "EFFECTIVE", note: form.note });
    if (mode === "ASK") {
      const [type, targetId] = (form.target ?? "").split(":");
      return post(`/api/findings/${id}/queries`, { question: form.note, ...(type === "U" ? { userId: targetId } : { resourceId: targetId }), neededBy: form.by ? new Date(`${form.by}T17:00:00`).toISOString() : undefined });
    }
  }

  const f = d?.finding;
  const open = f ? OPENISH.includes(f.status) : false;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-edge bg-panel p-4 shadow-xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {f && <div className="flex items-center gap-2"><PriorityPill p={f.severity} /><span className="text-xs text-gray-500">{STATUS_LABEL[f.status] ?? f.status}{f.ownerName ? ` · owner ${f.ownerName}` : ""}</span></div>}
            <h2 className="mt-1 text-base font-semibold text-gray-100">{f?.title ?? "Loading..."}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-panel2" aria-label="Close"><X size={18} /></button>
        </div>
        {!d ? (
          <p className="py-10 text-center text-sm text-gray-500">{error ?? "Loading..."}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
              <span>Open since {whenText(f!.firstSeenAt)}</span>
              <span>Last seen {whenText(f!.lastSeenAt)}</span>
              {f!.signalClearedAt && <span className="text-emerald-400">No longer showing since {whenText(f!.signalClearedAt)}</span>}
              {f!.provisional && <span>Data incomplete</span>}
              {f!.href && <DLink href={f!.href} className="text-brand-300 hover:underline">Open the record</DLink>}
              <Help id={f!.kpi} />
            </div>
            {f!.resolution && <p className="mb-2 text-sm text-emerald-300">Resolved by {f!.resolvedBy}: {f!.resolution}</p>}
            {f!.dismissReason && <p className="mb-2 text-sm text-gray-400">Dismissed ({f!.dismissKind === "ACCEPTED_RISK" ? `accepted risk until ${f!.suppressUntil}` : "false alarm"}): {f!.dismissReason}</p>}

            {f!.currentValue && Object.keys(f!.currentValue).length > 0 && (
              <dl className="mb-3 grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-panel2 p-3 text-xs">
                {Object.entries(f!.currentValue).filter(([, v]) => v !== null).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-gray-500">{k}</dt><dd className="text-gray-200">{valueText(v)}</dd></div>
                ))}
              </dl>
            )}

            {d.queries.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Questions</div>
                <div className="space-y-1.5">
                  {d.queries.map((q) => (
                    <div key={q.id} className="rounded-lg border border-edge p-2 text-sm">
                      <div className="text-[11px] text-gray-500">{q.ref} · to {q.to} · {q.statusLabel}</div>
                      <div className="text-gray-200">{q.question}</div>
                      {q.answer && <div className="text-sky-300">Answer: {q.answer}</div>}
                      {q.hasFile && <a href={`/api/queries/${q.id}/file`} target="_blank" rel="noreferrer" className="text-xs text-gray-300 underline">Attached file</a>}
                      {q.outcome && <div className="text-emerald-300">Closed: {q.outcome}</div>}
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">Ilies closes or follows up questions from Requests. An answer never changes a record - a change is proposed and applied the usual way.</p>
              </div>
            )}

            {d.canAct && (
              <div className="mb-4 rounded-lg border border-edge bg-panel2 p-3">
                {!mode ? (
                  <div className="flex flex-wrap gap-2">
                    {open && f!.status === "OPEN" && <button disabled={busy} onClick={() => act("ACKNOWLEDGE")} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">Acknowledge</button>}
                    {open && <button onClick={() => { setMode("ASK"); set("by", plusDays(2)); }} className="rounded-lg border border-brand-500/50 px-3 py-1.5 text-sm text-brand-200 hover:bg-panel">Ask…</button>}
                    {open && <button onClick={() => setMode("ASSIGN")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 hover:bg-panel">Owner</button>}
                    {open && <button onClick={() => setMode("RESOLVE")} className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-panel">Resolve</button>}
                    {open && <button onClick={() => setMode("DISMISS")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel">Dismiss</button>}
                    {f!.status === "RESOLVED" && f!.resolvedWhileFiring && <button onClick={() => setMode("VERIFY")} className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-panel">Verify</button>}
                    <button onClick={() => setMode("COMMENT")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel">Comment</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mode === "ASK" && (
                      <>
                        <select className={input} value={form.target ?? ""} onChange={(e) => set("target", e.target.value)}>
                          <option value="">Who to ask…</option>
                          {people?.askUsers.length ? <optgroup label="Logins">{people.askUsers.map((u) => <option key={u.id} value={`U:${u.id}`}>{u.name} ({u.kind})</option>)}</optgroup> : null}
                          {people?.askLinks.length ? <optgroup label="On their site link - no dollar figures">{people.askLinks.map((r) => <option key={r.id} value={`R:${r.id}`}>{r.name}{r.role ? ` (${r.role})` : ""}</option>)}</optgroup> : null}
                        </select>
                        <textarea rows={3} className={input} placeholder="The question - e.g. What's the contract value for this job, and which quote revision?" value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} />
                        <label className="flex items-center gap-2 text-xs text-gray-400">Answer by <input type="date" className={`${input} w-auto`} value={form.by ?? ""} onChange={(e) => set("by", e.target.value)} /></label>
                        <p className="text-[11px] text-gray-500">They answer on their own screen; Ilies closes it from Requests. Asking never changes a record.</p>
                      </>
                    )}
                    {mode === "ASSIGN" && (
                      <select className={input} value={form.owner ?? ""} onChange={(e) => set("owner", e.target.value)}>
                        <option value="">Who owns it…</option>
                        {((d.screen === "OPERATIONS" ? people?.opsOwners : people?.owners) ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    )}
                    {mode === "DISMISS" && (
                      <div className="flex flex-wrap gap-3 text-sm text-gray-300">
                        <label className="flex items-center gap-1.5"><input type="radio" checked={(form.kind ?? "FALSE_ALARM") === "FALSE_ALARM"} onChange={() => set("kind", "FALSE_ALARM")} /> False alarm</label>
                        <label className="flex items-center gap-1.5"><input type="radio" checked={form.kind === "ACCEPTED_RISK"} onChange={() => { set("kind", "ACCEPTED_RISK"); if (!form.until) set("until", plusDays(14)); }} /> Accepted risk until</label>
                        {form.kind === "ACCEPTED_RISK" && <input type="date" className={`${input} w-auto`} value={form.until ?? ""} onChange={(e) => set("until", e.target.value)} />}
                      </div>
                    )}
                    {mode === "VERIFY" && (
                      <div className="flex gap-3 text-sm text-gray-300">
                        <label className="flex items-center gap-1.5"><input type="radio" checked={(form.result ?? "EFFECTIVE") === "EFFECTIVE"} onChange={() => set("result", "EFFECTIVE")} /> It worked</label>
                        <label className="flex items-center gap-1.5"><input type="radio" checked={form.result === "NOT_EFFECTIVE"} onChange={() => set("result", "NOT_EFFECTIVE")} /> It didn&apos;t - reopen</label>
                      </div>
                    )}
                    {mode !== "ASK" && (
                      <textarea rows={2} className={input} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)}
                        placeholder={mode === "RESOLVE" ? "How it was resolved" : mode === "DISMISS" ? "Why it's being dismissed" : mode === "ASSIGN" ? "Note (optional)" : mode === "VERIFY" ? "Note (optional)" : "Comment"} />
                    )}
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={submit} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        {mode === "ASK" ? "Send question" : mode === "ASSIGN" ? "Set owner" : mode === "RESOLVE" ? "Resolve" : mode === "DISMISS" ? "Dismiss" : mode === "VERIFY" ? "Save" : "Add comment"}
                      </button>
                      <button onClick={() => { setMode(null); setForm({}); setError(null); }} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300">Cancel</button>
                    </div>
                  </div>
                )}
                {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              </div>
            )}

            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">History</div>
            <ol className="space-y-1.5 border-l border-edge pl-3 text-sm">
              {[...d.events].reverse().map((e, i) => (
                <li key={i}>
                  <div className="text-gray-200">{EVENT_LABEL[e.action] ?? e.action}{e.toValue && e.action !== "OPENED" ? ` - ${e.toValue}` : ""}</div>
                  {e.note && <div className="text-xs text-gray-400">{e.note}</div>}
                  <div className="text-[11px] text-gray-500">{e.by} · {whenText(e.at)}</div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
