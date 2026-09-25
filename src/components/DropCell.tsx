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
}: {
  accepts: BoardColumn;
  assignments: AssignmentDTO[];
  conflicts: Record<string, number>; // resourceId -> other jobs same shift
  onDrop: (payload: DragResourcePayload) => void;
  onRoleChange: (assignmentId: string, role: string) => void;
  onRemove: (assignmentId: string) => void;
  emptyHint: string;
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
      className={`my-1.5 flex min-h-[2.75rem] flex-wrap content-start items-start gap-1.5 rounded-lg p-1.5 ${
        active
          ? "drop-zone-active"
          : empty
          ? "border border-dashed border-edge"
          : "border border-transparent"
      }`}
    >
      {empty && (
        <span className="flex w-full items-center justify-center px-1 py-1.5 text-center text-xs text-gray-500">
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
