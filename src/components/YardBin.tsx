"use client";

import { useState } from "react";
import { DragResourcePayload } from "@/lib/types";

// A permanent drop target pinned at the bottom of The Yard - not a floating overlay,
// it sits in the panel's own layout so it never drifts over other controls. Accepts
// only Yard-native cards (no assignmentId), so dragging a chip that's already on a
// job here does nothing; unassigning still happens by dropping on the Yard itself.
export default function YardBin({
  onDelete,
}: {
  onDelete: (resourceId: string, name: string) => void;
}) {
  const [active, setActive] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setActive(false);
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const payload: DragResourcePayload = JSON.parse(raw);
      if (payload.assignmentId) return; // that's a job chip, not a Yard item
      onDelete(payload.resourceId, payload.resourceName);
    } catch {
      // ignore malformed payloads
    }
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
      onDrop={onDrop}
      title="Drag an item from the Yard here to remove it from inventory"
      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-dashed px-2 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-red-500 bg-red-950/40 text-red-300"
          : "border-edge text-gray-500 hover:border-red-500/50 hover:text-red-400"
      }`}
    >
      <span aria-hidden>🗑️</span>
      Drag here to remove from inventory
    </div>
  );
}
