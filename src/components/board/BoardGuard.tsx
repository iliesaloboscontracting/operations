"use client";

// Allocation guard on the board (2 Nov 2026): before the first change to a day - and before its sheet goes out - the
// board asks /api/board/check whether that day looks like a slip ("you sent Monday's sheet, now you're changing
// Sunday - did you mean Monday?"), and shows one question with a tap either way. It also shows when the day's sheet
// last went out and what's changed since. Never a block: a failed check lets the change through.
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { dayLabel } from "@/lib/boardGuard/rules";

type Prompt = { reason: string; message: string; suggest: string };
export type SentInfo = { at: string; time: string; by: string; how: string; changes: string[] };
type Ask = { prompt: Prompt; date: string; resolve: (go: boolean) => void };

const CONFIRMED_FOR_MS = 30 * 60_000; // once "yes, this day" is said, the day isn't asked about again for 30 minutes

export function useBoardGuard(selectedDate: string, setSelectedDate: (d: string) => void, onSwitched: (text: string) => void) {
  const confirmed = useRef(new Map<string, number>()); // `${purpose}|${date}` -> when it was confirmed
  const [ask, setAsk] = useState<Ask | null>(null);
  const [sent, setSent] = useState<SentInfo | null>(null);

  const check = useCallback(async (purpose: "edit" | "send"): Promise<boolean> => {
    const key = `${purpose}|${selectedDate}`;
    const at = confirmed.current.get(key);
    if (at && Date.now() - at < CONFIRMED_FOR_MS) return true;
    let prompt: Prompt | null = null;
    try {
      const res = await apiFetch(`/api/board/check?date=${selectedDate}&purpose=${purpose}`);
      if (!res.ok) return true;
      const body = await res.json();
      setSent(body.sent ?? null);
      prompt = body.prompt ?? null;
    } catch {
      return true;
    }
    if (!prompt) {
      confirmed.current.set(key, Date.now());
      return true;
    }
    const go = await new Promise<boolean>((resolve) => setAsk({ prompt: prompt!, date: selectedDate, resolve }));
    if (go) confirmed.current.set(key, Date.now());
    return go;
  }, [selectedDate]);

  const refreshSent = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/board/check?date=${selectedDate}&purpose=edit`);
      if (res.ok) setSent((await res.json()).sent ?? null);
    } catch {
      // the banner just stays as it was
    }
  }, [selectedDate]);
  useEffect(() => { setSent(null); refreshSent(); }, [refreshSent]);

  async function recordSend(how: "COPY" | "EMAIL") {
    try {
      const res = await apiFetch("/api/board/sends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: selectedDate, how }) });
      if (res.ok) setSent((await res.json()).sent ?? null);
    } catch {
      // recording the send never stops the sheet going out
    }
  }

  const modal = ask && (
    <div className="animate-overlay-in fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Check the day">
      <div className="animate-modal-in w-full max-w-md rounded-2xl border border-amber-700/60 bg-canvas shadow-soft-lg">
        <div className="flex items-start gap-3 px-5 py-4">
          <CalendarClock size={20} className="mt-0.5 shrink-0 text-amber-400" />
          <div>
            <div className="text-base font-semibold text-gray-100">Check the day</div>
            <p className="mt-1 text-sm text-gray-300">{ask.prompt.message}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-edge px-5 py-4 sm:flex-row sm:justify-end">
          <button
            onClick={() => { ask.resolve(false); setAsk(null); }}
            className="rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-panel2"
          >
            Cancel
          </button>
          <button
            onClick={() => { ask.resolve(true); setAsk(null); }}
            className="rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-panel2"
          >
            Yes, {dayLabel(ask.date)}
          </button>
          <button
            autoFocus
            onClick={() => {
              ask.resolve(false);
              setAsk(null);
              setSelectedDate(ask.prompt.suggest);
              onSwitched(`Switched to ${dayLabel(ask.prompt.suggest)} - make the change again here. Nothing was changed on ${dayLabel(ask.date)}.`);
            }}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500"
          >
            Go to {dayLabel(ask.prompt.suggest)}
          </button>
        </div>
      </div>
    </div>
  );

  return { confirmEdit: () => check("edit"), confirmSend: () => check("send"), recordSend, refreshSent, sent, modal };
}

// "Sheet sent 6:12pm by Ilies - 3 changes since" under the board's header.
export function SentBanner({ sent }: { sent: SentInfo | null }) {
  const [open, setOpen] = useState(false);
  if (!sent) return null;
  const n = sent.changes.length;
  return (
    <div className={`px-4 py-1.5 text-xs ${n ? "bg-amber-900/30 text-amber-200" : "bg-panel2 text-gray-400"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Send size={12} className="shrink-0" />
        <span>
          This day's sheet went out at {sent.time} ({sent.by}, {sent.how === "EMAIL" ? "email" : "copied"}).{" "}
          {n ? <strong>{n} change{n === 1 ? "" : "s"} since - Export again so the crew have the latest.</strong> : "No changes since."}
        </span>
        {n > 0 && (
          <button onClick={() => setOpen((o) => !o)} className="underline decoration-dotted hover:text-white">
            {open ? "Hide" : "Show"} changes
          </button>
        )}
      </div>
      {open && n > 0 && (
        <ul className="mt-1 list-disc pl-6">
          {sent.changes.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}
