"use client";

import { useState } from "react";
import { Check, ChevronLeft, PenLine } from "lucide-react";
import SignaturePad from "./SignaturePad";
import type { LinkCrewDTO } from "@/lib/siteDocs/store";

// Crew sign-on on the supervisor's phone (site documents, Ilies 25 Nov 2026): a worker taps their name from TODAY's
// sign-ins on the job (nobody else can be picked - sign them in first), reads it, ticks "I understand" and signs with a
// finger. Used by the SWMS, the pre-start, the toolbox talk and a late sign-on. Big tap targets, one column.

export const card = "rounded-2xl border border-edge bg-panel p-4";
export const input = "w-full rounded-xl border border-edge bg-panel2 px-3 py-3 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
export const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-4 text-base font-semibold text-white disabled:opacity-40";
export const secondary = "flex w-full items-center justify-center gap-2 rounded-xl border border-edge bg-panel px-4 py-3.5 text-base font-semibold text-gray-200 active:bg-panel2";
export const h2 = "mb-2 text-base font-semibold text-gray-100";

// The list of today's crew: tap a name to sign. `done` = already signed (greyed, ticked).
export function CrewPicker({ crew, done, onPick, empty }: { crew: LinkCrewDTO[]; done: Set<string>; onPick: (c: LinkCrewDTO) => void; empty?: string }) {
  if (!crew.length) return <p className="text-sm text-gray-400">{empty ?? "Nobody is signed in on this job yet. Sign the crew in first (Sign in crew), then they can sign on."}</p>;
  return (
    <div className="space-y-2">
      {crew.map((c) => {
        const signed = done.has(c.id);
        return (
          <button key={c.id} type="button" disabled={signed} onClick={() => onPick(c)}
            className={`flex min-h-[3.5rem] w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left ${signed ? "border-emerald-500/40 bg-emerald-500/10" : "border-edge bg-panel2 active:bg-panel"}`}>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-gray-100">{c.name}</span>
              <span className="block text-xs text-gray-400">{c.company ?? (c.staff ? "Lobos" : "")}{c.in ? ` · in ${c.in}` : ""}{c.out ? ` · out ${c.out}` : ""}</span>
            </span>
            {signed ? <span className="flex shrink-0 items-center gap-1 text-sm text-emerald-300"><Check size={18} /> Signed</span> : <span className="flex shrink-0 items-center gap-1 text-sm text-brand-300"><PenLine size={18} /> Sign</span>}
          </button>
        );
      })}
    </div>
  );
}

// One person signing: "Hand the phone to <name>", what they're signing for, "I understand", the pad, Save.
export function SignOnPanel({ who, tickText, children, busy, error, onSave, onCancel }: {
  who: string; tickText: string; children?: React.ReactNode; busy?: boolean; error?: string | null;
  onSave: (png: string) => void; onCancel: () => void;
}) {
  const [ok, setOk] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <button onClick={onCancel} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back - not signed</button>
      <div className={`${card} border-amber-500/40`}>
        <p className="text-sm text-gray-400">Hand the phone to</p>
        <p className="text-xl font-semibold text-gray-100">{who}</p>
      </div>
      {children}
      <label className={`${card} flex cursor-pointer items-start gap-3`}>
        <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-brand-500" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span className="text-base text-gray-100">{tickText}</span>
      </label>
      <div className={card}>
        <SignaturePad label={`${who} - sign here`} onChange={setPng} disabled={!ok} />
        {!ok && <p className="mt-1 text-xs text-amber-300">Tick the box first.</p>}
      </div>
      {error && <div className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      <button className={primary} disabled={!ok || !png || busy} onClick={() => png && onSave(png)}>{busy ? "Saving…" : "Save my signature"}</button>
    </div>
  );
}
