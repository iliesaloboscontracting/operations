"use client";

import { DragResourcePayload, ResourceDTO } from "@/lib/types";
import { columnFor } from "@/lib/resource";

// A single draggable resource in the sidebar pool. Only resources not already
// assigned to a job today are shown here (see ResourceSidebar), so a drag always
// moves a fresh item onto a job rather than creating a duplicate.
export default function ResourceCard({ resource }: { resource: ResourceDTO }) {
  const down = resource.status === "DOWN" || resource.status === "LEAVE";

  function onDragStart(e: React.DragEvent) {
    const payload: DragResourcePayload = {
      resourceId: resource.id,
      resourceName: resource.name,
      column: columnFor(resource),
    };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  }

  const sub = resource.role ?? resource.detail;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`flex cursor-grab items-center justify-between gap-2 rounded-md border border-edge bg-panel2 px-2 py-1 text-sm active:cursor-grabbing ${
        down ? "opacity-50" : ""
      }`}
      title={resource.detail ?? resource.role ?? undefined}
    >
      <span className="min-w-0 flex-1 truncate">{resource.name}</span>
      <div className="flex items-center gap-1">
        {down && (
          <span className="shrink-0 rounded bg-red-900/70 px-1.5 py-0.5 text-[10px] uppercase text-red-200">
            {resource.status === "DOWN" ? "down" : "leave"}
          </span>
        )}
        {sub && !down && (
          <span className="max-w-[6rem] shrink-0 truncate rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
