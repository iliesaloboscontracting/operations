"use client";

import { useState } from "react";
import { Car, Home } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { TravelLine } from "@/lib/travel/store";

// Regional travel legs on the Sign-ins page (2 Nov 2026), under the job they belong to: travel out (Start travel ->
// their site sign-in) and travel home (Travelling home -> Arrived). Hours are their own - never site hours. The office
// corrects a time with a reason (kept), like a sign-in. No GPS here (accounts / Admins only).
const FLAG: Record<string, string> = { ON_THE_WAY: "on the way", NOT_ENDED: "never ended - no hours", OVER_CAP: "over 8h - not counted" };

// ISO -> the value a datetime-local input wants, in the browser's (Sydney) time.
const local = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function TravelLegs({ legs, canEdit, onChanged }: { legs: TravelLine[]; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (legs.length === 0) return null;
  return (
    <div className="-mt-1 rounded-b-xl border border-t-0 border-sky-500/30 bg-sky-500/5 px-3 py-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">Regional travel</div>
      <ul className="space-y-1">
        {legs.map((l) => (
          <li key={l.legId} className="text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {l.direction === "OUT" ? <Car size={13} className="text-sky-300" aria-hidden /> : <Home size={13} className="text-sky-300" aria-hidden />}
              <span className="font-medium text-gray-100">{l.name}</span>
              <span className="text-gray-400">{l.direction === "OUT" ? "Travel out" : "Travel home"}</span>
              <span className="text-gray-300">{l.start}–{l.end ?? "?"}</span>
              <span className="font-semibold text-gray-100">{l.hours == null ? "–" : `${l.hours}h`}</span>
              {l.flag && <span className={l.flag === "ON_THE_WAY" ? "text-xs text-emerald-400" : "text-xs text-amber-400"}>{FLAG[l.flag]}</span>}
              {l.changedByOffice && <span className="text-xs text-amber-400" title={l.changedByOffice}>office changed</span>}
              {canEdit && <button className="ml-auto text-xs text-brand-300 hover:underline" onClick={() => setEditing(editing === l.legId ? null : l.legId)}>Fix time</button>}
            </div>
            {editing === l.legId && <Fix leg={l} onDone={() => { setEditing(null); onChanged(); }} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fix({ leg, onDone }: { leg: TravelLine; onDone: () => void }) {
  const [start, setStart] = useState(local(leg.startAt));
  const [end, setEnd] = useState(local(leg.endAt));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/attendance/travel/${leg.legId}`, {
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
      <label className="text-[11px] text-gray-400">{leg.direction === "OUT" ? "Arrived on site" : "Arrived home"}<br /><input type="datetime-local" className={input} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="min-w-[12rem] flex-1 text-[11px] text-gray-400">Reason (kept)<br /><input className={`${input} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to tap Arrived" /></label>
      <button disabled={busy || reason.trim().length < 3} onClick={save} className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
      {error && <div className="w-full text-xs text-red-400">{error}</div>}
    </div>
  );
}
