"use client";

import { AssignmentDTO, DragResourcePayload } from "@/lib/types";
import { columnFor } from "@/lib/resource";

const ROLE_OPTIONS = [
  "Supervisor",
  "Lead",
  "Operator",
  "Driver",
  "General labour",
];

export default function AssignedChip({
  assignment,
  conflict,
  onRoleChange,
  onRemove,
}: {
  assignment: AssignmentDTO;
  conflict: number; // other jobs this resource is on in the same shift
  onRoleChange: (role: string) => void;
  onRemove: () => void;
}) {
  const r = assignment.resource;
  const column = columnFor(r);
  const isCrew = column === "crew";
  const isSupervisorLike =
    isCrew && (assignment.role === "Supervisor" || assignment.role === "Lead");

  function onDragStart(e: React.DragEvent) {
    const payload: DragResourcePayload = {
      resourceId: r.id,
      resourceName: r.name,
      column,
      assignmentId: assignment.id,
    };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  }

  const tone = isSupervisorLike
    ? "bg-blue-600 text-white"
    : column === "plant"
    ? "border border-orange-500/60 bg-orange-950/60 text-orange-200"
    : column === "hire"
    ? "border border-teal-500/60 bg-teal-950/60 text-teal-200"
    : "border border-edge bg-panel2 text-gray-200";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={
        conflict > 0
          ? `Also on ${conflict} other job${conflict > 1 ? "s" : ""} this shift`
          : "Drag to move to another job"
      }
      className={`flex cursor-grab items-center gap-1 rounded-md px-2 py-1 text-xs active:cursor-grabbing ${tone} ${
        conflict > 0 ? "ring-2 ring-amber-400" : ""
      }`}
    >
      <span className="max-w-[8rem] truncate">{r.name}</span>
      {conflict > 0 && <span className="text-amber-300">⚠</span>}
      {isCrew && (
        <select
          value={assignment.role ?? ""}
          onChange={(e) => onRoleChange(e.target.value)}
          className={`rounded bg-transparent text-[10px] outline-none ${
            isSupervisorLike ? "text-white" : "text-gray-400"
          }`}
        >
          <option value="">-</option>
          {ROLE_OPTIONS.map((o) => (
            <option key={o} value={o} className="text-black">
              {o}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={onRemove}
        className="ml-0.5 shrink-0 text-[12px] leading-none opacity-60 hover:opacity-100"
        title="Remove"
      >
        &times;
      </button>
    </div>
  );
}
