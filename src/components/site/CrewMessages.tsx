"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, MessageSquare } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { deviceId } from "@/lib/signinDevice";

// Message at sign-in (23 Nov 2026): the office's notes for this person - after a QR sign-in (the sign-in's own token)
// or on their own SUPERVISOR / DRIVER link home. Each one: the words, the day, and "Got it" (seen once overall). Shown
// as plain text - React escapes it; it is never treated as markup or instructions. A failure to load shows nothing:
// the sign-in has already gone through.
type Msg = { id: string; text: string; sent: string };
type Source = { token: string } | { api: string };

export default function CrewMessages({ source, className = "" }: { source: Source; className?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = "token" in source ? source.token : source.api;

  useEffect(() => {
    let off = false;
    const url = "token" in source ? "/api/site/in/messages" : `${source.api}/messages`;
    const headers: Record<string, string> = "token" in source ? { "x-message-token": source.token } : {};
    fetch(url, { headers })
      .then(async (r) => (r.ok ? ((await r.json()).messages as Msg[]) : []))
      .then((m) => { if (!off) setMessages(Array.isArray(m) ? m : []); })
      .catch(() => {});
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function gotIt(id: string) {
    setBusy(id);
    setError(null);
    try {
      const url = "token" in source ? "/api/site/in/messages" : `${source.api}/messages`;
      const body = { ...("token" in source ? { token: source.token } : {}), messageId: id, deviceId: deviceId() };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok && res.status !== 404) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      setMessages((m) => m.filter((x) => x.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!messages.length) return null;
  return (
    <div className={`space-y-2 text-left ${className}`} data-testid="crew-messages">
      {messages.map((m) => (
        <div key={m.id} className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-300">
            <MessageSquare size={14} /> Message from the office · {m.sent}
          </div>
          <p className="whitespace-pre-wrap break-words text-base text-gray-100">{m.text}</p>
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
            disabled={busy === m.id}
            onClick={() => gotIt(m.id)}
          >
            {busy === m.id ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />} Got it
          </button>
        </div>
      ))}
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
    </div>
  );
}
