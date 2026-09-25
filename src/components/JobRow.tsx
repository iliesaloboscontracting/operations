"use client";

import { TriangleAlert } from "lucide-react";
import { DragResourcePayload, JobDTO } from "@/lib/types";
import { columnFor, money } from "@/lib/resource";
import DropCell from "./DropCell";
import { GRID_COLS } from "./JobGridHeader";
import { ShiftBadge } from "./ShiftBadge";
import JobStatusBadge from "./JobStatusBadge";

export default function JobRow({
  job,
  conflicts,
  onAssign,
  onRoleChange,
  onRemove,
  onEdit,
}: {
  job: JobDTO;
  conflicts: Record<string, number>;
  onAssign: (jobId: string, payload: DragResourcePayload) => void;
  onRoleChange: (assignmentId: string, role: string) => void;
  onRemove: (assignmentId: string) => void;
  onEdit: (job: JobDTO) => void;
}) {
  const by = (c: "crew" | "plant" | "hire") =>
    job.assignments.filter((a) => columnFor(a.resource) === c);
  const crew = by("crew");
  const plant = by("plant");
  const hire = by("hire");

  const hasSupervisor = crew.some(
    (a) => a.role === "Supervisor" || a.role === "Lead"
  );
  const needsSupervisor = !job.notRunning && !hasSupervisor;

  // What today's allocation costs, from each item's daily rate (cost code).
  const dailyCost = job.assignments.reduce((n, a) => n + (a.resource.dailyRateExGst ?? 0), 0);

  return (
    <div
      className={`grid ${GRID_COLS} gap-2 border-b border-edge/70 last:border-b-0 ${
        job.notRunning ? "opacity-60" : ""
      }`}
    >
      {/* Site */}
      <button
        onClick={() => onEdit(job)}
        className="flex gap-2.5 py-3 pl-3 text-left hover:bg-panel2/50"
        title="Edit job"
      >
        <div className="w-1 shrink-0 rounded-full bg-brand-600" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-100">
            {job.title}
          </div>
          {job.client && (
            <div className="truncate text-[11px] text-gray-500">{job.client}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
            {job.siteCode && <span className="text-gray-400">{job.siteCode}</span>}
            <ShiftBadge shift={job.shift} />
            <JobStatusBadge status={job.status} />
            {(job.startTime || job.endTime) && (
              <span>
                {job.startTime ?? "?"} - {job.endTime ?? "?"}
              </span>
            )}
          </div>
          {needsSupervisor && (
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-400">
              <TriangleAlert size={11} className="shrink-0" />
              No supervisor
            </div>
          )}
          {dailyCost > 0 && (
            <div
              className="mt-1 text-[11px] text-gray-500"
              title="Plant, attachments, vehicles and hire allocated to this shift, at their daily rate"
            >
              {money(dailyCost)}<span className="text-gray-400">/day ex GST</span>
            </div>
          )}
        </div>
      </button>

      {/* Day brief */}
      <div className="py-3 pr-2 text-sm text-gray-300">
        {job.dayBrief || <span className="text-gray-500">—</span>}
      </div>

      <DropCell
        accepts="crew"
        assignments={crew}
        conflicts={conflicts}
        onDrop={(p) => onAssign(job.id, p)}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        emptyHint="Drag crew here"
      />
      <DropCell
        accepts="plant"
        assignments={plant}
        conflicts={conflicts}
        onDrop={(p) => onAssign(job.id, p)}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        emptyHint="Drag plant, attachments, vehicles"
      />
      <DropCell
        accepts="hire"
        assignments={hire}
        conflicts={conflicts}
        onDrop={(p) => onAssign(job.id, p)}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        emptyHint="Drag hire here"
      />
    </div>
  );
}
