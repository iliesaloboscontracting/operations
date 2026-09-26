"use client";

import { useState } from "react";
import { AssignmentDTO, BoardColumn, DragResourcePayload } from "@/lib/types";
import AssignedChip from "./AssignedChip";

export default function DropCell({
  accepts,
  assignments,
  conflicts,
  onDrop,
  onRoleChange,
  onRemove,
  emptyHint,
  compact,
}: {
  accepts: BoardColumn;
  assignments: AssignmentDTO[];
  conflicts: Record<string, number>; // resourceId -> other jobs same shift
  onDrop: (payload: DragResourcePayload) => void;
  onRoleChange: (assignmentId: string, role: string) => void;
  onRemove: (assignmentId: string) => void;
  emptyHint: string;
  // Shrinks the empty state (job has nothing on it yet) so a row of empty
  // jobs takes far less space than one that's actually been allocated.
  compact?: boolean;
}) {
  const [active, setActive] = useState(false);

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
  }

  function onDropHandler(e: React.DragEvent) {
    e.preventDefault();
    setActive(false);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const payload: DragResourcePayload = JSON.parse(raw);
      if (payload.column !== accepts) return; // wrong pool for this column
      onDrop(payload);
    } catch {
      // ignore malformed payloads
    }
  }

  const empty = assignments.length === 0;

  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDropHandler}
      className={`flex flex-wrap content-start items-start gap-1.5 rounded-lg p-1.5 ${
        empty && compact ? "my-0.5 min-h-[1.5rem]" : "my-1.5 min-h-[2.75rem]"
      } ${
        active
          ? "drop-zone-active"
          : empty
          ? "border border-dashed border-edge"
          : "border border-transparent"
      }`}
    >
      {empty && (
        <span
          className={`flex w-full items-center justify-center text-center text-gray-500 ${
            compact ? "px-1 py-0 text-[10px]" : "px-1 py-1.5 text-xs"
          }`}
        >
          {emptyHint}
        </span>
      )}
      {assignments.map((a) => (
        <AssignedChip
          key={a.id}
          assignment={a}
          conflict={conflicts[a.resourceId] ?? 0}
          onRoleChange={(role) => onRoleChange(a.id, role)}
          onRemove={() => onRemove(a.id)}
        />
      ))}
    </div>
  );
}
