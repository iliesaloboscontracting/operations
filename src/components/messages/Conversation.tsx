"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

// One conversation (docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3) - the Office room or a one-to-one
// (`base` = /api/messages/<id>). The sender can edit or delete their own message, no approval (Ilies 27 Oct): an edit
// shows "edited" (tap it for the earlier versions); a deleted message shows "message deleted" for everyone - only
// the owner can still read what it said. Opening the thread marks it seen. In the room, "Seen by N".
type Version = { kind: string; text: string; at: string };
export type ThreadDTO = {
  id: string; room: boolean; title: string; subjectLabel: string; other: { name: string } | null;
  messages: {
    id: string; mine: boolean; by: string; text: string | null; at: string; edited: boolean; editedAt: string | null; deleted: boolean; deletedAt: string | null;
    history: Version[]; canChange: boolean; seen: boolean | null; seenAt: string | null; seenBy: string[] | null;
  }[];
};

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const post = (url: string, body: unknown) => apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function Conversation({ base, onChanged, big = false }: { base: string; onChanged?: () => void; big?: boolean }) {
  const [t, setT] = useState<ThreadDTO | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(async () => {
    const res = await apiFetch(base).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load it.") : "Couldn't load - check your signal.");
    setError(null);
    setT(await res.json());
  }, [base]);
  useEffect(() => {
    load().then(() => post(base, { action: "SEEN" }).then(() => changed.current?.()).catch(() => undefined));
    const iv = setInterval(load, 20_000);
    return () => clearInterval(iv);
  }, [base, load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [t?.messages.length]);

  async function act(body: Record<string, unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    const res = await post(base, body).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setError(res ? await serverErrorMessage(res, fallback) : `${fallback} Check your signal.`); return false; }
    await load();
    changed.current?.();
    return true;
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const done = editing ? await act({ action: "EDIT", messageId: editing, body: text }, "Couldn't save the change.") : await act({ body: text }, "Couldn't send it.");
    if (done) { setText(""); setEditing(null); }
  }
  function remove(id: string) {
    if (window.confirm("Delete this message? Everyone will see \"message deleted\".")) act({ action: "DELETE", messageId: id }, "Couldn't delete it.");
  }

  if (!t) return <p className="text-sm text-gray-500">{error ?? "Loading…"}</p>;
  const input = `w-full rounded-lg border border-edge bg-panel2 px-3 py-2 ${big ? "text-base" : "text-sm"} text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40`;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-semibold text-gray-100">{t.room ? `# ${t.title}` : t.title}</p>
        <p className="text-xs text-gray-500">{t.subjectLabel}</p>
      </div>
      <div className="flex flex-col gap-2">
        {t.messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 ${m.mine ? "self-end bg-brand-900/50" : "self-start bg-panel2"}`}>
            {t.room && !m.mine && <p className="mb-0.5 text-[11px] font-semibold text-gray-300">{m.by}</p>}
            {m.deleted
              ? <p className={`italic text-gray-500 ${big ? "text-base" : "text-sm"}`}>message deleted</p>
              : <p className={`whitespace-pre-wrap text-gray-100 ${big ? "text-base" : "text-sm"}`}>{m.text}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
              {!m.mine && !t.room && <span>{m.by} ·</span>}
              <span>{when(m.at)}</span>
              {(m.edited || (m.deleted && m.history.length > 0)) && (
                <button type="button" onClick={() => setShowHistory(showHistory === m.id ? null : m.id)} className="underline" title={m.editedAt ? `Edited ${when(m.editedAt)}` : undefined}>
                  · {m.deleted ? "history (owner only)" : "edited"}
                </button>
              )}
              {m.mine && !m.deleted && (m.seen
                ? <span className="inline-flex items-center gap-0.5 text-sky-300" title={m.seenBy ? m.seenBy.join(", ") : m.seenAt ? `Seen ${when(m.seenAt)}` : "Seen"}><CheckCheck size={12} /> {m.seenBy ? `Seen by ${m.seenBy.length}` : "Seen"}</span>
                : <span className="inline-flex items-center gap-0.5"><Check size={12} /> Sent</span>)}
              {m.canChange && (
                <>
                  <button type="button" disabled={busy} onClick={() => { setEditing(m.id); setText(m.text ?? ""); }} className="ml-1 underline">Edit</button>
                  <button type="button" disabled={busy} onClick={() => remove(m.id)} className="underline">Delete</button>
                </>
              )}
            </p>
            {showHistory === m.id && m.history.length > 0 && (
              <div className="mt-1 space-y-0.5 border-t border-edge/60 pt-1 text-[11px] text-gray-400">
                {m.history.map((v, i) => <p key={i}><span className="text-gray-500">{v.kind === "DELETE" ? "Deleted" : "Was"} ({when(v.at)}):</span> {v.text}</p>)}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex flex-col gap-2">
        {editing && <p className="text-xs text-amber-300">Editing your message - the earlier version is kept behind &quot;edited&quot;. <button type="button" className="underline" onClick={() => { setEditing(null); setText(""); }}>Cancel</button></p>}
        <textarea className={input} rows={big ? 3 : 2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button disabled={busy || !text.trim()} className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 ${big ? "py-3 text-base" : "py-2 text-sm"} font-semibold text-white disabled:opacity-50`}>
          {busy && <Loader2 size={16} className="animate-spin" />} {editing ? "Save change" : "Send"}
        </button>
        <p className="text-[11px] text-gray-600">You can edit or delete your own messages. Every earlier version is kept on record.</p>
      </form>
    </div>
  );
}
