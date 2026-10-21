"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { PRIORITY_DOT, PRIORITY_LABEL, PRIORITY_TONE, byPriority, isOverdue, requestNo, whenText } from "@/lib/requestTypes";
import { printRequests } from "@/lib/requestPrint";
import type { TodoView } from "@/lib/siteRequests";

// The to-do list on an office person's link (Alex): the requests Ilies has
// approved and handed over - most urgent first. He marks each one done (with
// what was booked) or can't do (back to Ilies). He doesn't decide on requests.

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

  const open = (rows ?? []).filter((r) => r.status === "TODO").sort(byPriority);
  const done = (rows ?? []).filter((r) => r.status !== "TODO").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));

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

function Task({ api, r, onChange }: { api: string; r: TodoView; onChange: () => void }) {
  const [mode, setMode] = useState<"" | "DONE" | "CANT_DO">("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const late = isOverdue(r);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = mode === "DONE" ? { action: "DONE", outcome: text } : { action: "CANT_DO", reason: text };
      const res = await fetch(`${api}/todo/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save - try again."));
      onChange();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${PRIORITY_TONE[r.priority]}`}>{PRIORITY_DOT[r.priority]} {PRIORITY_LABEL[r.priority]}</span>
        <span className={`text-xs ${late ? "font-semibold text-red-400" : "text-gray-400"}`}>{late ? "Overdue - " : "Do by "}{whenText(r.neededBy)}</span>
      </div>
      <div className="text-base font-semibold text-gray-100">{r.summary}</div>
      <div className="text-sm text-gray-400">{r.site} · from {r.requestedBy} · {requestNo(r.number)}</div>
      {r.officeNote && <div className="mt-2 rounded-lg bg-brand-600/15 px-3 py-2 text-sm text-brand-100">Ilies: {r.officeNote}</div>}
      {r.note && <div className="mt-1 text-sm text-gray-400">Supervisor: “{r.note}”</div>}
      {r.answer && <div className="mt-1 text-sm text-gray-400">Answer: “{r.answer}”</div>}
      {r.hasPhoto && <button onClick={() => setShowPhoto((s) => !s)} className="mt-1 text-sm text-gray-300 underline">{showPhoto ? "Hide photo" : "Photo"}</button>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {showPhoto && <img src={`${api}/requests/${r.id}/photo`} alt="" className="mt-2 max-h-64 w-full rounded-lg object-cover" />}

      {!mode ? (
        <div className="mt-3 flex gap-2">
          <button onClick={() => setMode("DONE")} className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white">Done</button>
          <button onClick={() => setMode("CANT_DO")} className="flex-1 rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-300">Can&apos;t do</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            className={input}
            rows={2}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "DONE" ? "What was done - e.g. Booked Coates, arriving 7am, ref 4471" : "Why - it goes back to Ilies"}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${mode === "DONE" ? "bg-emerald-600" : "bg-amber-600"}`}>
              {mode === "DONE" ? "Mark done" : "Send back to Ilies"}
            </button>
            <button onClick={() => { setMode(""); setText(""); }} className="rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-400">Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
