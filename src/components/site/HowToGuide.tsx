"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { HowToGuide } from "@/lib/howTo";

// "How to use" (24 Nov 2026): one component for every guide in lib/howTo.ts - static words, no fetch. Phone-first:
// big text, short numbered steps, a Back button at the top and the bottom.
//   - HowToGuideView: the guide itself (the site link shows it as its own screen, under the link's own Back).
//   - HowToLink: a small "How signing in works" link for the QR sign-in screen. It opens the guide as a full-screen
//     layer over the page - the sign-in screen underneath stays exactly as it was (nothing is unmounted or reset), and
//     Back closes it. The page only shows the link where it can't get in the way (never on the odometer / pre-start).

export function HowToGuideView({ guide, onBack, backLabel = "Back" }: { guide: HowToGuide; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="space-y-5 pb-4" data-testid={`howto-${guide.id}`}>
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">{guide.title}</h1>
        <p className="mt-0.5 text-sm text-gray-400">{guide.sub}</p>
      </div>
      {guide.rule && (
        <div className="rounded-2xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-base font-semibold leading-snug text-amber-100">{guide.rule}</div>
      )}
      {guide.sections.map((s) => (
        <section key={s.title} className="rounded-2xl border border-edge bg-panel p-4">
          <h2 className="mb-2 border-l-4 border-brand-500 pl-2 text-lg font-semibold text-gray-100">{s.title}</h2>
          {s.intro && <p className="mb-2 text-base leading-snug text-gray-300">{s.intro}</p>}
          {s.steps && s.steps.length > 0 && (
            <ol className="space-y-3">
              {s.steps.map((st, i) => (
                <li key={i} className="flex gap-3 text-base leading-snug text-gray-300">
                  {s.numbered ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-sm font-semibold text-brand-200">{i + 1}</span>
                  ) : (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                  )}
                  <span>{st.lead && <b className="text-gray-100">{st.lead}</b>}{st.lead && st.text ? " " : ""}{st.text}</span>
                </li>
              ))}
            </ol>
          )}
          {s.after && <p className="mt-3 text-base leading-snug text-gray-300">{s.after}</p>}
        </section>
      ))}
      {onBack && (
        <button onClick={onBack} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-edge bg-panel2 px-4 py-4 text-lg font-semibold text-gray-100">
          <ArrowLeft size={20} /> {backLabel}
        </button>
      )}
    </div>
  );
}

export function HowToLink({ guide, label }: { guide: HowToGuide; label: string }) {
  const [open, setOpen] = useState(false);
  // While the guide is open the page underneath doesn't scroll; it comes back where it was.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mx-auto flex items-center gap-1.5 py-2 text-sm text-brand-300 underline" data-testid="howto-link">
        <BookOpen size={15} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas" role="dialog" aria-modal="true" aria-label={guide.title}>
          <div className="mx-auto max-w-md px-4 pb-10 pt-5">
            <button onClick={() => setOpen(false)} className="mb-4 flex items-center gap-1 text-base text-gray-300">
              <ArrowLeft size={18} /> Back
            </button>
            <HowToGuideView guide={guide} onBack={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
