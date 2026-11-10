"use client";

// "History" (keep forever, Ilies 10 Nov 2026): a small link that opens a record's change history - when, who, which
// field, before -> after, and why when one was given. The server (/api/history) applies the same role and money walls as
// the record itself, so a field the viewer can't see on the record never shows here either. Read-only.
import { useState } from "react";
import { History, X } from "lucide-react";
import type { HistoryModel } from "@/lib/history/diff";

type Change = { id: string; field: string; before: string | null; after: string | null; by: string; at: string; source: string | null; reason: string | null };

// Field names in plain words where the code name isn't obvious.
const LABEL: Record<string, string> = {
  dailyRateExGst: "Day rate (ex GST)", hireRate: "Hire rate", hireRateUnit: "Hire rate per", ordinaryRate: "Ordinary rate", nightRate: "Night rate",
  saturdayRate: "Saturday rate", sundayRate: "Sunday rate", travelRate: "Travel rate", regionalDayRate: "Regional day rate", regionalNightRate: "Regional night rate",
  annualSalary: "Salary", payRateBasis: "Pay basis", payRateConfirmed: "Pay rate confirmed", payRateNotes: "Pay notes", contractValue: "Contract value",
  contractValueNotes: "Contract value notes", jobNo: "Job number", quoteNo: "Quote number", offHireDate: "Expected finish", onHireDate: "On hire",
  offHiredOn: "Off-hired on", hireStatus: "Hire status", dayBrief: "Day brief", startTime: "Start", endTime: "Finish", amountExGst: "Amount (ex GST)",
  totalIncGst: "Total (inc GST)", weekEnding: "Week ending", removedAt: "Removed", removedBy: "Removed by", removeReason: "Why removed",
  cancelledAt: "Cancelled", cancelledBy: "Cancelled by", cancelReason: "Why cancelled", retiredAt: "Retired", retiredBy: "Retired by",
  retireReason: "Why retired", heldBy: "Held by", actualHours: "Hours", hoursSource: "Hours from", reopenReason: "Why re-opened",
};
const label = (f: string) => LABEL[f] ?? f.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const show = (v: string | null) => (v == null || v === "" ? "—" : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? when(v) : v);

export default function HistoryButton({ model, id, className }: { model: HistoryModel; id: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    setRows(null);
    setError(null);
    const res = await fetch(`/api/history?model=${encodeURIComponent(model)}&id=${encodeURIComponent(id)}`);
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Couldn't load the history.");
      return;
    }
    setRows((await res.json()).changes ?? []);
  }

  return (
    <>
      <button
        type="button"
        onClick={load}
        className={className ?? "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-400 hover:bg-panel2 hover:text-gray-200"}
        title="Every change to this record - who, when, before and after"
      >
        <History size={13} /> History
      </button>
      {open && (
        <div className="animate-overlay-in fixed inset-0 z-[60] flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            className="h-full w-full max-w-md overflow-y-auto border-l border-edge bg-panel p-4 shadow-soft-lg"
            aria-label="Change history"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-100">History</h2>
                <p className="text-xs text-gray-500">Every change, newest first. Nothing here is ever deleted.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {error ? (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            ) : rows === null ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-gray-500">No changes recorded yet. Changes are kept from 10 Nov 2026.</p>
            ) : (
              <ol className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-lg border border-edge bg-panel2/40 p-2.5 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-gray-500">
                      <span>{when(r.at)}</span>
                      <span>{r.by}</span>
                    </div>
                    <div className="mt-1 font-medium text-gray-200">{label(r.field)}</div>
                    <div className="mt-0.5 break-words text-gray-300">
                      <span className="text-gray-500 line-through decoration-gray-600">{show(r.before)}</span>
                      <span className="mx-1.5 text-gray-500">→</span>
                      <span>{show(r.after)}</span>
                    </div>
                    {(r.reason || r.source) && (
                      <div className="mt-1 text-gray-500">
                        {r.reason && <span>Why: {r.reason}</span>}
                        {r.reason && r.source && <span> · </span>}
                        {r.source && <span>{r.source}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
