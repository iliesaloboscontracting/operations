"use client";

import { TriangleAlert } from "lucide-react";
import { DragResourcePayload, JobDTO } from "@/lib/types";
import { columnFor, roleRank } from "@/lib/resource";
import DropCell from "./DropCell";
import { GRID_COLS } from "./JobGridHeader";
import { ShiftBadge } from "./ShiftBadge";
import JobStatusBadge from "./JobStatusBadge";
import RegionalToggle from "./RegionalToggle";
import { fmtDay } from "@/lib/dates";

export default function JobRow({
  job,
  conflicts,
  onAssign,
  onRoleChange,
  onRemove,
  onEdit,
  onAttach,
}: {
  job: JobDTO;
  conflicts: Record<string, number>;
  onAssign: (jobId: string, payload: DragResourcePayload) => void;
  onRoleChange: (assignmentId: string, role: string) => void;
  onRemove: (assignmentId: string) => void;
  onEdit: (job: JobDTO) => void;
  onAttach?: (job: JobDTO) => void; // Managers / Admins: a job with no project (18 Nov 2026)
}) {
  const by = (c: "crew" | "plant" | "hire") =>
    job.assignments.filter((a) => columnFor(a.resource) === c);
  // Crew is shown top tier to bottom (Supervisor first) once assigned, rather
  // than in drag order - stable sort keeps same-tier people in the order they
  // were added.
  const crew = by("crew").slice().sort((a, b) => roleRank(a.role) - roleRank(b.role));
  const plant = by("plant");
  const hire = by("hire");

  const hasSupervisor = crew.some(
    (a) => a.role === "Supervisor" || a.role === "Lead"
  );
  // Nothing to warn about on a job that has nothing on it at all yet - the
  // warning earns its place once there's at least someone here to be missing
  // a supervisor.
  const allocated = job.assignments.length > 0;
  const needsSupervisor = !job.notRunning && !job.virtual && allocated && !hasSupervisor;

  return (
    <div
      className={`grid ${GRID_COLS} gap-2 border-b border-edge/70 last:border-b-0 ${
        job.notRunning ? "opacity-60" : ""
      }`}
    >
      {/* Site */}
      <button
        onClick={() => onEdit(job)}
        className={`flex gap-2.5 pl-3 text-left hover:bg-panel2/50 ${allocated ? "py-3" : "py-1.5"}`}
        title={job.virtual ? "Not scheduled yet - click to add today's job" : "Edit job"}
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
            {/* Regional (2 Nov 2026): the project's flag - badge for everyone, switch for Managers / Admins. */}
            <RegionalToggle projectId={job.projectId} projectName={job.title} regional={!!job.regional} />
            {(job.startTime || job.endTime) && (
              <span>
                {job.startTime ?? "?"} - {job.endTime ?? "?"}
              </span>
            )}
          </div>
          {job.virtual && (
            <div className="mt-1 text-[11px] italic text-gray-500">
              {job.startsOn ? `Starts ${fmtDay(job.startsOn, { day: "numeric", month: "short" })}` : "Not scheduled yet"}
            </div>
          )}
          {/* 18 Nov 2026: a job whose project is Completed, or with no project at all, says so. */}
          {!job.virtual && job.projectStatus === "COMPLETED" && (
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-blue-500" title="This job's project is marked Completed - stand the project down or set it Active again if work is still going.">
              <TriangleAlert size={11} className="shrink-0" />
              Project completed
            </div>
          )}
          {!job.virtual && !job.projectId && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-amber-500">
              <TriangleAlert size={11} className="shrink-0" />
              Not linked to a project
              {onAttach && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onAttach(job); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onAttach(job); } }}
                  className="rounded border border-amber-500/40 px-1.5 py-0.5 text-amber-400 hover:bg-amber-500/10"
                >
                  Attach to project
                </span>
              )}
            </div>
          )}
          {job.noSignInWay && (
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-400" title="Crew are on this job but nobody on it has a supervisor link, there is no hand-over and no site poster - nobody can sign in.">
              <TriangleAlert size={11} className="shrink-0" />
              No way to sign in
            </div>
          )}
          {needsSupervisor && (
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-400">
              <TriangleAlert size={11} className="shrink-0" />
              No supervisor
            </div>
          )}
        </div>
      </button>

      {/* Day brief */}
      <div className={`pr-2 text-sm text-gray-300 ${allocated ? "py-3" : "truncate py-1.5"}`}>
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
        compact={!allocated}
      />
      <DropCell
        accepts="plant"
        assignments={plant}
        conflicts={conflicts}
        onDrop={(p) => onAssign(job.id, p)}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        emptyHint="Drag plant, attachments, vehicles"
        compact={!allocated}
      />
      <DropCell
        accepts="hire"
        assignments={hire}
        conflicts={conflicts}
        onDrop={(p) => onAssign(job.id, p)}
        onRoleChange={onRoleChange}
        onRemove={onRemove}
        emptyHint="Drag hire here"
        compact={!allocated}
      />
    </div>
  );
}
