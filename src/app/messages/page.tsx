"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import Conversation from "@/components/messages/Conversation";
import ThreadList, { type ThreadRow } from "@/components/messages/ThreadList";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { isOwner } from "@/lib/owner";
import { BANK_NOTICE, CHAT_NOTICE } from "@/lib/messages/notices";

// Messages - office chat (27 Oct 2026, Ilies: "a internal chat room between office personnel";
// docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3): the shared "Office" room for every office login, and one-to-one
// conversations between any two office logins - only those two read them. Amounts are fine (Ilies 27 Oct). The sender
// edits or deletes their own message; every earlier text is kept. No site-link side. ?t=<id> opens a conversation
// (from a phone alert); ?new=1&type=&key=&label= starts one about a record.
type Person = { id: string; name: string; role: string | null };
const ROLE: Record<string, string> = { ACCOUNTS: "Accounts", DIRECTOR: "Director", ADMIN: "Admin", MANAGER: "Manager" };

function NewMessage({ subject, onDone, onCancel }: { subject: { type: string; key: string; label: string } | null; onDone: (id: string) => void; onCancel: () => void }) {
  const [dir, setDir] = useState<{ users: Person[] } | null>(null);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch("/api/messages/directory").then((r) => (r.ok ? r.json() : null)).then((d) => d && setDir(d)); }, []);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: to, body, ...(subject ? { subjectType: subject.type, subjectKey: subject.key } : {}) }),
    });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't send it."));
    onDone((await res.json()).id);
  }
  const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
  return (
    <form onSubmit={send} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <p className="text-sm font-semibold text-gray-100">New message{subject ? <span className="font-normal text-gray-400"> about {subject.label}</span> : null}</p>
      {/* Who to - buttons, not a <select> (28 Oct 2026): the browser draws a dropdown's open list itself, and on Ilies's
          Windows browser the names came out invisible even with the option colours set. */}
      <div role="radiogroup" aria-label="To" className="space-y-1.5">
        <p className="text-xs text-gray-400">To</p>
        {!dir ? (
          <p className="text-xs text-gray-500">Loading people…</p>
        ) : dir.users.length === 0 ? (
          <p className="text-xs text-gray-500">There's no one else to message yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {dir.users.map((u) => (
              <button key={u.id} type="button" role="radio" aria-checked={to === u.id} onClick={() => setTo(u.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${to === u.id ? "border-brand-500 bg-brand-600 text-white" : "border-edge bg-panel2 text-gray-200 hover:border-brand-500/60"}`}>
                {u.name} <span className={to === u.id ? "text-white/80" : "text-gray-400"}>({ROLE[u.role ?? ""] ?? u.role})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <textarea className={input} rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" />
      <p className="text-xs text-gray-500">Only the two of you will see this conversation. For everyone at once, use the Office room.</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy || !to || !body.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Cancel</button>
      </div>
    </form>
  );
}

export default function MessagesPage() {
  return <Suspense fallback={null}><Messages /></Suspense>;
}

function Messages() {
  const { user, loading } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const [rows, setRows] = useState<ThreadRow[] | null>(null);
  // D-Q11 (Ilies 27 Oct): the owner can switch to "All conversations" - every one-to-one, read-only.
  const owner = isOwner(user?.email);
  const [all, setAll] = useState(false);
  const open = params.get("t");
  const subject = params.get("new") && params.get("type") && params.get("key") ? { type: params.get("type")!, key: params.get("key")!, label: params.get("label") ?? "this record" } : null;
  const [composing, setComposing] = useState(!!params.get("new"));
  const load = useCallback(() => apiFetch(all ? "/api/messages?all=1" : "/api/messages").then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.threads)), [all]);
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);
  const changed = useCallback(() => { load(); window.dispatchEvent(new Event("messages-changed")); }, [load]);

  if (!loading && (!user || !["ACCOUNTS", "DIRECTOR", "ADMIN", "MANAGER"].includes(user.role))) return <PageShell title="Messages"><p className="text-sm text-gray-400">Messages are for accounts, directors and the office.</p></PageShell>;
  return (
    <PageShell title="Messages" subtitle="The Office room is for everyone in the office; a one-to-one is only for its two people. You can edit or delete your own messages - earlier versions are kept on record."
      actions={<button onClick={() => { setComposing(true); router.replace("/messages"); }} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"><Plus size={12} /> New message</button>}>
      <div className="mb-3 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
        <p>{CHAT_NOTICE}</p>
        <p>{BANK_NOTICE}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="min-w-0">
          {owner && (
            <div className="mb-2 inline-flex rounded-lg border border-edge p-0.5 text-xs">
              {([[false, "My conversations"], [true, "All conversations"]] as const).map(([v, label]) => (
                <button key={label} onClick={() => { setAll(v); setRows(null); router.replace("/messages"); }} className={`rounded-md px-2.5 py-1 ${all === v ? "bg-panel2 text-gray-100" : "text-gray-400 hover:text-gray-200"}`}>{label}</button>
              ))}
            </div>
          )}
          {all && <p className="mb-2 text-xs text-gray-500">Every one-to-one in the office, read-only. Reading one doesn&apos;t mark it seen.</p>}
          {rows ? <ThreadList rows={rows} selected={open} onOpen={(id) => { setComposing(false); router.replace(`/messages?t=${id}`); }} /> : <p className="text-sm text-gray-500">Loading…</p>}</div>
        <div className="min-w-0">
          {composing ? (
            <NewMessage subject={subject} onCancel={() => { setComposing(false); router.replace("/messages"); }} onDone={(id) => { setComposing(false); load(); router.replace(`/messages?t=${id}`); }} />
          ) : open ? (
            <div className="rounded-xl border border-edge bg-panel p-4"><Conversation key={open} base={`/api/messages/${open}`} onChanged={changed} /></div>
          ) : (
            <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-500">Pick a conversation, or start a new message.</p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
