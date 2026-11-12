"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import PlantHistoryView from "@/components/plant/PlantHistoryView";

// The Plant page's machine detail (12 Nov 2026): the same checks & service history the machine's QR shows - pre-start
// records and the download - for Managers and Admins. Folded until opened, so the detail stays small.
export default function PlantHistoryPanel({ machine }: { machine: { id: string; type: string } }) {
  const { canEdit } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canEdit || machine.type !== "EQUIPMENT") return null;
  return (
    <div className="mt-3 rounded-xl border border-edge bg-panel p-3 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="flex flex-1 items-center gap-1.5 font-semibold text-gray-200"><ClipboardList size={14} /> Pre-start records</span>
        <button type="button" className="rounded-lg border border-edge px-2.5 py-1 text-gray-300 hover:bg-panel2" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </div>
      {!open ? (
        <p className="mt-1 text-gray-500">Pre-starts, post-checks and service history - what site managers see on the QR. Download as PDF or CSV.</p>
      ) : (
        <div className="mt-2"><PlantHistoryView src={`/api/plant/${encodeURIComponent(machine.id)}/history`} compact /></div>
      )}
    </div>
  );
}
