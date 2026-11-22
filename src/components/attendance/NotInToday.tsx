"use client";

// "Not in today" on the Sign-ins page (23 Nov 2026, Ilies: "a button that can let the system know that someone is off
// sick today or not in"; "alex can too"). The people allocated and not signed in, each with:
//   - "No sign-in anywhere" (orange) until someone explains it, or a grey "Sick" / "Not in" tag once marked
//     (amber "Marked Sick but signed in" when they signed in anyway - the sign-in still counts);
//   - "Add missed sign-in" (Managers / Admins, as before) and "Not in today" (Managers, Admins, the coordinator);
//   - the tag opens the detail: the note, who marked it and when, earlier marks that were undone, and Undo (a reason).
// Information only: a mark never adds hours, pay or cost. Names and words only - never a dollar figure.
import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { ABSENCE_LABEL, ABSENCE_LIMITS, markedButSignedIn, markedButSignedInText, markWords, type AbsenceReason, type AbsenceView } from "@/lib/absence/rules";
import type { NoShow } from "./types";

const inp = "rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200";
const btn = "rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const small = "rounded-md border border-edge px-1.5 py-0.5 text-[10px] hover:bg-panel2";
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// The grey "Sick" / "Not in" tag (amber when they signed in anyway). A button: tap or hover for the detail.
export function AbsenceTag({ view, onClick, open }: { view: AbsenceView; onClick?: () => void; open?: boolean }) {
  const a = view.active;
  if (!a) return null;
  const warn = markedButSignedIn(view);
  const title = [markWords(a, when), warn ? `${markedButSignedInText(a.label)} - the sign-in's hours stand; check the mark.` : null, view.cancelled.length ? `${view.cancelled.length} earlier mark${view.cancelled.length === 1 ? "" : "s"} undone` : null].filter(Boolean).join("\n");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={title}
      data-testid="absence-tag"
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${warn ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40" : "bg-gray-600/40 text-gray-200"}`}
    >
      {warn ? markedButSignedInText(a.label) : a.label}
    </button>
  );
}

type Open = { id: string; mode: "mark" | "detail" } | null;

// The chips for a card's "Allocated, not signed in" list (or the office's "Not signed in", or the day's other marks).
export function NoShowList({
  noShows, date, canEdit, canMark, onAddMissed, onChanged,
}: {
  noShows: NoShow[];
  date: string;
  canEdit: boolean; // Managers / Admins: "Add missed sign-in"
  canMark: boolean; // Managers / Admins / the coordinator: "Not in today" and Undo
  onAddMissed?: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string, mode: "mark" | "detail") => { setError(null); setOpen(open?.id === id && open.mode === mode ? null : { id, mode }); };
  const person = open ? noShows.find((n) => n.id === open.id) ?? null : null;

  async function post(url: string, body: unknown) {
    setError(null);
    const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setError(await serverErrorMessage(res, "Couldn't save.")); return false; }
    setOpen(null);
    onChanged();
    return true;
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {noShows.map((p) => {
          const marked = !!p.absence?.active;
          return (
            <span key={p.id} className={`flex flex-wrap items-center gap-1.5 rounded-lg border bg-panel px-2 py-1 text-gray-200 ${marked ? "border-edge" : "border-amber-500/40"}`} data-testid="no-show">
              <span className={marked ? "text-gray-400" : undefined}>{p.name}</span>
              {marked ? (
                <AbsenceTag view={p.absence!} open={open?.id === p.id && open.mode === "detail"} onClick={() => toggle(p.id, "detail")} />
              ) : (
                <>
                  {p.nowhere && <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300">No sign-in anywhere</span>}
                  {p.staff && !p.nowhere && <span className="text-[10px] text-gray-400">signed in elsewhere</span>}
                  {!!p.absence?.cancelled.length && (
                    <button type="button" className="text-[10px] text-gray-500 underline" onClick={() => toggle(p.id, "detail")}>
                      {p.absence.cancelled.length} mark undone
                    </button>
                  )}
                </>
              )}
              {canEdit && p.staff && !marked && onAddMissed && (
                <button className={`${small} text-brand-300`} onClick={() => onAddMissed(p.id)}>Add missed sign-in</button>
              )}
              {canMark && !marked && (
                <button className={`${small} text-gray-200`} onClick={() => toggle(p.id, "mark")} aria-expanded={open?.id === p.id && open.mode === "mark"} data-testid="not-in-today">
                  Not in today
                </button>
              )}
            </span>
          );
        })}
      </div>
      {error && <div className="mt-1.5 rounded-md bg-red-900/30 px-2 py-1 text-xs text-red-300">{error}</div>}
      {person && open?.mode === "mark" && (
        <MarkForm key={person.id} name={person.name} onCancel={() => setOpen(null)} onSave={(reason, note) => post("/api/attendance/absence", { resourceId: person.id, date, reason, note })} />
      )}
      {person && open?.mode === "detail" && person.absence && (
        <MarkDetail name={person.name} view={person.absence} canMark={canMark} onClose={() => setOpen(null)} onUndo={(id, reason) => post(`/api/attendance/absence/${encodeURIComponent(id)}/cancel`, { reason })} />
      )}
    </>
  );
}

function MarkForm({ name, onSave, onCancel }: { name: string; onSave: (reason: AbsenceReason, note: string) => Promise<boolean>; onCancel: () => void }) {
  const [reason, setReason] = useState<AbsenceReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-edge bg-panel2/60 p-2 text-xs" data-testid="not-in-form">
      <div className="w-full text-gray-300">{name} - not in today? This is information only: it adds no hours, and a sign-in still counts.</div>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Why">
        {(Object.keys(ABSENCE_LABEL) as AbsenceReason[]).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={`rounded-lg border px-3 py-1 text-xs ${reason === r ? "border-brand-500 bg-brand-600/25 text-brand-100" : "border-edge text-gray-300 hover:bg-panel2"}`}
          >
            {ABSENCE_LABEL[r]}
          </button>
        ))}
      </div>
      <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-gray-400">
        Note (optional)
        <input className={inp} value={note} maxLength={ABSENCE_LIMITS.noteMax} onChange={(e) => setNote(e.target.value)} placeholder="e.g. rang in at 6am" />
      </label>
      <button className={btn} disabled={!reason || busy} onClick={async () => { setBusy(true); await onSave(reason as AbsenceReason, note); setBusy(false); }}>Save</button>
      <button className={quiet} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function MarkDetail({ name, view, canMark, onUndo, onClose }: { name: string; view: AbsenceView; canMark: boolean; onUndo: (id: string, reason: string) => Promise<boolean>; onClose: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const a = view.active;
  return (
    <div className="mt-2 space-y-1 rounded-md border border-edge bg-panel2/60 p-2 text-xs text-gray-300" data-testid="absence-detail">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <b className="text-gray-100">{name}</b>
          {a ? <> - {markWords(a, when)}</> : " - no live mark"}
          {a && markedButSignedIn(view) && <div className="text-amber-300">{markedButSignedInText(a.label)} - the sign-in&apos;s hours stand. Check which is right.</div>}
        </div>
        <button className={quiet} onClick={onClose}>Close</button>
      </div>
      {view.cancelled.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-gray-400">
          {view.cancelled.map((m) => (
            <li key={m.id}>
              <span className="line-through">{markWords(m, when)}</span> - undone by {m.cancelledBy} {m.cancelledAt ? when(m.cancelledAt) : ""}: &ldquo;{m.cancelReason}&rdquo;
            </li>
          ))}
        </ul>
      )}
      {a && canMark && (undoing ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-0.5 text-gray-400">
            Why undo it? (kept)
            <input className={inp} value={reason} maxLength={ABSENCE_LIMITS.cancelReasonMax} onChange={(e) => setReason(e.target.value)} placeholder="e.g. marked the wrong person" autoFocus />
          </label>
          <button className={btn} disabled={reason.trim().length < ABSENCE_LIMITS.cancelReasonMin || busy} onClick={async () => { setBusy(true); await onUndo(a.id, reason); setBusy(false); }}>Undo mark</button>
          <button className={quiet} onClick={() => setUndoing(false)}>Cancel</button>
        </div>
      ) : (
        <button className={quiet} onClick={() => setUndoing(true)}>Undo…</button>
      ))}
    </div>
  );
}
