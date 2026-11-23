"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { MESSAGE_LIMITS, addDays, type OfficeMessage } from "@/lib/signinMessages/rules";

// Message at sign-in (Ilies, 23 Nov 2026) - on the Sign-ins page, for Managers, Admins and the coordinator. A short note
// to one person, several, or everyone who signs in; it shows on their phone after they sign in (and on their own site /
// driver link) until they tap "Got it" or its last day passes. No edits - archive it and send a new one.
type Person = { id: string; name: string };
type Data = { today: string; messages: OfficeMessage[]; people: Person[] };

const box = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const WHERE: Record<string, string> = { QR: "after sign-in", LINK: "on their link" };

export default function SigninMessagesPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const load = useCallback(async () => {
    const res = await apiFetch("/api/attendance/messages");
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't load the messages."));
    setError(null);
    setData(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="min-w-0" data-testid="signin-messages">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-200"><MessageSquare size={14} /> Message at sign-in</h2>
        {data && !writing && (
          <button className="rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2" onClick={() => setWriting(true)}>New message</button>
        )}
      </div>
      <p className="mb-2 text-xs text-gray-500">A short note that shows on their phone after they sign in (and on their own site or driver link) until they tap &quot;Got it&quot;. No amounts or bank / tax details.</p>
      {error && <div className="mb-2 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {data && writing && <Compose data={data} onCancel={() => setWriting(false)} onSent={() => { setWriting(false); load(); }} />}
      {data && (
        <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
          {data.messages.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No messages yet.</li>}
          {data.messages.map((m) => <Row key={m.id} m={m} onChanged={load} />)}
        </ul>
      )}
    </section>
  );
}

function Compose({ data, onCancel, onSent }: { data: Data; onCancel: () => void; onSent: () => void }) {
  const [text, setText] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [until, setUntil] = useState(addDays(data.today, MESSAGE_LIMITS.defaultDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return data.people.filter((p) => p.name.toLowerCase().includes(s) && !picked.some((x) => x.id === p.id)).slice(0, 8);
  }, [q, data.people, picked]);

  async function send() {
    setBusy(true);
    setError(null);
    const body = { text, audience: everyone ? "ALL" : "PEOPLE", resourceIds: everyone ? [] : picked.map((p) => p.id), showUntil: until };
    const res = await apiFetch("/api/attendance/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't send the message."));
    onSent();
  }

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-edge bg-panel p-3 text-xs">
      <textarea className={`${box} min-h-[70px]`} maxLength={MESSAGE_LIMITS.textMax} placeholder="e.g. Well done on your pre-starts this week" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="text-right text-gray-500">{text.trim().length}/{MESSAGE_LIMITS.textMax}</div>
      <div className="flex gap-3 text-gray-300">
        <label className="flex items-center gap-1.5"><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Pick people</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> Everyone who signs in</label>
      </div>
      {!everyone && (
        <div className="space-y-1.5">
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {picked.map((p) => (
                <span key={p.id} className="flex items-center gap-1 rounded-full bg-brand-600/20 px-2 py-0.5 text-brand-200">
                  {p.name}<button aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <input className={box} placeholder="Type a name (Labour register)" value={q} onChange={(e) => setQ(e.target.value)} />
          {found.map((p) => (
            <button key={p.id} className="block w-full rounded-md px-2 py-1 text-left text-gray-200 hover:bg-panel2" onClick={() => { setPicked([...picked, p]); setQ(""); }}>{p.name}</button>
          ))}
        </div>
      )}
      {everyone && <p className="text-gray-500">Everyone who signs in - staff and labour hire workers - sees it once.</p>}
      <label className="flex items-center gap-2 text-gray-300">
        Show until
        <input type="date" className="rounded-lg border border-edge bg-panel2 px-2 py-1 text-gray-200" min={data.today} max={addDays(data.today, MESSAGE_LIMITS.maxDays)} value={until} onChange={(e) => setUntil(e.target.value)} />
      </label>
      {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-red-300">{error}</div>}
      <div className="flex justify-end gap-2">
        <button className="px-2.5 py-1 text-gray-400" onClick={onCancel}>Cancel</button>
        <button className="rounded-lg bg-brand-600 px-3 py-1 font-semibold text-white disabled:opacity-50" disabled={busy || text.trim().length < MESSAGE_LIMITS.textMin || (!everyone && picked.length === 0)} onClick={send}>
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function Row({ m, onChanged }: { m: OfficeMessage; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = m.recipients.filter((r) => r.seenAt).length;
  async function archive() {
    const reason = window.prompt("Archive this message? It stops showing to crew; it's kept here. Reason (optional):", "");
    if (reason === null) return;
    const res = await apiFetch(`/api/attendance/messages/${encodeURIComponent(m.id)}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't archive it."));
    onChanged();
  }
  const tone = m.status === "LIVE" ? "bg-emerald-500/15 text-emerald-300" : "bg-panel2 text-gray-400";
  return (
    <li className="px-3 py-2 text-xs" data-testid="signin-message-row">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-sm text-gray-100">{m.text}</p>
          <div className="mt-0.5 text-gray-500">
            {m.by} · {when(m.at)} · {m.audience === "ALL" ? "Everyone" : `${m.recipients.length} ${m.recipients.length === 1 ? "person" : "people"}`} · until {day(m.showUntil)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 ${tone}`}>{m.statusLabel}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <button className="text-brand-300 underline" onClick={() => setOpen(!open)}>
          {m.audience === "ALL" ? `Seen by ${m.seenCount}` : `Seen ${seen} of ${m.recipients.length}`}
        </button>
        {m.status !== "ARCHIVED" && <button className="text-gray-500 hover:text-red-400" onClick={archive}>Archive</button>}
      </div>
      {m.archived && <div className="mt-1 text-gray-500">Archived by {m.archived.by ?? "the office"} {when(m.archived.at)}{m.archived.reason ? ` - ${m.archived.reason}` : ""}</div>}
      {error && <div className="mt-1 text-red-300">{error}</div>}
      {open && (
        <ul className="mt-1 space-y-0.5">
          {m.recipients.length === 0 && <li className="text-gray-500">Nobody yet.</li>}
          {m.recipients.map((r, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-gray-300">{r.name}</span>
              <span className={r.seenAt ? "text-emerald-300" : "text-amber-300"}>{r.seenAt ? `Seen ${when(r.seenAt)}${r.where ? ` (${WHERE[r.where] ?? r.where})` : ""}` : "Not seen yet"}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
