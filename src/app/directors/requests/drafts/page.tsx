"use client";

// Directors -> Information requests -> Draft questions (Task I, 25 Oct 2026).
// Questions drafted for Ilies (e.g. by the lead builder, from a draft file)
// wait here; nothing is sent until he ticks them and presses Send. Each shows
// who it's for - or "can't send" when the name doesn't match exactly one
// login. Owner only. Discarded drafts are kept, not deleted.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { isOwner } from "@/lib/owner";

type Draft = { id: string; batch: string; toText: string; toName: string | null; assigneeUserId: string | null; infoType: string; title: string; question: string; need: string | null; why: string | null; dueDate: string | null; whyNot: string | null };

export default function DraftQuestionsPage() {
  const { user, loading } = useAuth();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const owner = isOwner(user?.email);

  const load = useCallback(() => {
    apiFetch("/api/info-requests/drafts").then(async (r) => {
      if (!r.ok) return setMsg({ ok: false, text: await serverErrorMessage(r, "Couldn't load the drafts.") });
      const d = (await r.json()).drafts as Draft[];
      setDrafts(d);
      setPicked(new Set(d.filter((x) => x.assigneeUserId).map((x) => x.id))); // sendable ones ticked to start
    });
  }, []);
  useEffect(() => { if (!loading && owner) load(); }, [loading, owner, load]);
  useEffect(() => {
    if (!loading && owner) apiFetch("/api/info-requests").then(async (r) => r.ok && setPeople((await r.json()).people));
  }, [loading, owner]);

  if (loading) return null;
  if (!owner) return <PageShell title="Draft questions"><div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only Iliesa reviews and sends draft questions.</div></PageShell>;

  async function send() {
    setBusy(true); setMsg(null);
    try {
      const res = await apiFetch("/api/info-requests/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [...picked].map((draftId) => ({ draftId })) }) });
      const r = await res.json();
      if (!res.ok) throw new Error([r.error, ...(r.problems ?? []).map((p: { error: string }) => p.error)].filter(Boolean).join(" "));
      const sent = (r.results as { title: string; ref?: string; error?: string }[]);
      setMsg({ ok: true, text: `Sent ${sent.filter((x) => x.ref).length} question${sent.length === 1 ? "" : "s"}.`, list: sent.map((x) => (x.ref ? `${x.ref} · ${x.title}` : `Not sent: ${x.title} - ${x.error}`)) });
      load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function discard(id: string) {
    const res = await apiFetch(`/api/info-requests/drafts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "DISCARD" }) });
    if (!res.ok) setMsg({ ok: false, text: await serverErrorMessage(res, "Couldn't discard it.") });
    load();
  }
  async function assign(id: string, toUserId: string) {
    if (!toUserId) return;
    const res = await apiFetch(`/api/info-requests/drafts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ASSIGN", toUserId }) });
    if (!res.ok) setMsg({ ok: false, text: await serverErrorMessage(res, "Couldn't set who it's for.") });
    load();
  }
  async function loadFile(f: File | undefined) {
    if (!f) return;
    setMsg(null);
    try {
      const json = JSON.parse(await f.text());
      const res = await apiFetch("/api/info-requests/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error ?? "Couldn't read that file.");
      const bad = (r.rows as { to: string; error?: string; resolvedTo?: string | null; whyNot?: string | null }[]).filter((x) => x.error || !x.resolvedTo);
      setMsg({ ok: !bad.length, text: `Loaded "${r.batch}": ${r.rows.length} draft${r.rows.length === 1 ? "" : "s"}${bad.length ? ` - ${bad.length} need fixing` : ""}.`, list: bad.map((x) => `${x.to || "(no name)"}: ${x.error ?? x.whyNot ?? "doesn't match one login"}`) });
      load();
    } catch (e) { setMsg({ ok: false, text: e instanceof SyntaxError ? "That isn't a draft file (JSON)." : (e as Error).message }); }
    finally { if (file.current) file.current.value = ""; }
  }

  const batches = [...new Set((drafts ?? []).map((d) => d.batch))];
  return (
    <PageShell title="Draft questions" subtitle="Nothing is sent until you tick it and press Send. Answers never change data by themselves.">
      <Link href="/directors/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"><ArrowLeft size={14} /> Information requests</Link>
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy || picked.size === 0} onClick={send} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 size={14} className="animate-spin" />} Send {picked.size} ticked
          </button>
          <button onClick={() => file.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2"><Upload size={14} /> Load a draft file</button>
          <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
        </div>
        {msg && (
          <div className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
            {msg.text}
            {msg.list && msg.list.length > 0 && <ul className="mt-1 list-disc pl-5 text-[13px]">{msg.list.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </div>
        )}
        {!drafts ? <p className="text-sm text-gray-500">Loading...</p> : !drafts.length ? <p className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-gray-500">No draft questions waiting.</p> : batches.map((b) => (
          <section key={b}>
            <h2 className="mb-2 text-sm font-semibold text-gray-300">{b}</h2>
            <ul className="space-y-2">
              {drafts.filter((d) => d.batch === b).map((d) => (
                <li key={d.id} className={`rounded-xl border bg-panel p-3 ${d.assigneeUserId ? "border-edge" : "border-red-500/40"}`}>
                  <label className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4" disabled={!d.assigneeUserId} checked={picked.has(d.id)}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-100">{d.title} <span className="text-[12px] font-normal text-gray-500">· {d.infoType === "FYI" ? "FYI" : "Question"} · to {d.toName ?? d.toText}</span></div>
                      {!d.assigneeUserId && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-red-300">
                          Can&apos;t send yet: {d.whyNot ?? "choose who it's for."}
                          <select defaultValue="" onChange={(e) => assign(d.id, e.target.value)} className="rounded border border-edge bg-panel2 px-2 py-1 text-[12px] text-gray-200" aria-label={`Who ${d.title} is for`}>
                            <option value="">Choose who it&apos;s for…</option>
                            {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind})</option>)}
                          </select>
                        </div>
                      )}
                      <p className="mt-1 whitespace-pre-line text-sm text-gray-300">{d.question}</p>
                      {d.need && <p className="text-sm text-gray-400"><span className="text-gray-500">What we need:</span> {d.need}</p>}
                      {d.why && <p className="text-[12px] text-gray-500">Why: {d.why}</p>}
                    </div>
                  </label>
                  <div className="mt-1 text-right"><button onClick={() => discard(d.id)} className="text-[12px] text-gray-500 hover:text-red-300">Don&apos;t send</button></div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
