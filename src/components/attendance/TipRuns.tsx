"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { TipRunLine } from "@/lib/tipRun/store";
import { TIP_FLAG_LABEL } from "@/lib/tipRun/rules";

// Regional tip runs on the Sign-ins page (19 Nov 2026, shift rollover), under the shift they count to: "Start tip run"
// -> "Tipped – finished" on the worker's phone. Worked hours on the shift's day (in Timesheets' total, their own
// column). The office corrects a time with a reason (kept), like a travel leg.
const FLAG: Record<string, string> = TIP_FLAG_LABEL;

// ISO -> the value a datetime-local input wants, in the browser's (Sydney) time.
const local = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function TipRuns({ runs, canEdit, onChanged }: { runs: TipRunLine[]; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (runs.length === 0) return null;
  return (
    <div className="-mt-1 rounded-b-xl border border-t-0 border-violet-500/30 bg-violet-500/5 px-3 py-2" data-testid="tip-runs">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-300">Tip runs (counted to this shift)</div>
      <ul className="space-y-1">
        {runs.map((r) => (
          <li key={r.tipRunId} className="text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Truck size={13} className="text-violet-300" aria-hidden />
              <span className="font-medium text-gray-100">{r.name}</span>
              <span className="text-gray-400">Tip run</span>
              <span className="text-gray-300">{r.start}–{r.end ?? "?"}</span>
              <span className="font-semibold text-gray-100">{r.hours == null ? "–" : `${r.hours}h`}</span>
              {r.flag && <span className={r.flag === "ON_THE_GO" ? "text-xs text-emerald-400" : "text-xs text-amber-400"}>{FLAG[r.flag]}</span>}
              {r.changedByOffice && <span className="text-xs text-amber-400" title={r.changedByOffice}>office changed</span>}
              {canEdit && <button className="ml-auto text-xs text-brand-300 hover:underline" onClick={() => setEditing(editing === r.tipRunId ? null : r.tipRunId)}>Fix time</button>}
            </div>
            {editing === r.tipRunId && <Fix run={r} onDone={() => { setEditing(null); onChanged(); }} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fix({ run, onDone }: { run: TipRunLine; onDone: () => void }) {
  const [start, setStart] = useState(local(run.startAt));
  const [end, setEnd] = useState(local(run.endAt));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/attendance/tip-runs/${run.tipRunId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt: start ? new Date(start).toISOString() : null, endAt: end ? new Date(end).toISOString() : null, reason }),
    });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save."));
    onDone();
  }
  const input = "rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200";
  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-md border border-edge bg-panel p-2">
      <label className="text-[11px] text-gray-400">Start<br /><input type="datetime-local" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="text-[11px] text-gray-400">Tipped – finished<br /><input type="datetime-local" className={input} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="min-w-[12rem] flex-1 text-[11px] text-gray-400">Reason (kept)<br /><input className={`${input} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to tap Tipped – finished" /></label>
      <button disabled={busy || reason.trim().length < 3} onClick={save} className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
      {error && <div className="w-full text-xs text-red-400">{error}</div>}
    </div>
  );
}
