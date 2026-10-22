"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { ON_TODO, PRIORITY_DOT, PRIORITY_LABEL, PRIORITY_TONE, byPriority, isOverdue, requestNo, whenText } from "@/lib/requestTypes";
import { printRequests } from "@/lib/requestPrint";
import type { TodoView } from "@/lib/siteRequests";

// The to-do list on an office person's link (Alex): the requests Ilies has
// approved and handed over - most urgent first. He says he's on it, posts
// updates, asks the supervisor a question, then marks it done (with what was
// booked) or can't do (back to Ilies). The supervisor sees each step. He
// doesn't decide on requests - no declining or re-assigning.

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";

export default function TodoList({ api }: { api: string }) {
  const [rows, setRows] = useState<TodoView[] | null>(null);
  const [person, setPerson] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${api}/todo`).catch(() => null);
    if (!res?.ok) return setError("Couldn't load - check your signal.");
    setError(null);
    const d = (await res.json()) as { person: string; todo: TodoView[] };
    setPerson(d.person);
    setRows(d.todo);
  }, [api]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const open = (rows ?? []).filter((r) => ON_TODO.includes(r.status)).sort(byPriority);
  const done = (rows ?? []).filter((r) => r.status === "DONE").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">My to-do</h1>
        <button
          onClick={() => printRequests(`To-do - ${person}`, open)}
          disabled={!open.length}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 disabled:opacity-40"
        >
          <Printer size={15} /> Print / PDF
        </button>
      </div>
      <p className="mb-4 text-sm text-gray-500">Requests the office has approved for you. Updates by itself.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!rows ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-500" /></div>
      ) : (
        <>
          {!open.length && <p className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-400">Nothing to do right now.</p>}
          <div className="space-y-3">
            {open.map((r) => <Task key={r.id} api={api} r={r} onChange={load} />)}
          </div>
          {!!done.length && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-400">Done - last 7 days</h2>
              <div className="space-y-2">
                {done.map((r) => (
                  <div key={r.id} className="rounded-xl border border-edge bg-panel p-3 text-sm opacity-70">
                    <div className="text-gray-200">{requestNo(r.number)} · {r.summary} · {r.site}</div>
                    {r.outcome && <div className="text-emerald-300">✓ {r.outcome}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

type Mode = "" | "UPDATE" | "ASK" | "DONE" | "CANT_DO";
const MODE: Record<Exclude<Mode, "">, { placeholder: string; button: string; tone: string; field: string }> = {
  UPDATE: { placeholder: "e.g. Called Coates - delivering 7am tomorrow", button: "Post update", tone: "bg-brand-600", field: "note" },
  ASK: { placeholder: "e.g. Which gate for the delivery?", button: "Ask the supervisor", tone: "bg-brand-600", field: "question" },
  DONE: { placeholder: "What was done - e.g. Booked Coates, arriving 7am, ref 4471", button: "Mark done", tone: "bg-emerald-600", field: "outcome" },
  CANT_DO: { placeholder: "Why - it goes back to Ilies", button: "Send back to Ilies", tone: "bg-amber-600", field: "reason" },
};
const STATE: Record<string, { label: string; tone: string }> = {
  TODO: { label: "New", tone: "bg-brand-600/25 text-brand-200" },
  ACTIONING: { label: "On it", tone: "bg-emerald-500/15 text-emerald-300" },
  NEEDS_INFO: { label: "Waiting on site", tone: "bg-amber-500/20 text-amber-300" },
};

function Task({ api, r, onChange }: { api: string; r: TodoView; onChange: () => void }) {
  const [mode, setMode] = useState<Mode>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const late = isOverdue(r);
  const waiting = r.status === "NEEDS_INFO";

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${api}/todo/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save - try again."));
      setMode("");
      setText("");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-200 active:bg-panel2";
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${PRIORITY_TONE[r.priority]}`}>{PRIORITY_DOT[r.priority]} {PRIORITY_LABEL[r.priority]}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATE[r.status]?.tone ?? ""}`}>{STATE[r.status]?.label ?? r.status}</span>
        </span>
        <span className={`text-xs ${late ? "font-semibold text-red-400" : "text-gray-400"}`}>{late ? "Overdue - " : "Do by "}{whenText(r.neededBy)}</span>
      </div>
      <div className="text-base font-semibold text-gray-100">{r.summary}</div>
      <div className="text-sm text-gray-400">{r.site} · from {r.requestedBy} · {requestNo(r.number)}</div>
      {r.officeNote && <div className="mt-2 rounded-lg bg-brand-600/15 px-3 py-2 text-sm text-brand-100">Ilies: {r.officeNote}</div>}
      {r.note && <div className="mt-1 text-sm text-gray-400">Supervisor: “{r.note}”</div>}
      {r.update && <div className="mt-1 text-sm text-gray-300">Your update ({whenText(r.update.at)}): “{r.update.note}”</div>}
      {waiting && r.question && (
        <div className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {r.askedByMe ? "You asked" : "The office asked"}: “{r.question}” - waiting on the supervisor
        </div>
      )}
      {!waiting && r.answer && <div className="mt-1 text-sm text-sky-300">Supervisor answered: “{r.answer}”</div>}
      {r.hasPhoto && <button onClick={() => setShowPhoto((x) => !x)} className="mt-1 text-sm text-gray-300 underline">{showPhoto ? "Hide photo" : "Photo"}</button>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {showPhoto && <img src={`${api}/requests/${r.id}/photo`} alt="" className="mt-2 max-h-64 w-full rounded-lg object-cover" />}

      {!mode ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {r.status === "TODO" ? (
            <button onClick={() => send({ action: "START" })} disabled={busy} className="col-span-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              I&apos;m on it
            </button>
          ) : null}
          <button onClick={() => setMode("UPDATE")} className={btn}>Add update</button>
          <button onClick={() => setMode("ASK")} disabled={waiting} className={`${btn} disabled:opacity-40`}>Ask supervisor</button>
          <button onClick={() => setMode("DONE")} className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white">Mark done</button>
          <button onClick={() => setMode("CANT_DO")} className={`${btn} text-amber-300`}>Can&apos;t do</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea className={input} rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={MODE[mode].placeholder} />
          <div className="flex gap-2">
            <button
              onClick={() => send({ action: mode, [MODE[mode].field]: text })}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${MODE[mode].tone}`}
            >
              {MODE[mode].button}
            </button>
            <button onClick={() => { setMode(""); setText(""); setError(null); }} className="rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-400">Back</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
