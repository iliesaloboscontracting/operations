"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CalendarJobDTO } from "@/lib/types";
import { fmtDay } from "@/lib/dates";
import { useAuth } from "./AuthProvider";
import { ShiftBadge } from "./ShiftBadge";

const PLANT_KIND: Record<string, string> = {
  EQUIPMENT: "Plant",
  ATTACHMENT: "Attachment",
  VEHICLE: "Vehicle",
};

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label} <span className="text-gray-600">· {count}</span>
      </div>
      {count === 0 ? <div className="text-xs text-gray-600">None allocated</div> : children}
    </div>
  );
}

function JobCard({ job }: { job: CalendarJobDTO }) {
  const allocated = job.crew + job.plant + job.hire;
  const flags: { text: string; tone: string }[] = [];
  if (job.notRunning) flags.push({ text: "Not running this day", tone: "bg-gray-700 text-gray-300" });
  else if (allocated === 0) flags.push({ text: "Nothing allocated yet", tone: "bg-gray-700 text-gray-300" });
  else if (job.crew === 0) flags.push({ text: "No crew assigned", tone: "bg-amber-900/60 text-amber-300" });
  else if (!job.hasSupervisor) flags.push({ text: "No supervisor", tone: "bg-red-900/60 text-red-300" });

  return (
    <div className="rounded-xl border border-edge bg-panel p-3.5 shadow-soft">
      <div className="flex items-center gap-2">
        <ShiftBadge shift={job.shift} className="shrink-0 py-0.5 text-[10px] uppercase" />
        {(job.startTime || job.endTime) && (
          <span className="text-sm text-gray-300">
            {job.startTime ?? "?"} – {job.endTime ?? "?"}
          </span>
        )}
        {flags.map((f) => (
          <span key={f.text} className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${f.tone}`}>
            {f.text}
          </span>
        ))}
      </div>

      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Day brief</div>
      <div className="text-sm text-gray-200">{job.dayBrief || <span className="text-gray-600">No brief entered</span>}</div>

      <Section label="Crew" count={job.crewList.length}>
        <div className="grid gap-1 sm:grid-cols-2">
          {job.crewList.map((c, i) => (
            <div key={`${c.name}-${i}`} className="flex items-center justify-between gap-2 rounded bg-panel2 px-2 py-1 text-sm">
              <span className="truncate text-gray-100">{c.name}</span>
              {c.role && (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    c.role === "Supervisor" || c.role === "Lead" ? "bg-brand-600 text-white" : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {c.role}
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section label="Plant & vehicles" count={job.plantList.length}>
        <div className="grid gap-1 sm:grid-cols-2">
          {job.plantList.map((p, i) => (
            <div key={`${p.name}-${i}`} className="flex items-center justify-between gap-2 rounded bg-panel2 px-2 py-1 text-sm">
              <span className="truncate text-gray-100">{p.name}</span>
              <span className="shrink-0 rounded bg-orange-900/50 px-1.5 py-0.5 text-[10px] text-orange-300">
                {PLANT_KIND[p.type] ?? p.type}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Hire" count={job.hireList.length}>
        <div className="grid gap-1 sm:grid-cols-2">
          {job.hireList.map((h, i) => (
            <div key={`${h.name}-${i}`} className="flex items-center justify-between gap-2 rounded bg-panel2 px-2 py-1 text-sm">
              <span className="truncate text-gray-100">{h.name}</span>
              {h.agency && <span className="shrink-0 text-[11px] text-gray-500">{h.agency}</span>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// Details for one project on one day (all its shifts), plus a way to add a job here
// if there's nothing scheduled yet (or another shift is needed). Opened from the calendar.
export default function JobDetailsModal({
  title,
  jobNo,
  date,
  startsThisDay,
  jobs,
  onClose,
  onAddJob,
}: {
  title: string;
  jobNo: string | null;
  date: string;
  startsThisDay: boolean;
  jobs: CalendarJobDTO[];
  onClose: () => void;
  onAddJob?: () => void;
}) {
  const { canEdit } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ordered = [...jobs].sort((a, b) => (a.shift === b.shift ? 0 : a.shift === "DAY" ? -1 : 1));

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} on ${date}`}
    >
      <div
        className="animate-modal-in flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-edge bg-canvas shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-edge px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-gray-100">{title}</div>
            <div className="text-xs text-gray-500">
              {jobNo && `${jobNo} · `}
              {fmtDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            {startsThisDay && (
              <span className="mt-1 inline-block rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                ▶ Project starts this day
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-xl leading-none text-gray-500 hover:text-gray-200" title="Close (Esc)">
            &times;
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
          {ordered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-gray-500">
              Nothing is scheduled for this project on this day.
              {canEdit && onAddJob && (
                <div className="mt-3">
                  <button
                    onClick={onAddJob}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
                  >
                    + Add a job for this day
                  </button>
                </div>
              )}
            </div>
          ) : (
            ordered.map((j) => <JobCard key={j.id} job={j} />)
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-edge px-4 py-3">
          <Link
            href={`/command?date=${date}`}
            className="text-sm font-medium text-brand-500 hover:text-brand-400"
          >
            {canEdit ? "Edit in Command Centre →" : "View in Command Centre →"}
          </Link>
          <div className="flex gap-2">
            {canEdit && onAddJob && ordered.length > 0 && (
              <button
                onClick={onAddJob}
                className="rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2"
              >
                + Add another job
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
