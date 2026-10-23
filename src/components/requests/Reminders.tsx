"use client";

import { useState } from "react";
import { AlarmClock, Lightbulb, Sparkles, X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { OPEN_STATUSES, requestNo, whenText } from "@/lib/requestTypes";
import type { OfficeRequestView } from "@/lib/siteRequests";

// Reminders on the Requests page (23 Oct 2026): the strip at the top (due,
// today, coming up, and non-urgent ones overdue with no reminder), and the
// reminder section inside a request - the AI's suggestion to accept or
// dismiss, the current reminder, and quick "remind me" picks.

const sydDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

export function RemindersStrip({ rows, onOpen }: { rows: OfficeRequestView[]; onOpen: (r: OfficeRequestView) => void }) {
  const now = Date.now();
  const today = sydDay(new Date());
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const withReminder = open.filter((r) => r.remindAt).sort((a, b) => a.remindAt!.localeCompare(b.remindAt!));
  const due = withReminder.filter((r) => new Date(r.remindAt!).getTime() <= now);
  const todayRows = withReminder.filter((r) => new Date(r.remindAt!).getTime() > now && sydDay(new Date(r.remindAt!)) === today);
  const later = withReminder.filter((r) => new Date(r.remindAt!).getTime() > now && sydDay(new Date(r.remindAt!)) !== today);
  // Safety net, no AI: non-urgent, past needed-by, and nothing set to bring it back.
  const forgotten = open.filter((r) => r.priority !== "URGENT" && !r.remindAt && new Date(r.neededBy).getTime() < now);
  const suggested = open.filter((r) => r.aiSuggestion);
  if (!due.length && !todayRows.length && !later.length && !forgotten.length && !suggested.length) return null;

  const row = (r: OfficeRequestView, when: string, tone: string) => (
    <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-panel2">
      <span className={`shrink-0 text-xs font-semibold ${tone}`}>{when}</span>
      <span className="min-w-0 truncate text-gray-200">{r.remindNote || r.summary}</span>
      <span className="ml-auto shrink-0 text-xs text-gray-500">{r.site} · {requestNo(r.number)}</span>
    </button>
  );
  const group = (title: string, items: React.ReactNode[], tone = "text-gray-400") =>
    items.length ? (
      <div>
        <div className={`px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider ${tone}`}>{title}</div>
        {items}
      </div>
    ) : null;

  return (
    <div className="mb-4 rounded-xl border border-edge bg-panel p-2">
      <div className="mb-1 flex items-center gap-1.5 px-2 text-sm font-semibold text-gray-100">
        <AlarmClock size={15} /> Reminders
      </div>
      <div className="grid gap-1 md:grid-cols-2">
        {group("Due now", due.map((r) => row(r, whenText(r.remindAt!), "text-red-400")), "text-red-400")}
        {group("Overdue - no reminder", forgotten.map((r) => row(r, `needed ${whenText(r.neededBy)}`, "text-amber-400")), "text-amber-400")}
        {group("Today", todayRows.map((r) => row(r, whenText(r.remindAt!), "text-brand-300")))}
        {group("Coming up", later.map((r) => row(r, whenText(r.remindAt!), "text-gray-400")))}
        {group("Suggested - tap to accept", suggested.map((r) => row(r, whenText(r.aiSuggestion!.remindAt), "text-sky-300")), "text-sky-300")}
      </div>
    </div>
  );
}

// Card line under a request.
export function ReminderLine({ r }: { r: OfficeRequestView }) {
  if (r.remindAt) {
    const due = new Date(r.remindAt).getTime() <= Date.now();
    return <div className={`mt-1 truncate text-xs ${due ? "font-semibold text-red-400" : "text-gray-400"}`}>⏰ {whenText(r.remindAt)}{r.remindNote ? ` - ${r.remindNote}` : ""}</div>;
  }
  if (r.aiSuggestion) return <div className="mt-1 truncate text-xs text-sky-300">💡 Suggested reminder {whenText(r.aiSuggestion.remindAt)}</div>;
  return null;
}

// Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">, from a Date.
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
function quickPicks(now = new Date()) {
  const at = (days: number, h: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const picks: { label: string; at: Date }[] = [];
  if (now.getHours() < 15) picks.push({ label: "3pm today", at: at(0, 15) });
  picks.push({ label: "Tomorrow 7am", at: at(1, 7) });
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  if (toMonday > 1) picks.push({ label: "Monday 6am", at: at(toMonday, 6) });
  return picks;
}

export function ReminderSection({ r, isAdmin, onSaved }: { r: OfficeRequestView; isAdmin: boolean; onSaved: (r: OfficeRequestView) => void }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(r.remindAt ? localInput(new Date(r.remindAt)) : "");
  const [note, setNote] = useState(r.remindNote ?? "");
  const [alsoNeededBy, setAlsoNeededBy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = r.aiSuggestion;
  const open = OPEN_STATUSES.includes(r.status);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/requests/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save."));
      onSaved((await res.json()).request);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open && !r.remindAt) return null;
  const input =
    "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";

  return (
    <div className="mb-4 space-y-2">
      {s && open && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-sky-200">
            <Lightbulb size={14} /> Suggested reminder: {whenText(s.remindAt)}
          </div>
          <div className="text-gray-200">{s.note}</div>
          {s.reason && <div className="mt-1 text-xs text-gray-400">{s.reason}</div>}
          {s.newNeededBy && (
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={alsoNeededBy} onChange={(e) => setAlsoNeededBy(e.target.checked)} disabled={!isAdmin} />
              Also change needed-by to <b>{whenText(s.newNeededBy)}</b> (now {whenText(r.neededBy)})
            </label>
          )}
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              <button disabled={busy} onClick={() => send({ action: "ACCEPT_SUGGESTION", alsoNeededBy })} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Accept
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setWhen(localInput(new Date(s.remindAt)));
                  setNote(s.note);
                  setEditing(true);
                }}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300"
              >
                Change time
              </button>
              <button disabled={busy} onClick={() => send({ action: "DISMISS_SUGGESTION" })} className="ml-auto rounded-lg px-2 py-1.5 text-sm text-gray-500" aria-label="Dismiss suggestion">
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      )}

      {r.remindAt && !editing && (
        <div className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-sm">
          <AlarmClock size={14} className={new Date(r.remindAt).getTime() <= Date.now() ? "text-red-400" : "text-gray-400"} />
          <span className="text-gray-200">
            {whenText(r.remindAt)}
            {r.remindNote ? <span className="text-gray-400"> - {r.remindNote}</span> : null}
          </span>
          {isAdmin && open && (
            <span className="ml-auto flex gap-2 text-xs">
              <button onClick={() => setEditing(true)} className="text-gray-300 underline">Change</button>
              <button disabled={busy} onClick={() => send({ action: "CLEAR_REMINDER" })} className="text-gray-500 underline">Clear</button>
            </span>
          )}
        </div>
      )}

      {isAdmin && open && !r.remindAt && !editing && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center gap-1 text-gray-400"><AlarmClock size={14} /> Remind me:</span>
          {quickPicks().map((p) => (
            <button key={p.label} disabled={busy} onClick={() => send({ action: "REMIND", remindAt: p.at.toISOString(), note: "" })} className="rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-200 hover:bg-panel2">
              {p.label}
            </button>
          ))}
          <button onClick={() => setEditing(true)} className="rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-200 hover:bg-panel2">Pick a time…</button>
          {!s && r.priority !== "URGENT" && (
            <button disabled={busy} onClick={() => send({ action: "SUGGEST" })} className="flex items-center gap-1 rounded-lg border border-sky-500/40 px-2.5 py-1 text-xs text-sky-200 hover:bg-sky-500/10">
              <Sparkles size={12} /> {busy ? "Reading…" : "Ask AI"}
            </button>
          )}
        </div>
      )}

      {isAdmin && editing && (
        <div className="space-y-2 rounded-lg border border-edge bg-panel2 p-3">
          <input type="datetime-local" className={input} value={when} onChange={(e) => setWhen(e.target.value)} />
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) - e.g. book Benny for Monday" maxLength={120} />
          <div className="flex gap-2">
            <button disabled={busy || !when} onClick={() => send({ action: "REMIND", remindAt: new Date(when).toISOString(), note })} className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Set reminder
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-400">Back</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
