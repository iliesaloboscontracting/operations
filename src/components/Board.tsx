"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DragResourcePayload,
  JobDTO,
  ProjectDTO,
  ResourceDTO,
} from "@/lib/types";
import { columnFor, localISODate } from "@/lib/resource";
import DateTabs from "./DateTabs";
import ResourceSidebar from "./ResourceSidebar";
import JobGridHeader from "./JobGridHeader";
import JobRow from "./JobRow";
import JobFormModal from "./JobFormModal";
import UpcomingAlerts from "./UpcomingAlerts";
import { useAuth } from "./AuthProvider";
import { addDays } from "@/lib/dates";
import { buildDaySheet } from "@/lib/daySheet";
import DaySheetModal from "./DaySheetModal";
import { apiFetch } from "@/lib/apiFetch";

export default function Board() {
  const [selectedDate, setSelectedDate] = useState(localISODate());

  // Deep link from the Calendar / alerts: /command?date=YYYY-MM-DD
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setSelectedDate(d);
  }, []);
  const [jobs, setJobs] = useState<JobDTO[]>([]);
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<JobDTO | "new" | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Only the newest jobs request may update state, so a slow response for a
  // previously selected date can't overwrite the current one.
  const jobsReq = useRef(0);
  const loadJobs = useCallback(async () => {
    const req = ++jobsReq.current;
    const res = await apiFetch(`/api/jobs?date=${selectedDate}`);
    if (!res.ok) return;
    const data = await res.json();
    if (req === jobsReq.current) setJobs(data);
  }, [selectedDate]);

  const loadResources = useCallback(async () => {
    const res = await apiFetch(`/api/resources`);
    if (res.ok) setResources(await res.json());
  }, []);

  const projectsReq = useRef(0);
  const loadProjects = useCallback(async () => {
    const req = ++projectsReq.current;
    const res = await apiFetch(`/api/projects?date=${selectedDate}`);
    if (!res.ok) return;
    const data = await res.json();
    if (req === projectsReq.current) setProjects(data);
  }, [selectedDate]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadJobs(), loadResources(), loadProjects()]).finally(() =>
      setLoading(false)
    );
  }, [loadJobs, loadResources, loadProjects]);

  const refresh = () => Promise.all([loadJobs(), loadResources()]);

  function fail(text: string) {
    setMessage({ text, error: true });
  }

  // Viewers can look but not change anything (the server enforces this too).
  const { canEdit } = useAuth();
  function viewOnly() {
    if (canEdit) return false;
    fail("You have view-only access, so you can't change the board.");
    return true;
  }

  async function handleAssign(jobId: string, payload: DragResourcePayload) {
    if (viewOnly()) return;
    setMessage(null);
    const res = payload.assignmentId
      ? await fetch(`/api/assignments/${payload.assignmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        })
      : await fetch("/api/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, resourceId: payload.resourceId }),
        });
    if (!res.ok) return fail("Couldn't assign that resource. Try again.");
    await refresh();
  }

  async function handleRoleChange(assignmentId: string, role: string) {
    if (viewOnly()) return;
    setMessage(null);
    const res = await fetch(`/api/assignments/${assignmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: role || null }),
    });
    if (!res.ok) return fail("Couldn't update role. Try again.");
    await loadJobs();
  }

  async function handleRemove(assignmentId: string) {
    if (viewOnly()) return;
    setMessage(null);
    const res = await fetch(`/api/assignments/${assignmentId}`, { method: "DELETE" });
    if (!res.ok) return fail("Couldn't remove that assignment. Try again.");
    await refresh();
  }

  async function copyFromYesterday() {
    setMessage(null);
    const res = await fetch("/api/jobs/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: addDays(selectedDate, -1), to: selectedDate }),
    });
    if (!res.ok) return fail("Couldn't copy yesterday's plan.");
    const { copied } = await res.json();
    setMessage({
      text: copied
        ? `Copied ${copied} job${copied > 1 ? "s" : ""} from yesterday.`
        : "Nothing new to copy from yesterday.",
    });
    await refresh();
  }

  async function clearBoard() {
    if (viewOnly()) return;
    const totalAssigned = jobs.reduce((n, j) => n + j.assignments.length, 0);
    const totalBriefs = jobs.reduce((n, j) => n + (j.dayBrief ? 1 : 0), 0);
    if (totalAssigned === 0 && totalBriefs === 0) return;
    const parts = [];
    if (totalAssigned > 0) parts.push(`${totalAssigned} allocation${totalAssigned > 1 ? "s" : ""}`);
    if (totalBriefs > 0) parts.push(`${totalBriefs} day brief${totalBriefs > 1 ? "s" : ""}`);
    if (
      !confirm(
        `Clear the board for ${selectedDate}? This unassigns everyone and everything from every job on this day and wipes each job's day brief (${parts.join(
          " and "
        )}). Jobs themselves aren't deleted, and this can't be undone.`
      )
    )
      return;
    setMessage(null);
    const res = await fetch("/api/jobs/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: selectedDate }),
    });
    if (!res.ok) return fail("Couldn't clear the board. Try again.");
    const { cleared, briefsCleared } = await res.json();
    setMessage({
      text: `Cleared ${cleared} allocation${cleared === 1 ? "" : "s"} and ${briefsCleared} day brief${
        briefsCleared === 1 ? "" : "s"
      } from the board.`,
    });
    await refresh();
  }

  // ---- derived: conflicts + column totals -------------------------------
  const running = useMemo(() => jobs.filter((j) => !j.notRunning), [jobs]);
  const notRunning = useMemo(() => jobs.filter((j) => j.notRunning), [jobs]);

  // how many running jobs each resource is on, per shift
  const shiftCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of running)
      for (const a of j.assignments) {
        const k = `${a.resourceId}|${j.shift}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    return m;
  }, [running]);

  function conflictsFor(job: JobDTO) {
    const out: Record<string, number> = {};
    if (job.notRunning) return out;
    for (const a of job.assignments) {
      const n = (shiftCounts.get(`${a.resourceId}|${job.shift}`) ?? 1) - 1;
      if (n > 0) out[a.resourceId] = n;
    }
    return out;
  }

  const totals = useMemo(() => {
    const t = { crew: [0, 0], plant: [0, 0], hire: [0, 0] } as Record<
      "crew" | "plant" | "hire",
      [number, number]
    >;
    for (const r of resources) t[columnFor(r)][1]++;
    const seen = new Set<string>();
    for (const j of running)
      for (const a of j.assignments) {
        if (seen.has(a.resourceId)) continue;
        seen.add(a.resourceId);
        t[columnFor(a.resource)][0]++;
      }
    return t;
  }, [resources, running]);

  const [daySheet, setDaySheet] = useState<{ subject: string; body: string } | null>(null);
  function openDaySheet() {
    setDaySheet(buildDaySheet(jobs, selectedDate));
  }

  async function deleteJob() {
    const res = await fetch(`/api/jobs/${(editing as JobDTO).id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Couldn't delete job");
    await refresh();
  }

  const rowProps = {
    onAssign: handleAssign,
    onRoleChange: handleRoleChange,
    onRemove: handleRemove,
    onEdit: (j: JobDTO) => canEdit && setEditing(j),
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-edge px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-100">Command Centre</h1>
            <p className="text-xs text-gray-500">
              Every active site, one to a row. Drag to assign or move; it saves on drop.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openDaySheet}
              title="Generate the labour, site & truck allocations message for this day"
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2"
            >
              Export
            </button>
            {canEdit ? (
              <>
                <button
                  onClick={clearBoard}
                  title="Unassign everyone and everything, and clear every day brief, on this day"
                  className="rounded-md border border-red-900/60 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/40"
                >
                  Clear board
                </button>
                <button
                  onClick={copyFromYesterday}
                  className="rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2"
                >
                  Copy yesterday
                </button>
                <button
                  onClick={() => setEditing("new")}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
                >
                  + New job
                </button>
              </>
            ) : (
              <span className="rounded bg-gray-700 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-300">
                View only
              </span>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <DateTabs selected={selectedDate} onSelect={setSelectedDate} />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            title="Jump to any date"
            className="shrink-0 rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200"
          />
        </div>
        <div className="mt-3 empty:hidden">
          <UpcomingAlerts compact onSelect={(a) => setSelectedDate(a.startDate)} />
        </div>
      </header>

      {message && (
        <div
          className={`px-4 py-1.5 text-xs ${
            message.error ? "bg-red-900/40 text-red-300" : "bg-emerald-900/30 text-emerald-300"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <ResourceSidebar
          resources={resources}
          selectedDate={selectedDate}
          onUnassign={handleRemove}
          onResourcesChanged={loadResources}
        />

        <main className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
          ) : (
            <>
              <JobGridHeader totals={totals} />
              {running.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-600">
                  No jobs for this date yet. Add one, or copy yesterday's plan.
                </div>
              )}
              {running.map((job) => (
                <JobRow key={job.id} job={job} conflicts={conflictsFor(job)} {...rowProps} />
              ))}

              {notRunning.length > 0 && (
                <div className="mt-6">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Inactive / stood down &middot; {notRunning.length}
                  </div>
                  {notRunning.map((job) => (
                    <JobRow key={job.id} job={job} conflicts={{}} {...rowProps} />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {editing && (
        <JobFormModal
          editing={editing}
          projects={projects}
          defaultDate={selectedDate}
          onSaved={async (saved, { moved, completed }) => {
            if (completed) setMessage({ text: "Marked complete — moved to the Completed page." });
            else if (moved) setMessage({ text: `Job moved to ${saved.date}.` });
            await refresh();
          }}
          onClose={() => setEditing(null)}
          onDelete={editing === "new" ? undefined : deleteJob}
        />
      )}

      {daySheet && (
        <DaySheetModal subject={daySheet.subject} body={daySheet.body} onClose={() => setDaySheet(null)} />
      )}
    </div>
  );
}
