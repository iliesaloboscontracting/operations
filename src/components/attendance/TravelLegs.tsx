"use client";

import { useState } from "react";
import { Car, Home } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { TravelLine } from "@/lib/travel/store";
import { amberFlag, driversPossibleText, FLAG_LABEL, modeMissing, modeOf, paidText, TRAVEL_MODES, type TravelMode } from "@/lib/travel/rules";

// Regional travel legs on the Sign-ins page (2 Nov 2026), under the job they belong to: travel out (Start travel ->
// their site sign-in) and travel home (Travelling home -> Arrived). Hours are their own - never site hours. The office
// corrects a time with a reason (kept), like a sign-in. No GPS here (accounts / Admins only).
// Travel pay (23-24 Nov 2026): how they travelled and the paid hours - "paid 1h (passenger)" - or "mode not recorded"
// (amber) on a leg from before the phone asked; the office sets or changes it in Fix, with a reason.
// Crew travel (24 Nov 2026): worked out from their driver - "paid 1h (with Turori's truck)". Nothing is stored for it,
// so instead of Fix the office has "Add travel" (a leg of their own, with a reason, takes its place) - e.g. for "no driver
// found". TP-001: a leg over the person's own sign-ins is amber and pays nothing until one or the other is trimmed; a Yard /
// Office sign-in left open into the drive out has a one-tap "End yard sign-in when the truck left" (option A, Ilies).
const FLAG: Record<string, string> = FLAG_LABEL;

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
              <Paid l={l} />
              {l.flag && <span className={amberFlag(l.flag) ? "text-xs text-amber-400" : "text-xs text-emerald-400"} data-testid="travel-flag">{FLAG[l.flag]}</span>}
              {l.changedByOffice && <span className="text-xs text-amber-400" title={l.changedByOffice}>office changed</span>}
              {driversPossibleText(l.driversPossible) && <span className="text-xs text-gray-400" data-testid="travel-drivers-possible">{driversPossibleText(l.driversPossible)}</span>}
              {canEdit && l.pointFix && <PointFixButton leg={l} onDone={onChanged} />}
              {canEdit && <button className="ml-auto text-xs text-brand-300 hover:underline" onClick={() => setEditing(editing === l.legId ? null : l.legId)}>{l.derived ? "Add travel" : "Fix"}</button>}
            </div>
            {editing === l.legId && <Fix leg={l} onDone={() => { setEditing(null); onChanged(); }} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

// "paid 1h (passenger)", "paid 2h (own vehicle)" or "mode not recorded" (amber) - nothing for a leg with no hours.
function Paid({ l }: { l: TravelLine }) {
  const t = { hours: l.hours, mode: modeOf(l.mode), paidHours: l.paidHours, via: l.via };
  const text = paidText(t);
  if (!text) return null;
  return <span className={`text-xs ${modeMissing(t) ? "text-amber-400" : "text-sky-300"}`} data-testid="travel-paid">{text}</span>;
}

const MODE_OPTION: Record<TravelMode, string> = { DRIVER_OWN_VEHICLE: "Driving own car/ute", PASSENGER: "Passenger" };

// Option A (Ilies, 24 Nov 2026): one tap ends the Yard / Office sign-in at the departure - the ordinary office sign-in
// change (Manager+, its reason kept in AttendanceEdit, locked weeks refuse). Only when the office presses it.
function PointFixButton({ leg, onDone }: { leg: TravelLine; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = leg.pointFix!;
  // TP-011 (Ilies, 24 Nov 2026): asks first, with the sign-in's time before -> after.
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }) : "not signed out");
  async function go() {
    if (!window.confirm(`${f.label}?\n\nTheir sign-out changes from ${t(f.currentSignOutAt)} to ${t(f.signOutAt)}.\nReason kept: ${f.reason}`)) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/attendance/${f.attendanceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signOutAt: f.signOutAt, reason: f.reason }),
    });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't change the sign-in."));
    onDone();
  }
  return (
    <>
      <button className="text-xs text-amber-300 underline disabled:opacity-40" disabled={busy} onClick={go} title={f.reason} data-testid="travel-point-fix">{f.label}</button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </>
  );
}

function Fix({ leg, onDone }: { leg: TravelLine; onDone: () => void }) {
  // A worked-out crew leg has no row to change: "Add travel" makes the office's own leg for that person, job and way,
  // starting from what was worked out (or their site sign-in / sign-out when no driver was found).
  const adding = !!leg.derived;
  const [start, setStart] = useState(adding && leg.start === "?" ? "" : local(leg.startAt));
  const [end, setEnd] = useState(local(leg.endAt));
  const [mode, setMode] = useState<TravelMode | "">(modeOf(leg.mode) ?? (adding ? "PASSENGER" : ""));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    const iso = (v: string) => (v ? new Date(v).toISOString() : null);
    const res = adding
      ? await apiFetch("/api/attendance/travel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceId: leg.resourceId, jobId: leg.jobId, direction: leg.direction, startAt: iso(start), endAt: iso(end), mode, reason }),
        })
      : await apiFetch(`/api/attendance/travel/${leg.legId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startAt: iso(start), endAt: iso(end), ...(mode && mode !== modeOf(leg.mode) ? { mode } : {}), reason }),
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
      <label className="text-[11px] text-gray-400">Travelled as<br />
        <select className={input} value={mode} onChange={(e) => setMode(e.target.value as TravelMode | "")} data-testid="travel-mode">
          {!modeOf(leg.mode) && !adding && <option value="">Not recorded</option>}
          {TRAVEL_MODES.map((m) => <option key={m} value={m}>{MODE_OPTION[m]}</option>)}
        </select>
      </label>
      <label className="min-w-[12rem] flex-1 text-[11px] text-gray-400">Reason (kept)<br /><input className={`${input} w-full`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to tap Arrived" /></label>
      <button disabled={busy || reason.trim().length < 3 || (adding && (!start || !end || !mode))} onClick={save} className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">Save</button>
      {error && <div className="w-full text-xs text-red-400">{error}</div>}
    </div>
  );
}
