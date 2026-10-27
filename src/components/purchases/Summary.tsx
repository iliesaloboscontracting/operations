"use client";

import { money } from "@/lib/resource";
import MessageAbout from "@/components/messages/MessageAbout";

// One purchase request as accounts and the directors see it (stage 6) - amount included. Never used on a link.
export type PurchaseDTO = {
  id: string; ref: string; what: string; why: string | null; qty: string | null; supplier: string | null; linkUrl: string | null; neededBy: string | null;
  status: string; statusText: string; infoQuestion: string | null; infoAnswer: string | null; decisionNote: string | null; requestedBy: string; createdAt: string;
  version: number; projectName: string | null; source: string; amountExGst: number | null; accountsNote: string | null; checkedBy: string | null;
  decidedBy: string | null; orderedBy: string | null; closedReason: string | null; cannotDecide?: string | null;
  events: { action: string; status: string; by: string; at: string; note: string | null }[];
};

const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const when = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

export default function Summary({ r, children }: { r: PurchaseDTO; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">{r.ref}</span>
        <span className="font-medium text-gray-100">{r.what}</span>
        {r.amountExGst != null && <span className="text-sm font-semibold text-gray-100">{money(r.amountExGst)} ex GST</span>}
        <span className="ml-auto rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-gray-300">{r.statusText}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {[`Asked by ${r.requestedBy}${r.source === "LINK" ? " (from their link)" : ""} ${when(r.createdAt)}`, r.qty && `${r.qty} off`, r.supplier, r.projectName, r.neededBy && `needed by ${dmy(r.neededBy)}`].filter(Boolean).join(" · ")}
      </p>
      {r.why && <p className="mt-1 text-sm text-gray-400">{r.why}</p>}
      {r.linkUrl && <a href={r.linkUrl} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-xs text-brand-300 hover:underline">{r.linkUrl}</a>}
      {r.infoQuestion && <p className="mt-1 text-sm text-amber-200">Asked: {r.infoQuestion}{r.infoAnswer ? <span className="text-gray-300"> - Answer: {r.infoAnswer}</span> : null}</p>}
      {r.accountsNote && <p className="mt-1 text-sm text-gray-300">Accounts: {r.accountsNote}</p>}
      {r.decisionNote && <p className="mt-1 text-sm text-gray-300">Director: {r.decisionNote}</p>}
      {r.closedReason && <p className="mt-1 text-sm text-gray-400">Closed: {r.closedReason}</p>}
      {children}
      <div className="mt-2"><MessageAbout type="PURCHASE" subjectKey={r.id} label={r.ref} /></div>
      <details className="mt-2 text-xs text-gray-500">
        <summary className="cursor-pointer">History</summary>
        {r.events.map((e, i) => <p key={i}>{when(e.at)} · {e.by} · {e.action.toLowerCase().replace("_", " ")}{e.note ? ` - ${e.note}` : ""}</p>)}
      </details>
    </div>
  );
}
