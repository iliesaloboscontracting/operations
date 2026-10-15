"use client";

import { DragResourcePayload, ResourceDTO } from "@/lib/types";
import { columnFor, CREW_ROLE_OPTIONS, isLabourHire } from "@/lib/resource";

// Tiles for these two roles stand out from the rest of the crew list at a
// glance, same idea as a supervisor/lead being flagged on an assigned job chip.
const HIGHLIGHT_ROLES = new Set(["Supervisor", "Lead"]);

// A single draggable resource in the sidebar pool. Only resources not already
// assigned to a job today are shown here (see ResourceSidebar), so a drag always
// moves a fresh item onto a job rather than creating a duplicate.
export default function ResourceCard({
  resource,
  onRoleChange,
}: {
  resource: ResourceDTO;
  // Present (and the role becomes an editable dropdown right on the card) only
  // for crew-type resources when the viewer can edit; other resource kinds keep
  // the plain read-only sub-label since their `role` means something else
  // (e.g. "Vehicle"/"Plant" as a kind tag, not a job-site trade).
  onRoleChange?: (resourceId: string, role: string) => void;
}) {
  const down = resource.status === "DOWN" || resource.status === "LEAVE";
  const isCrew = columnFor(resource) === "crew";

  function onDragStart(e: React.DragEvent) {
    const payload: DragResourcePayload = {
      resourceId: resource.id,
      resourceName: resource.name,
      column: columnFor(resource),
    };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  }

  const editableRole = isCrew && onRoleChange;
  const highlighted = editableRole && !!resource.role && HIGHLIGHT_ROLES.has(resource.role);
  const sub = resource.role ?? resource.detail;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`flex cursor-grab items-center justify-between gap-2 rounded-lg border px-2 py-1 text-sm active:cursor-grabbing ${
        isLabourHire(resource)
          ? "border-yellow-400 bg-yellow-400/20 font-medium text-yellow-100"
          : highlighted
          ? "border-brand-500/50 bg-brand-500/10"
          : "border-edge bg-panel2"
      } ${down ? "opacity-50" : ""}`}
      title={resource.detail ?? resource.role ?? undefined}
    >
      <span className="min-w-0 flex-1 truncate">{resource.name}</span>
      <div className="flex shrink-0 items-center gap-1">
        {down && (
          <span className="shrink-0 rounded-full bg-red-900/70 px-1.5 py-0.5 text-[10px] uppercase text-red-200">
            {resource.status === "DOWN" ? "down" : "leave"}
          </span>
        )}
        {editableRole && !down ? (
          <select
            value={resource.role ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRoleChange(resource.id, e.target.value)}
            className={`max-w-[6.5rem] shrink-0 rounded-full border-0 py-0.5 pl-1.5 pr-4 text-[10px] font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
              highlighted ? "bg-brand-600 text-white" : "bg-gray-700 text-gray-300"
            }`}
          >
            <option value="">No role set</option>
            {CREW_ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          sub &&
          !down && (
            <span className="max-w-[6rem] shrink-0 truncate rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
              {sub}
            </span>
          )
        )}
      </div>
    </div>
  );
}
