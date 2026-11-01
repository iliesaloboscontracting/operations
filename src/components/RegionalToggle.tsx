"use client";

import { useEffect, useState } from "react";
import { MapPinned } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

// Regional jobs (2 Nov 2026, Ilies: "jobs identify as regional on the board ... a button that identifies them as
// regional; or not"). The flag is the PROJECT's, so it applies to every day of that project; its crew then get
// travel sign-in on their phones. Everyone sees the "Regional" badge; Managers and Admins can switch it (the server
// checks that too - PATCH /api/projects/:id is Manager+). Switching it off never removes a travel leg.
export function RegionalBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300 ring-1 ring-sky-500/40">
      <MapPinned size={10} aria-hidden /> Regional
    </span>
  );
}

export default function RegionalToggle({
  projectId, projectName, regional, onChanged, size = "sm",
}: { projectId: string | null; projectName: string; regional: boolean; onChanged?: (regional: boolean) => void; size?: "sm" | "md" }) {
  const { canEdit } = useAuth();
  const [on, setOn] = useState(regional);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(regional), [regional]);
  if (!projectId) return on ? <RegionalBadge /> : null;
  if (!canEdit) return on ? <RegionalBadge /> : null;

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation(); // on the board this sits inside the row's "edit job" button
    const next = !on;
    if (!window.confirm(next
      ? `Mark ${projectName} as regional? Its crew get travel sign-in on their phones, every day of this project.`
      : `Mark ${projectName} as local (not regional)? Travel sign-in stops being offered for it. Travel already recorded is kept.`)) return;
    setBusy(true);
    const res = await apiFetch(`/api/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regional: next }) });
    setBusy(false);
    if (!res.ok) return window.alert(await serverErrorMessage(res, "Couldn't change it."));
    setOn(next);
    onChanged?.(next);
  }

  const title = `Applies to every day of ${projectName}. ${on ? "Click to mark it local." : "Regional jobs get travel sign-in."}`;
  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={on}
      aria-disabled={busy}
      title={title}
      onClick={busy ? undefined : toggle}
      onKeyDown={(e) => { if (!busy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(e as unknown as React.MouseEvent); } }}
      className={`inline-flex cursor-pointer items-center gap-0.5 rounded font-semibold uppercase tracking-wide ${pad} ${
        on ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40 hover:bg-sky-500/25" : "text-gray-500 ring-1 ring-edge hover:text-gray-300"
      } ${busy ? "opacity-50" : ""}`}
    >
      <MapPinned size={size === "md" ? 12 : 10} aria-hidden /> {on ? "Regional ✓" : "Mark regional"}
    </span>
  );
}
