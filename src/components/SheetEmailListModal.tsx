"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

// The allocation email list (Ilies, 20 Nov 2026): the addresses the day sheet's "Open in email" puts in To, every day.
// Managers and Admins only (the API refuses everyone else). Nothing is deleted: a removed address is kept with who,
// when and why, and "Put back" adds it again.
type Row = {
  id: string; email: string; label: string | null; addedBy: string; addedAt: string;
  removedBy: string | null; removedAt: string | null; removedReason: string | null;
};
type List = { active: Row[]; removed: Row[]; max: number };

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" }) : "";

const btn = "rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40";

export default function SheetEmailListModal({ onClose, onChanged }: { onClose: () => void; onChanged: (emails: string[]) => void }) {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/sheet-emails", { cache: "no-store" });
    if (!res.ok) { setError(await serverErrorMessage(res, "Couldn't load the email list.")); return; }
    const l: List = await res.json();
    setList(l);
    onChanged(l.active.map((r) => r.email));
  }, [onChanged]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function post(body: object) {
    setBusy(true);
    try {
      const res = await apiFetch("/api/sheet-emails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) return { ok: false as const, error: await serverErrorMessage(res, "That didn't save. Try again.") };
      return { ok: true as const, body: await res.json() };
    } finally {
      setBusy(false);
    }
  }

  async function add(paste: string) {
    const r = await post({ action: "add", text: paste });
    if (!r.ok) { setResult({ ok: false, text: r.error }); return; }
    setResult({ ok: r.body.invalid?.length === 0, text: r.body.message });
    // The ones that weren't valid stay in the box to fix; everything else is cleared.
    if (paste === text) setText((r.body.invalid ?? []).join("\n"));
    await load();
  }

  async function remove(id: string) {
    const r = await post({ action: "remove", id, reason });
    if (!r.ok) { setResult({ ok: false, text: r.error }); return; }
    setRemoving(null);
    setReason("");
    setResult(null);
    await load();
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Allocation email list"
    >
      <div
        className="animate-modal-in flex max-h-full w-full max-w-xl flex-col rounded-2xl border border-edge bg-canvas shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <div className="text-base font-semibold text-gray-100">
              Allocation email list{list ? ` (${list.active.length} of ${list.max})` : ""}
            </div>
            <div className="text-xs text-gray-500">
              Everyone here goes in the To line when you press &quot;Open in email&quot; on the day sheet - every day.
            </div>
          </div>
          <button onClick={onClose} className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200" aria-label="Close" title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="sheet-emails-paste" className="text-xs font-medium text-gray-300">Add addresses</label>
            <textarea
              id="sheet-emails-paste"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={"One per line, or separated by commas or semicolons.\nNames are kept too: Joe Bloggs <joe@example.com>"}
              className="mt-1 w-full resize-y rounded-lg border border-edge bg-panel2 p-2.5 text-xs text-gray-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className={`text-xs ${result ? (result.ok ? "text-emerald-500" : "text-amber-500") : "text-gray-500"}`} role="status">
                {result?.text ?? ""}
              </div>
              <button
                onClick={() => add(text)}
                disabled={busy || !text.trim()}
                className="shrink-0 rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
          {!list && !error && <div className="text-xs text-gray-500">Loading...</div>}

          {list && (
            <div>
              <div className="text-xs font-medium text-gray-300">On the list</div>
              {list.active.length === 0 ? (
                <div className="mt-1 text-xs text-gray-500">No one yet - the email opens with an empty To line.</div>
              ) : (
                <ul className="mt-1 divide-y divide-edge rounded-lg border border-edge">
                  {list.active.map((r) => (
                    <li key={r.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-gray-200">{r.email}</div>
                          <div className="truncate text-[11px] text-gray-500">
                            {r.label ? `${r.label} · ` : ""}added by {r.addedBy}, {fmt(r.addedAt)}
                          </div>
                        </div>
                        {removing !== r.id && (
                          <button onClick={() => { setRemoving(r.id); setReason(""); }} className={`${btn} flex shrink-0 items-center gap-1`} disabled={busy}>
                            <Trash2 size={13} /> Remove
                          </button>
                        )}
                      </div>
                      {removing === r.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why (optional)"
                            maxLength={300}
                            className="min-w-0 flex-1 rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                          />
                          <button onClick={() => remove(r.id)} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40">
                            Take off the list
                          </button>
                          <button onClick={() => setRemoving(null)} className={btn}>Cancel</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {list && list.removed.length > 0 && (
            <div>
              <button onClick={() => setShowRemoved((s) => !s)} className="text-xs font-medium text-gray-400 hover:text-gray-200">
                {showRemoved ? "Hide" : "Show"} removed ({list.removed.length})
              </button>
              {showRemoved && (
                <ul className="mt-1 divide-y divide-edge rounded-lg border border-edge">
                  {list.removed.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-gray-400 line-through">{r.email}</div>
                        <div className="truncate text-[11px] text-gray-500">
                          removed by {r.removedBy}, {fmt(r.removedAt)}{r.removedReason ? ` - ${r.removedReason}` : ""}
                        </div>
                      </div>
                      <button onClick={() => add(r.label ? `${r.label} <${r.email}>` : r.email)} disabled={busy} className={`${btn} flex shrink-0 items-center gap-1`}>
                        <RotateCcw size={13} /> Put back
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
