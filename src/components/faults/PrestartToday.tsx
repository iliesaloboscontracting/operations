"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ClipboardCheck, Tractor, Truck } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import type { PrestartTodayCard, CardRow } from "@/lib/prestart/today";

// "Pre-starts today" (Ilies, 23 Nov 2026: "yes do 1 and 2") - a compact card on the Allocations board, the first page an
// Admin sees: each truck signed in today and each owned machine with a QR sticker or booked today, with Done / Pre-start
// not done / Fault / Post-check done, the counts, and how many machines still have no sticker. A row opens the Checks tab
// on that day and row, where the photos are. Always today (whatever day the board shows). The route refuses anyone who
// can't see the Checks tab (guardFaults), so pass `enabled`. Words only - no money.
const KEY = "lobos-prestart-card"; // "closed" = folded away on this computer (a convenience only)
const TONE: Record<CardRow["status"], string> = {
  NOT_DONE: "border-red-500/60 bg-red-500/15 text-red-200",
  FAULT: "border-amber-500/60 bg-amber-500/15 text-amber-200",
  POST_DONE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  DONE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};

export default function PrestartToday({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<PrestartTodayCard | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(KEY) === "closed") setOpen(false); } catch { /* no storage - stays open */ } }, []);
  const load = useCallback(() => {
    if (!enabled) return;
    apiFetch("/api/faults/today").then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => undefined);
  }, [enabled]);
  useEffect(load, [load]);
  useAutoRefresh(load);
  if (!enabled || !data) return null;
  const toggle = () => { const next = !open; setOpen(next); try { localStorage.setItem(KEY, next ? "open" : "closed"); } catch { /* fine */ } };
  const t = data.counts.trucks, m = data.counts.machines;
  return (
    <section className="rounded-xl border border-edge bg-panel px-3 py-2" data-testid="prestart-today" aria-label="Pre-starts today">
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm" aria-expanded={open}>
        {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
        <span className="flex items-center gap-1.5 font-semibold text-gray-100"><ClipboardCheck size={15} /> Pre-starts today</span>
        <span className="text-gray-300">
          <Truck size={13} className="mr-1 inline text-gray-500" />Trucks {t.done} of {t.total} done
          {t.notDone > 0 && <span className="ml-1 font-semibold text-red-300">· {t.notDone} not done</span>}
          {t.faults > 0 && <span className="ml-1 text-amber-300">· {t.faults} with a fault</span>}
        </span>
        <span className="text-gray-300">
          <Tractor size={13} className="mr-1 inline text-gray-500" />Machines {m.done} of {m.total} done
          {m.notDone > 0 && <span className="ml-1 font-semibold text-red-300">· {m.notDone} no pre-start</span>}
          {m.faults > 0 && <span className="ml-1 text-amber-300">· {m.faults} with a fault</span>}
        </span>
        {data.noStickerText && <span className="text-xs text-gray-500">{data.noStickerText}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-5">
          <Rows icon={<Truck size={13} />} empty="No truck sign-ins yet today." rows={data.trucks} />
          <Rows icon={<Tractor size={13} />} empty="No machines with a sticker or booked today." rows={data.machines} />
        </div>
      )}
    </section>
  );
}

function Rows({ icon, rows, empty }: { icon: React.ReactNode; rows: CardRow[]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-gray-500">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <Link key={r.id} href={r.href} title={[r.note, r.worstLabel && r.status !== "FAULT" ? `Open fault: ${r.worstLabel}` : null, "Open on the Checks tab"].filter(Boolean).join(" · ")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${r.needed ? TONE[r.status] : "border-edge bg-panel2 text-gray-400"} hover:brightness-125`}>
          <span className="text-gray-400">{icon}</span>
          <span className="font-medium">{r.name}</span>
          <span>· {r.label}</span>
          {r.worst && r.status !== "FAULT" && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-200">{r.worstLabel}</span>}
          {r.note && !r.needed && <span className="text-[10px] text-gray-500">({r.note})</span>}
        </Link>
      ))}
    </div>
  );
}
