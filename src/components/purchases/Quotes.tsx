"use client";

import { useState } from "react";
import { CheckCircle2, FileText, Paperclip } from "lucide-react";
import { money } from "@/lib/resource";

// Suppliers' quotes on a purchase or hire request (2 Nov 2026, Ilies: "a button that allows us to add another
// supplier to the same request, this way they can see prices from different suppliers"). QuoteList shows them -
// supplier, price ex GST, details, link, the quote file (through an authorised route under `fileBase`) and which one
// the approver went with; QuoteFields is one quote being typed (details and a file are both optional).
export type QuoteDTO = {
  id: string; supplier: string; priceExGst: number | null; details: string | null; linkUrl: string | null;
  file: { name: string; mime: string | null } | null; createdBy: string; createdAt: string;
};
export type QuoteDraft = { supplier: string; priceExGst: string; details: string; linkUrl: string; file: { dataUrl: string; name: string } | null };
export const emptyQuote = (): QuoteDraft => ({ supplier: "", priceExGst: "", details: "", linkUrl: "", file: null });
export const fromQuote = (q: QuoteDTO): QuoteDraft => ({ supplier: q.supplier, priceExGst: q.priceExGst == null ? "" : String(q.priceExGst), details: q.details ?? "", linkUrl: q.linkUrl ?? "", file: null });
// A typed quote that's still completely empty is left out rather than refused.
export const isBlank = (q: QuoteDraft) => !q.supplier.trim() && !q.priceExGst.trim() && !q.details.trim() && !q.linkUrl.trim() && !q.file;

const MAX_FILE = 15 * 1024 * 1024;
const readFile = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });

export function QuoteList({ quotes, chosenQuoteId, fileBase, legacySupplier }: { quotes: QuoteDTO[]; chosenQuoteId: string | null; fileBase: string; legacySupplier?: string | null }) {
  if (!quotes.length) return legacySupplier ? <p className="mt-1 text-xs text-gray-500">Supplier: {legacySupplier}</p> : null;
  return (
    <ul className="mt-2 space-y-1.5">
      {quotes.map((q) => {
        const chosen = q.id === chosenQuoteId;
        return (
          <li key={q.id} className={`rounded-lg border px-2.5 py-2 text-sm ${chosen ? "border-emerald-600/60 bg-emerald-950/30" : "border-edge bg-panel2/40"}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-gray-100">{q.supplier}</span>
              {q.priceExGst != null && <span className="font-semibold text-gray-100">{money(q.priceExGst)} ex GST</span>}
              {chosen && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-900/70 px-2 py-0.5 text-[11px] font-medium text-emerald-100"><CheckCircle2 size={12} /> Going with this one</span>}
            </div>
            {q.details && <p className="mt-0.5 whitespace-pre-line text-xs text-gray-400">{q.details}</p>}
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
              {q.linkUrl && <a href={q.linkUrl} target="_blank" rel="noreferrer noopener" className="truncate text-brand-300 hover:underline">{q.linkUrl}</a>}
              {q.file && <a href={`${fileBase}/${q.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-300 hover:underline"><FileText size={12} /> {q.file.name}</a>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function QuoteFields({ q, onChange, n, input }: { q: QuoteDraft; onChange: (q: QuoteDraft) => void; n?: number; input: string }) {
  const [fileError, setFileError] = useState<string | null>(null);
  const set = (k: keyof QuoteDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...q, [k]: e.target.value });
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_FILE) return setFileError("That file is over 15 MB.");
    onChange({ ...q, file: { dataUrl: await readFile(f), name: f.name } });
  }
  return (
    <div className="space-y-2 rounded-lg border border-edge bg-panel2/30 p-2.5">
      {n != null && <p className="text-xs font-medium text-gray-400">Supplier {n}</p>}
      <div className="grid grid-cols-[1fr_8rem] gap-2">
        <input className={input} placeholder="Supplier" value={q.supplier} onChange={set("supplier")} />
        <input className={input} placeholder="Price ex GST" inputMode="decimal" value={q.priceExGst} onChange={set("priceExGst")} />
      </div>
      <textarea className={input} rows={2} maxLength={2000} placeholder="Details - what's included, delivery, lead time, hire rates..." value={q.details} onChange={set("details")} />
      <input className={input} placeholder="Link to the quote or product (optional)" inputMode="url" value={q.linkUrl} onChange={set("linkUrl")} />
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
        <Paperclip size={15} className="shrink-0 text-gray-500" />
        <span className="truncate">{q.file ? q.file.name : "Attach the quote (PDF or photo, optional)"}</span>
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      </label>
      {fileError && <p className="text-xs text-red-400">{fileError}</p>}
    </div>
  );
}

// A typed quote as the API takes it.
export const quoteBody = (q: QuoteDraft) => ({ supplier: q.supplier, priceExGst: q.priceExGst, details: q.details, linkUrl: q.linkUrl, ...(q.file ? { file: q.file } : {}) });
