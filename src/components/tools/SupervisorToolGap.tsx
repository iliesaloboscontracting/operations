"use client";

// The empty-toolbox gap (Ilies, 27 Nov 2026: "Shows the empty-toolbox gap to the office too"): active supervisors with
// no tools in any toolbox. They can still report a fault (any Lobos tool, or "Not in the list"), but their own toolbox
// list on the link is empty. Information only - Managers and Admins (/api/tools/supervisor-gaps); for anyone else the
// route says no and nothing shows.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { gapLine, type GapRow } from "@/lib/toolFaults";

export default function SupervisorToolGap() {
  const [rows, setRows] = useState<GapRow[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    apiFetch("/api/tools/supervisor-gaps")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRows(j?.supervisors ?? null))
      .catch(() => setRows(null));
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-edge bg-panel px-4 py-2.5 text-xs text-gray-400">
      <div className="flex flex-wrap items-center gap-2">
        <Info size={14} className="text-brand-300" />
        <span className="text-gray-200">
          {rows.length} supervisor{rows.length === 1 ? " has" : "s have"} no tools in any toolbox
        </span>
        <span>- they can still report a fault on any tool or send a photo, but their toolbox list is empty.</span>
        <button className="text-brand-300 hover:underline" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show who"}</button>
      </div>
      {open && (
        <ul className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => <li key={r.id} className="text-gray-300">{gapLine(r)}</li>)}
          <li className="text-gray-500 sm:col-span-2 lg:col-span-3">
            Put their tools in a toolbox on <Link href="/tools/toolboxes" className="text-brand-300 hover:underline">Toolboxes</Link>.
          </li>
        </ul>
      )}
    </div>
  );
}
