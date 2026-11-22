"use client";

import { X } from "lucide-react";
import { AssignmentDTO, DragResourcePayload } from "@/lib/types";
import { columnFor, CREW_ROLE_OPTIONS, isLabourHire } from "@/lib/resource";
import HireTag from "./HireTag";
import { TicketFlagBadge } from "./compliance/TicketFlags";
import { FaultFlagBadge } from "./faults/FaultFlags";
import DayLimitTag from "./board/DayLimitTag";
import FullTimeMark from "./board/FullTimeMark";
import { CHIP_ROLE_TEXT, CHIP_TONE, chipKind, withFullTimeTitle } from "@/lib/fullTime";

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

  const labourHire = isLabourHire(r);
  // Full-timers (22 Nov 2026) are orange instead of blue - lib/fullTime has every tile's colours.
  const kind = chipKind(r, { column, supervisorLike: isSupervisorLike, labourHire });
  const fullTime = kind === "fullTime" || kind === "fullTimeLead";
  const tone = CHIP_TONE[kind];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={withFullTimeTitle(
        conflict > 0
          ? `Also on ${conflict} other job${conflict > 1 ? "s" : ""} this shift`
          : "Drag to move to another job",
        fullTime
      )}
      className={`flex cursor-grab items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-xs active:cursor-grabbing ${tone} ${
        conflict > 0 ? "ring-2 ring-amber-400" : ""
      }`}
    >
      <span className="max-w-[8rem] truncate">{r.name}</span>
      {fullTime && <FullTimeMark />}
      {/* Labour hire: who signed in with the QR to fill this tile. */}
      {labourHire && assignment.signedInAs && (
        <span className="max-w-[9rem] truncate text-[10px] text-yellow-200/80" title={`Signed in: ${assignment.signedInAs}`}>
          ✓ {assignment.signedInAs}
        </span>
      )}
      {/* Hired plant / equipment / tools: who it's from and when it's due back. */}
      {column === "hire" && <HireTag resource={r} className="max-w-[9rem]" />}
      {isCrew && <TicketFlagBadge resourceId={r.id} />}
      {isCrew && <DayLimitTag limit={r.maxDaysPerWeek} />}
      {!isCrew && <FaultFlagBadge resourceId={r.id} />}
      {conflict > 0 && <span className="text-amber-300">⚠</span>}
      {isCrew && (
        <select
          value={assignment.role ?? ""}
          onChange={(e) => onRoleChange(e.target.value)}
          className={`rounded bg-transparent text-[10px] outline-none ${CHIP_ROLE_TEXT[kind]}`}
        >
          <option value="">-</option>
          {CREW_ROLE_OPTIONS.map((o) => (
            <option key={o} value={o} className="text-black">
              {o}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={onRemove}
        className="ml-0.5 shrink-0 rounded-full p-0.5 leading-none opacity-60 hover:bg-black/10 hover:opacity-100"
        title="Remove"
      >
        <X size={11} strokeWidth={2.5} />
      </button>
    </div>
  );
}
