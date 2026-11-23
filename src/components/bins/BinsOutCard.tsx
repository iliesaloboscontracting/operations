"use client";

// "Bins out" (Ilies, 23 Nov 2026): a compact card of the bins on site now - client's bins (charged to the client, a
// variation, charged per bin) highlighted. On Ilies's board (floating, so the board doesn't move) and on the
// coordinator's dashboard (view only). How many bins, by job - no days and no money. Nothing shows for a login the API refuses.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Container, X } from "lucide-react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import type { BinsSummaryDTO } from "@/lib/bins/store";


export function useBinsSummary() {
  const [data, setData] = useState<BinsSummaryDTO | null>(null);
  const load = useCallback(() => {
    fetch("/api/bins?summary=1").then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null));
  }, []);
  useEffect(load, [load]);
  useAutoRefresh(load);
  return data;
}

function Body({ s }: { s: BinsSummaryDTO }) {
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-200">{s.client} client&apos;s</span>
        <span className="rounded-full bg-panel2 px-2 py-0.5 text-gray-300">{s.ours} ours</span>
      </div>
      {s.warnings.map((w) => (
        <p key={w.size} className="mb-2 flex items-start gap-1.5 text-xs text-amber-300"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w.text}</p>
      ))}
      {s.jobs.length === 0 ? (
        <p className="text-sm text-gray-500">No bins on site.</p>
      ) : (
        <ul className="space-y-1">
          {s.jobs.slice(0, 6).map((j) => (
            <li key={j.projectId} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-gray-200">{j.project}</span>
              <span className="shrink-0 text-xs text-gray-400">
                {j.client > 0 && <span className="font-semibold text-amber-300">{j.client} client&apos;s</span>}
                {j.client > 0 && j.ours > 0 && " · "}
                {j.ours > 0 && `${j.ours} ours`}
              </span>
            </li>
          ))}
          {s.jobs.length > 6 && <li className="text-xs text-gray-500">+ {s.jobs.length - 6} more jobs</li>}
        </ul>
      )}
    </>
  );
}

// floating: a small pill on the full-screen board that opens the card. Otherwise an ordinary card (the coordinator).
export default function BinsOutCard({ floating }: { floating?: boolean }) {
  const s = useBinsSummary();
  const [open, setOpen] = useState(false);
  if (!s) return null;
  if (floating) {
    if (s.out === 0 && s.warnings.length === 0) return null;
    return (
      <div className="fixed bottom-4 left-4 z-40">
        {open ? (
          <div className="w-80 rounded-xl border border-edge bg-panel p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <Link href="/bins" className="flex items-center gap-1.5 font-semibold text-gray-100 hover:underline"><Container size={16} /> Bins out ({s.out})</Link>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-200" aria-label="Close"><X size={16} /></button>
            </div>
            <Body s={s} />
            <Link href="/bins" className="mt-2 block text-xs text-brand-300 hover:underline">Open Bins →</Link>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-edge bg-panel/90 px-4 py-2 text-sm font-semibold text-gray-100 shadow-lg backdrop-blur hover:bg-panel2">
            <Container size={16} /> Bins out {s.out}
            {s.client > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-xs font-bold text-black">{s.client} client&apos;s</span>}
            {s.warnings.length > 0 && <AlertTriangle size={14} className="text-amber-300" />}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <Link href="/bins" className="mb-2 flex items-center gap-2 font-semibold text-gray-100 hover:text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400"><Container size={18} /></span>
        Bins out ({s.out})
      </Link>
      <Body s={s} />
    </div>
  );
}
