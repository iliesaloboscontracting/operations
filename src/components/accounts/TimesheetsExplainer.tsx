"use client";

import { X } from "lucide-react";
import type { Explainer } from "@/lib/accountsTimesheets";

// "How timesheets work" (2 Nov 2026): comes up once for the accounts login until "Got it", and again from the link
// on the page. Closing it with the X only hides it this time; "Got it" is what records it (server side).
// The words live in lib/accountsTimesheets.ts (TIMESHEETS_EXPLAINER) and come with the week from the API.
export default function TimesheetsExplainer({ explainer: e, onClose, onGotIt, busy }: { explainer: Explainer; onClose: () => void; onGotIt: () => void; busy?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="ts-explainer-title">
      <div className="animate-modal-in flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-soft-lg">
        <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <h2 id="ts-explainer-title" className="text-lg font-semibold text-gray-100">{e.title}</h2>
            <p className="mt-1 text-sm text-gray-400">{e.intro}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-panel2 hover:text-gray-200"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {e.sections.map((s) => (
            <section key={s.heading}>
              <h3 className="mb-1.5 text-sm font-semibold text-gray-100">{s.heading}</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
                {s.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex justify-end border-t border-edge px-5 py-3">
          <button disabled={busy} onClick={onGotIt} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">Got it</button>
        </div>
      </div>
    </div>
  );
}
