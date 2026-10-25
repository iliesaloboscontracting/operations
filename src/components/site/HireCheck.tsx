"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { whenText } from "@/lib/requestTypes";
import type { HireAnswer, SiteHireItem } from "@/lib/hireCheck";

// "Hire on my site" on a supervisor's link (24 Oct 2026): the hire-register
// items on their sites, each with three answers. Anything the office has to
// act on (call it off, register wrong, move the off-hire date) goes to them
// as a request, so it shows under "My requests" too.

const ANSWER_TEXT: Record<HireAnswer, string> = { STILL_NEEDED: "Still needed", FINISHED: "Finished", NOT_ON_SITE: "Not on site" };
const day = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });

function due(i: SiteHireItem) {
  if (i.daysLeft == null || !i.offHireDate) return { text: "No finish date", tone: "text-gray-500" };
  if (i.daysLeft < 0) return { text: `Was due back ${day(i.offHireDate)}`, tone: "text-red-300" };
  if (i.daysLeft === 0) return { text: "Due back today", tone: "text-amber-300" };
  if (i.daysLeft <= 3) return { text: `Due back ${day(i.offHireDate)}`, tone: "text-amber-300" };
  return { text: `Until ${day(i.offHireDate)}`, tone: "text-gray-500" };
}

export default function HireCheck({ api, onChange }: { api: string; onChange: () => void }) {
  const [items, setItems] = useState<SiteHireItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${api}/hire`).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load.") : "Couldn't load - check your signal.");
    setError(null);
    setItems(((await res.json()) as { items: SiteHireItem[] }).items);
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const answer = async (itemId: string, a: HireAnswer, note: string, neededUntil?: string) => {
    setError(null);
    const res = await fetch(`${api}/hire`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, answer: a, note, ...(neededUntil ? { neededUntil } : {}) }) }).catch(() => null);
    if (!res?.ok) {
      setError(res ? await serverErrorMessage(res, "Couldn't send it - try again.") : "Couldn't send it - check your signal.");
      return false;
    }
    const d = (await res.json()) as { message: string; items: SiteHireItem[] };
    setFlash(d.message);
    setItems(d.items);
    onChange();
    return true;
  };

  const toCheck = (items ?? []).filter((i) => i.askNow);
  const rest = (items ?? []).filter((i) => !i.askNow);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-gray-100">Hire on my site</h1>
      <p className="mb-4 text-sm text-gray-500">What the office has on hire for your sites. Tell us when it&apos;s finished so we stop paying for it.</p>
      {flash && <div className="mb-3 rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!items ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-500" /></div>
      ) : !items.length ? (
        <p className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-400">Nothing on hire for your sites.</p>
      ) : (
        <>
          {!!toCheck.length && <h2 className="mb-2 text-sm font-semibold text-amber-300">To check ({toCheck.length})</h2>}
          <div className="space-y-3">
            {toCheck.map((i) => <Item key={i.id} i={i} ask onAnswer={answer} />)}
          </div>
          {!!rest.length && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-400">Checked / called off</h2>
              <div className="space-y-2">
                {rest.map((i) => <Item key={i.id} i={i} ask={false} onAnswer={answer} />)}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Item({ i, ask, onAnswer }: { i: SiteHireItem; ask: boolean; onAnswer: (id: string, a: HireAnswer, note: string, neededUntil?: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(ask);
  const [pending, setPending] = useState<HireAnswer | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const d = due(i);
  // Past its expected finish: "Still needed" asks until about when (optional) - the office approves the new date.
  const pastFinish = i.daysLeft != null && i.daysLeft <= 0;

  const send = async (a: HireAnswer) => {
    setBusy(true);
    const ok = await onAnswer(i.id, a, note, a === "STILL_NEEDED" && until ? until : undefined);
    setBusy(false);
    if (ok) {
      setPending(null);
      setNote("");
      setUntil("");
    }
  };

  return (
    <div className={`rounded-xl border bg-panel p-3 ${ask ? "border-amber-500/50" : "border-edge"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-gray-100">{i.name}</div>
          <div className="text-xs text-gray-500">{[i.supplier, i.ref && `#${i.ref}`, i.site].filter(Boolean).join(" · ")}</div>
          <div className={`text-sm ${d.tone}`}>{d.text}</div>
        </div>
        {!ask && !i.offHireAsked && (
          <button onClick={() => setOpen((o) => !o)} className="shrink-0 rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-300">
            {open ? "Close" : "Update"}
          </button>
        )}
      </div>
      {i.offHireAsked ? (
        <div className="mt-1 text-sm text-emerald-300">Off-hire requested - the office is calling it off.</div>
      ) : i.last ? (
        <div className="mt-1 text-xs text-gray-500">Last: {ANSWER_TEXT[i.last.answer]} - {i.last.by}, {whenText(i.last.at)}</div>
      ) : null}
      {open && !i.offHireAsked && (
        pending === "STILL_NEEDED" ? (
          <div className="mt-3 space-y-2">
            <label className="block text-sm text-gray-200">
              Until about when? <span className="text-gray-500">(optional)</span>
              <input type="date" className="mt-1 w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-base text-gray-200" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => send("STILL_NEEDED")} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Sending..." : until ? "Send" : "Send without a date"}
              </button>
              <button disabled={busy} onClick={() => { setPending(null); setUntil(""); }} className="rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-300">Back</button>
            </div>
          </div>
        ) : pending ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-gray-200">
              {pending === "FINISHED" ? "Ask the office to call it off?" : "Tell the office it isn't on site?"}
            </p>
            <input
              className="w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-base text-gray-200 placeholder:text-gray-500"
              placeholder={pending === "FINISHED" ? "Note - e.g. ready for pick-up at the gate" : "Note - e.g. never arrived, went back last week"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => send(pending)} className="flex-1 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Sending..." : pending === "FINISHED" ? "Yes - call it off" : "Yes - flag it"}
              </button>
              <button disabled={busy} onClick={() => setPending(null)} className="rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-300">Back</button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button disabled={busy} onClick={() => (pastFinish ? setPending("STILL_NEEDED") : send("STILL_NEEDED"))} className="rounded-lg bg-emerald-600/80 px-2 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              Still needed
            </button>
            <button disabled={busy} onClick={() => setPending("FINISHED")} className="rounded-lg bg-amber-500 px-2 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
              Finished
            </button>
            <button disabled={busy} onClick={() => setPending("NOT_ON_SITE")} className="rounded-lg border border-edge px-2 py-2.5 text-sm text-gray-200 disabled:opacity-50">
              Not on site
            </button>
          </div>
        )
      )}
    </div>
  );
}
