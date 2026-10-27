"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

// One conversation (docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3) - the Office room or a one-to-one
// (`base` = /api/messages/<id>). Messages are never edited or deleted: "Correct" sends a new message marked as a
// correction, and the old one shows as corrected. Opening the thread marks it seen. In the room, "Seen by N".
export type ThreadDTO = {
  id: string; room: boolean; title: string; subjectLabel: string; moneyAllowed: boolean; other: { name: string } | null;
  messages: { id: string; mine: boolean; by: string; text: string; at: string; correctsId: string | null; corrected: boolean; seen: boolean | null; seenAt: string | null; seenBy: string[] | null }[];
};

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const post = (url: string, body: unknown) => apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function Conversation({ base, onChanged, big = false }: { base: string; onChanged?: () => void; big?: boolean }) {
  const [t, setT] = useState<ThreadDTO | null>(null);
  const [text, setText] = useState("");
  const [correcting, setCorrecting] = useState<string | null>(null);
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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post(base, { body: text, correctsId: correcting }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't send it.") : "Couldn't send - check your signal.");
    setText(""); setCorrecting(null);
    await load();
    changed.current?.();
  }

  if (!t) return <p className="text-sm text-gray-500">{error ?? "Loading…"}</p>;
  const input = `w-full rounded-lg border border-edge bg-panel2 px-3 py-2 ${big ? "text-base" : "text-sm"} text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40`;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-semibold text-gray-100">{t.room ? `# ${t.title}` : t.title}</p>
        <p className="text-xs text-gray-500">{t.subjectLabel}{t.moneyAllowed || t.room ? "" : " · no amounts in this conversation"}</p>
      </div>
      <div className="flex flex-col gap-2">
        {t.messages.map((m) => {
          const fixes = m.correctsId ? t.messages.find((x) => x.id === m.correctsId) : null;
          return (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 ${m.mine ? "self-end bg-brand-900/50" : "self-start bg-panel2"}`}>
              {t.room && !m.mine && <p className="mb-0.5 text-[11px] font-semibold text-gray-300">{m.by}</p>}
              {fixes && <p className="mb-1 text-[11px] text-amber-300">Correction to {when(fixes.at)}</p>}
              <p className={`whitespace-pre-wrap ${big ? "text-base" : "text-sm"} ${m.corrected ? "text-gray-500 line-through" : "text-gray-100"}`}>{m.text}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
                {!m.mine && !t.room && <span>{m.by} ·</span>}
                <span>{when(m.at)}</span>
                {m.corrected && <span>· corrected below</span>}
                {m.mine && (m.seen
                  ? <span className="inline-flex items-center gap-0.5 text-sky-300" title={m.seenBy ? m.seenBy.join(", ") : m.seenAt ? `Seen ${when(m.seenAt)}` : "Seen"}><CheckCheck size={12} /> {m.seenBy ? `Seen by ${m.seenBy.length}` : "Seen"}</span>
                  : <span className="inline-flex items-center gap-0.5"><Check size={12} /> Sent</span>)}
                {m.mine && !m.corrected && <button type="button" onClick={() => { setCorrecting(m.id); setText(m.text); }} className="ml-1 underline">Correct</button>}
              </p>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex flex-col gap-2">
        {correcting && <p className="text-xs text-amber-300">Sending a correction - the original stays, marked as corrected. <button type="button" className="underline" onClick={() => { setCorrecting(null); setText(""); }}>Cancel</button></p>}
        <textarea className={input} rows={big ? 3 : 2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.moneyAllowed ? "Write a message" : "Write a message (no amounts)"} />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button disabled={busy || !text.trim()} className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 ${big ? "py-3 text-base" : "py-2 text-sm"} font-semibold text-white disabled:opacity-50`}>
          {busy && <Loader2 size={16} className="animate-spin" />} {correcting ? "Send correction" : "Send"}
        </button>
        <p className="text-[11px] text-gray-600">Messages are kept as a record and can&apos;t be edited or deleted.</p>
      </form>
    </div>
  );
}
