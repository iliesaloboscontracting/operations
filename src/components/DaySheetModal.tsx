"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, X } from "lucide-react";

// Preview of the generated day sheet before it goes out. Editable, since truck/driver
// movements aren't tracked in the app yet and a supervisor may want to tweak wording -
// then either copy it straight into WhatsApp/etc, or open it as an email draft.
export default function DaySheetModal({
  subject,
  body,
  onClose,
}: {
  subject: string;
  body: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, non-secure context) - the textarea is still
      // right there to select and copy by hand.
    }
  }

  function emailIt() {
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Day sheet"
    >
      <div
        className="animate-modal-in flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-edge bg-canvas shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <div className="text-base font-semibold text-gray-100">Day sheet</div>
            <div className="text-xs text-gray-500">
              Review before it goes out. Truck &amp; driver movements aren't tracked in the app -
              fill that bit in below.
            </div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={22}
            className="w-full resize-y rounded-lg border border-edge bg-panel2 p-3 font-mono text-xs leading-relaxed text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-5 py-4">
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-panel2"
          >
            {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          <button
            onClick={emailIt}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98]"
          >
            <Mail size={15} />
            Open in email
          </button>
        </div>
      </div>
    </div>
  );
}
