"use client";

import { useEffect, useState } from "react";
import { BookOpen, X } from "lucide-react";
import { GUIDE_NOTES, GUIDE_STEPS, GUIDE_TITLE } from "@/lib/dailyLog/guide";

// The supervisor guide for the daily log (30 Oct 2026, wording in lib/dailyLog/guide.ts): a "What's new" card on the
// link's home that "Got it" hides for good on that phone (per version), and a "How to use the daily log" link that
// opens the same steps any time. Only on links with the daily log - the server says so (info.guide).

const SEEN_KEY = "lobos.dailyLogGuide.seen";

function GuideSteps() {
  return (
    <>
      <ol className="mt-2 space-y-2 text-sm text-gray-300">
        {GUIDE_STEPS.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-xs font-semibold text-brand-200">{i + 1}</span>
            <span><b className="text-gray-100">{s.lead}</b>{s.text ? ` ${s.text}` : ""}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 text-sm font-semibold text-gray-200">Good to know</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-400">
        {GUIDE_NOTES.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </>
  );
}

export function WhatsNewCard({ version }: { version: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = 0;
    try { seen = Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0; } catch { /* storage blocked - show it */ }
    setShow(seen < version);
  }, [version]);
  if (!show) return null;
  const gotIt = () => {
    try { localStorage.setItem(SEEN_KEY, String(version)); } catch { /* not remembered - hidden for now */ }
    setShow(false);
  };
  return (
    <div className="mb-4 rounded-2xl border border-brand-500/50 bg-brand-600/10 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-brand-300">What&apos;s new</div>
      <h2 className="mt-0.5 text-base font-semibold text-gray-100">{GUIDE_TITLE}</h2>
      <GuideSteps />
      <button className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white" onClick={gotIt}>Got it</button>
    </div>
  );
}

export function GuideLink({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`inline-flex items-center gap-1.5 text-sm text-brand-300 underline ${className}`} onClick={() => setOpen(true)}>
        <BookOpen size={15} /> How to use the daily log
      </button>
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={GUIDE_TITLE} onClick={() => setOpen(false)}>
          <div className="mx-auto max-w-md rounded-2xl border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-100">{GUIDE_TITLE}</h2>
              <button className="p-1 text-gray-400" aria-label="Close" onClick={() => setOpen(false)}><X size={20} /></button>
            </div>
            <GuideSteps />
            <button className="mt-4 w-full rounded-xl border border-edge bg-panel2 px-4 py-3 text-base font-medium text-gray-200" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
