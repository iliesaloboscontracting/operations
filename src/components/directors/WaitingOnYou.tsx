"use client";

// Directors -> "Waiting on you" (10 Nov 2026): the missing information only this director can give, grouped -
// questions, approvals, figures only the directors hold, decisions not made yet. Each item: what's missing, why it
// matters, how long it has waited, and one action that works right there - the existing answer card, the existing
// approve card, "Enter value" (a contract-value proposal the other director approves), "Send to Ilies" (office chat),
// or a Directors page. Never a link into Operations (DLink). `compact` (the overview): three per group, and the big
// answer / approve cards open on the page instead.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { whenText } from "@/lib/requestTypes";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/tracking/parts";
import { DLink } from "@/components/directors/parts";
import { QueryCard } from "@/components/queries/MyQueries";
import ChangeCard from "@/components/changes/ChangeCard";
import { waitingText } from "@/lib/directorsWaiting/rules";
import type { WaitingDTO } from "@/lib/directorsWaiting/store";

type Item = WaitingDTO["groups"][number]["items"][number];
const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40";
const anchor = (id: string) => `w-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;

export function useWaiting() {
  const [data, setData] = useState<WaitingDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/directors/waiting")
      .then(async (r) => (r.ok ? (setData(await r.json()), setError(null)) : setError(await serverErrorMessage(r, "Couldn't load what's waiting."))))
      .catch(() => setError("Couldn't load what's waiting."));
  }, []);
  useEffect(load, [load]);
  return { data, error, load };
}

export default function WaitingOnYou({ compact = false }: { compact?: boolean }) {
  const { data, error, load } = useWaiting();
  const [flash, setFlash] = useState<string | null>(null);
  const done = (m: string) => { setFlash(m); load(); };
  if (error) return compact ? null : <p className="py-6 text-center text-sm text-red-400">{error}</p>;
  if (!data) return compact ? null : <p className="py-6 text-center text-sm text-gray-500">Loading...</p>;
  const now = new Date(data.asAt);
  const groups = data.groups.filter((g) => g.items.length > 0);

  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-100">Waiting on you <span className="font-normal text-gray-500">· {data.total}</span></div>
        {compact && <Link href="/directors/waiting" className="text-xs text-brand-400 hover:underline">Open all</Link>}
      </div>
      <p className="mb-2 text-[11px] text-gray-500">Information only the directors can give. Office gaps (rates, tickets, rego, job numbers) stay with the office.</p>
      {flash && <p className="mb-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</p>}
      {data.total === 0 && <p className="mb-2 text-sm text-emerald-400">Nothing is waiting on you right now.</p>}
      <div className="space-y-4">
        {groups.map((g) => {
          const shown = compact ? g.items.slice(0, 3) : g.items;
          return (
            <div key={g.id}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{g.title} · {g.count}</div>
              <div className="space-y-2">
                {shown.map((i) => <Row key={i.id} i={i} now={now} compact={compact} canSend={data.canSendToIlies} onDone={done} onChange={load} />)}
              </div>
              {compact && g.items.length > shown.length && (
                <Link href="/directors/waiting" className="mt-1 inline-block text-xs text-brand-400 hover:underline">+{g.items.length - shown.length} more</Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Row({ i, now, compact, canSend, onDone, onChange }: { i: Item; now: Date; compact: boolean; canSend: boolean; onDone: (m: string) => void; onChange: () => void }) {
  const { user } = useAuth();
  const waited = waitingText(i.since, now);
  const head = (
    <div className="text-sm">
      <div className={i.counts ? "text-gray-100" : "text-gray-300"}>{i.what}</div>
      <div className="mt-0.5 text-[12px] text-gray-400">{i.why}</div>
      {waited && <div className="mt-0.5 text-[11px] text-gray-500">Waiting {waited}{i.sentAt ? ` · sent to Ilies ${whenText(i.sentAt)}` : ""}</div>}
    </div>
  );
  // The existing cards, in full on the page; on the overview they open there.
  if (i.action.type === "ANSWER" && i.query) {
    if (compact) return <Line id={i.id}>{head}<DLink href={`/directors/waiting#${anchor(i.id)}`} className={btn}>Answer</DLink></Line>;
    return <div id={anchor(i.id)} className="space-y-1"><p className="text-[12px] text-gray-400">{i.why}{waited ? ` · waiting ${waited}` : ""}</p><QueryCard q={i.query} onChange={onChange} /></div>;
  }
  if (i.action.type === "APPROVE" && i.change) {
    if (compact) return <Line id={i.id}>{head}<DLink href={`/directors/waiting#${anchor(i.id)}`} className={btn}>Review</DLink></Line>;
    return <div id={anchor(i.id)} className="space-y-1"><p className="text-[12px] text-gray-400">{i.why}{waited ? ` · waiting ${waited}` : ""}</p><ChangeCard c={i.change} me={user?.name ?? ""} onDone={onDone} /></div>;
  }
  return <Line id={i.id}>{head}<Action i={i} canSend={canSend} onDone={onDone} /></Line>;
}

function Line({ id, children }: { id: string; children: React.ReactNode }) {
  return <div id={anchor(id)} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-edge bg-panel p-3 [&>*:first-child]:min-w-0 [&>*:first-child]:flex-1">{children}</div>;
}

function Action({ i, canSend, onDone }: { i: Item; canSend: boolean; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [why, setWhy] = useState("");
  const a = i.action;

  async function post(url: string, body: unknown, ok: (d: { number?: number }) => string) {
    setBusy(true); setError(null);
    const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setError(res ? await serverErrorMessage(res, "Couldn't do that.") : "Couldn't reach the server.");
    setOpen(false); setValue(""); setWhy("");
    onDone(ok(await res.json().catch(() => ({}))));
  }

  if (a.type === "OPEN") return <DLink href={a.href} className={btn}>{a.label}</DLink>;
  if (a.type === "NONE") return <span className="max-w-xs text-right text-xs text-gray-500">{a.text}</span>;
  if (a.type === "SEND_TO_ILIES") {
    if (!canSend) return <span className="text-xs text-gray-500">Ask Ilies.</span>;
    return (
      <div className="text-right">
        <button disabled={busy} className={btn} onClick={() => post("/api/directors/waiting/ask", { key: a.key }, () => "Sent to Ilies in Messages.")}>{busy && <Loader2 size={14} className="animate-spin" />} Send to Ilies</button>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  }
  if (a.type === "ENTER_VALUE") {
    if (!open) return <button className={btn} onClick={() => setOpen(true)}>Enter value</button>;
    return (
      <div className="w-full space-y-2 sm:w-80">
        <input className={input} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Contract value, $ ex GST (e.g. 1,250,000)" aria-label="Contract value" />
        <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Where it's from (e.g. letter of award, 3 Nov)" aria-label="Where the value is from" />
        <div className="flex items-center gap-2">
          <button disabled={busy || !value.trim() || why.trim().length < 3} className={btn} onClick={() => post("/api/changes", {
            kind: "PROJECT_CONTRACT_VALUE", recordId: a.projectId, contractValue: value, reason: why.trim(), sources: [{ type: "Other", label: why.trim() }],
          }, (d) => `Proposed${d.number ? ` P-${String(d.number).padStart(4, "0")}` : ""} - nothing changes until the other director approves it.`)}>{busy && <Loader2 size={14} className="animate-spin" />} Propose</button>
          <button className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-400" onClick={() => setOpen(false)}>Cancel</button>
        </div>
        <p className="text-[11px] text-gray-500">The other director approves it before Tracking uses it - never the person who entered it.</p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
  return null;
}
