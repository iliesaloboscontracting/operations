"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DragResourcePayload,
  JobDTO,
  ProjectDTO,
  ResourceDTO,
  StartAlertDTO,
} from "@/lib/types";
import {
  columnFor,
  isOfficeStaff,
  isQuickLabourHire,
  localISODate,
  NEW_LABOUR_HIRE,
  QUICK_LABOUR_HIRE_NAME,
} from "@/lib/resource";
import DateTabs from "./DateTabs";
import ResourceSidebar from "./ResourceSidebar";
import JobGridHeader from "./JobGridHeader";
import JobRow from "./JobRow";
import JobFormModal from "./JobFormModal";
import CommandAssistant from "./CommandAssistant";
import UpcomingAlerts from "./UpcomingAlerts";
import { useAuth } from "./AuthProvider";
import { addDays } from "@/lib/dates";
import { buildDaySheet, DaySheetJob } from "@/lib/daySheet";
import DaySheetModal from "./DaySheetModal";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { AlertTriangle, Building2, CalendarClock, Download, Eraser, Plus, Users } from "lucide-react";
import StatTile from "./StatTile";

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
  // Pre-fill for "+ New job" when opened from an alert for a project with no job yet.
  const [newJobPrefill, setNewJobPrefill] = useState<{ projectId: string; title: string } | null>(null);
  // True only when "new job" was opened by clicking a project's own row in the
  // Inactive/stood-down section (a placeholder standing in for the project
  // itself, not a real job) - see the onEdit handler below and JobFormModal.
  const [fromInactiveProject, setFromInactiveProject] = useState(false);

  function selectAlert(a: StartAlertDTO) {
    setSelectedDate(a.startDate);
    if (a.noJobYet) {
      setNewJobPrefill({ projectId: a.projectId, title: a.name });
      setFromInactiveProject(false);
      setEditing("new");
    }
  }

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

  // Office staff are in the Personnel register only so projects can link an
  // office contact - they're never allocated to a site, so they stay out of
  // the pool (and out of the voice assistant's matches) entirely.
  const loadResources = useCallback(async () => {
    const res = await apiFetch(`/api/resources`);
    if (res.ok) setResources((await res.json()).filter((r: ResourceDTO) => !isOfficeStaff(r)));
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

  // A placeholder row has no real job yet - dragging someone onto it creates
  // today's job for that project first (same defaults as "+ New job" would use),
  // then assigns onto the job that comes back.
  async function materialize(projectId: string): Promise<string | null> {
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      fail("Couldn't find that project.");
      return null;
    }
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        title: project.name,
        client: project.client,
        siteCode: project.jobNo,
        date: selectedDate,
        shift: "DAY",
        startTime: project.dayStart,
        endTime: project.dayEnd,
        status: "ACTIVE",
      }),
    });
    if (!res.ok) {
      fail(await serverErrorMessage(res, "Couldn't create today's job for that project."));
      return null;
    }
    const created = await res.json();
    return created.id as string;
  }

  async function handleAssign(jobId: string, payload: DragResourcePayload) {
    if (viewOnly()) return;
    setMessage(null);
    let realJobId = jobId;
    if (jobId.startsWith("virtual:")) {
      const id = await materialize(jobId.slice("virtual:".length));
      if (!id) return;
      realJobId = id;
    }
    // Dragged from the Yard's "Labour hire" box: make a new tile for this drop.
    let resourceId = payload.resourceId;
    if (resourceId === NEW_LABOUR_HIRE) {
      const used = resources
        .map((r) => QUICK_LABOUR_HIRE_NAME.exec(r.name)?.[1])
        .filter(Boolean)
        .map(Number);
      const created = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Labour hire ${used.length ? Math.max(...used) + 1 : 1}`,
          type: "HIRE",
          category: "LABOUR",
          ownership: "HIRED",
        }),
      });
      if (!created.ok) return fail(await serverErrorMessage(created, "Couldn't add a labour hire tile. Try again."));
      resourceId = (await created.json()).id;
    }
    const res = payload.assignmentId
      ? await fetch(`/api/assignments/${payload.assignmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: realJobId }),
        })
      : await fetch("/api/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: realJobId, resourceId }),
        });
    if (!res.ok) return fail(await serverErrorMessage(res, "Couldn't assign that resource. Try again."));
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
    if (!res.ok) return fail(await serverErrorMessage(res, "Couldn't update role. Try again."));
    await loadJobs();
  }

  async function handleRemove(assignmentId: string) {
    if (viewOnly()) return;
    setMessage(null);
    const res = await fetch(`/api/assignments/${assignmentId}`, { method: "DELETE" });
    if (!res.ok) return fail(await serverErrorMessage(res, "Couldn't remove that assignment. Try again."));
    // A quick labour hire tile only exists for the job it was dropped on, so
    // once it's on no job at all it's retired (soft delete - history kept)
    // rather than left sitting in the Yard.
    const r = resources.find((x) => (x.assignments ?? []).some((a) => a.id === assignmentId));
    if (r && isQuickLabourHire(r) && (r.assignments ?? []).every((a) => a.id === assignmentId)) {
      await fetch(`/api/resources/${r.id}`, { method: "DELETE" });
    }
    await refresh();
  }

  async function copyFromYesterday() {
    setMessage(null);
    const res = await fetch("/api/jobs/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: addDays(selectedDate, -1), to: selectedDate }),
    });
    if (!res.ok) return fail(await serverErrorMessage(res, "Couldn't copy yesterday's plan."));
    const { copied, merged } = await res.json();
    const parts = [];
    if (copied) parts.push(`copied ${copied} job${copied > 1 ? "s" : ""}`);
    if (merged) parts.push(`filled in crew on ${merged} existing job${merged > 1 ? "s" : ""}`);
    setMessage({
      text: parts.length ? `Yesterday: ${parts.join(", ")}.` : "Nothing new to copy from yesterday.",
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
    if (!res.ok) return fail(await serverErrorMessage(res, "Couldn't clear the board. Try again."));
    const { cleared, briefsCleared } = await res.json();
    setMessage({
      text: `Cleared ${cleared} allocation${cleared === 1 ? "" : "s"} and ${briefsCleared} day brief${
        briefsCleared === 1 ? "" : "s"
      } from the board.`,
    });
    await refresh();
  }

  // ---- derived: every active/inactive project gets a row, even before its
  // job for the day exists - a placeholder ("virtual") row stands in until
  // then, so a project never just vanishes off the board (from its start
  // date on). ---------------------------------------------------------------
  const boardRows = useMemo(() => {
    const hasJobToday = new Set(jobs.map((j) => j.projectId).filter((id): id is string => !!id));
    const placeholders: JobDTO[] = projects
      // A project with a start date doesn't get a placeholder row on days before
      // it starts (Ilies, 18 Oct 2026). A real job entered for one of those days
      // still shows as normal.
      .filter(
        (p) =>
          p.status !== "COMPLETED" &&
          !hasJobToday.has(p.id) &&
          !(p.startDate && selectedDate < p.startDate)
      )
      .map((p) => ({
        id: `virtual:${p.id}`,
        projectId: p.id,
        title: p.name,
        client: p.client,
        siteCode: p.jobNo,
        siteAddress: p.address,
        date: selectedDate,
        shift: "DAY",
        startTime: p.dayStart,
        endTime: p.dayEnd,
        status: p.status,
        dayBrief: null,
        colorTag: "orange",
        notRunning: p.status !== "ACTIVE",
        sortOrder: 999,
        assignments: [],
        virtual: true,
      }));
    return [...jobs, ...placeholders];
  }, [jobs, projects, selectedDate]);

  // ---- derived: conflicts + column totals -------------------------------
  const running = useMemo(() => boardRows.filter((j) => !j.notRunning), [boardRows]);
  const notRunning = useMemo(() => boardRows.filter((j) => j.notRunning), [boardRows]);

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
    // Quick labour hire tiles aren't part of the pool; they count only where
    // they've been placed (on both sides of "placed / available").
    for (const r of resources) if (!isQuickLabourHire(r)) t[columnFor(r)][1]++;
    const seen = new Set<string>();
    for (const j of running)
      for (const a of j.assignments) {
        if (seen.has(a.resourceId)) continue;
        seen.add(a.resourceId);
        t[columnFor(a.resource)][0]++;
        if (isQuickLabourHire(a.resource)) t[columnFor(a.resource)][1]++;
      }
    return t;
  }, [resources, running]);

  // ---- derived: the day's figures bar (moved here from Projects, Ilies 18 Oct
  // 2026) - everything is for the date being viewed, not just today. The Yard
  // isn't a site, so it's left out of the site counts.
  const dayFigures = useMemo(() => {
    const sites = running.filter((j) => j.title.trim().toLowerCase() !== "yard");
    const weekEnd = addDays(selectedDate, 7);
    return {
      sites: sites.length,
      needCrew: sites.filter((j) => !j.assignments.some((a) => columnFor(a.resource) === "crew")).length,
      startingSoon: projects.filter(
        (p) => p.status === "ACTIVE" && !!p.startDate && p.startDate > selectedDate && p.startDate <= weekEnd
      ).length,
      crewDeployed: totals.crew[0],
    };
  }, [running, projects, selectedDate, totals]);

  const [daySheet, setDaySheet] = useState<
    { subject: string; body: string; scopeJobs: { id: string; title: string; projectId: string }[] } | null
  >(null);
  function openDaySheet() {
    // Narrow to only the fields the day sheet is allowed to use - this goes
    // straight to the whole crew, so a pay rate/cost field simply isn't
    // reachable here even if JobDTO/ResourceDTO carry one for this viewer.
    const safeJobs: DaySheetJob[] = jobs.map((j) => ({
      title: j.title,
      client: j.client,
      siteAddress: j.siteAddress,
      startTime: j.startTime,
      endTime: j.endTime,
      shift: j.shift,
      notRunning: j.notRunning,
      dayBrief: j.dayBrief,
      assignments: j.assignments.map((a) => ({
        role: a.role,
        resource: {
          name: a.resource.name,
          type: a.resource.type,
          category: a.resource.category,
          identifier: a.resource.identifier,
          agency: a.resource.agency,
        },
      })),
    }));
    // One scope-of-works PDF per running job, offered alongside the draft so
    // they can be pulled into Downloads and dragged into the Outlook window
    // "Open in email" hands off to - mailto: links can't carry attachments.
    const scopeJobs = jobs
      .filter((j) => !j.notRunning && j.projectId)
      .map((j) => ({ id: j.id, title: j.title, projectId: j.projectId as string }));
    setDaySheet({ ...buildDaySheet(safeJobs, selectedDate), scopeJobs });
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
    onEdit: (j: JobDTO) => {
      if (!canEdit) return;
      if (j.virtual) {
        setNewJobPrefill({ projectId: j.projectId!, title: j.title });
        setFromInactiveProject(true);
        setEditing("new");
      } else {
        setFromInactiveProject(false);
        setEditing(j);
      }
    },
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-edge px-4 py-4 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-100">Allocations</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Every active site, one to a row. Drag to assign or move; it saves on drop.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openDaySheet}
              title="Generate the labour, site & truck allocations message for this day"
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-panel2"
            >
              <Download size={15} />
              Export
            </button>
            {canEdit ? (
              <>
                <button
                  onClick={clearBoard}
                  title="Unassign everyone and everything, and clear every day brief, on this day"
                  className="flex items-center gap-1.5 rounded-lg border border-red-900/60 px-3.5 py-2 text-sm font-medium text-red-400 hover:bg-red-950/40"
                >
                  <Eraser size={15} />
                  Clear board
                </button>
                <button
                  onClick={copyFromYesterday}
                  className="flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-panel2"
                >
                  <CalendarClock size={15} />
                  Copy yesterday
                </button>
                <button
                  onClick={() => {
                    setNewJobPrefill(null);
                    setFromInactiveProject(false);
                    setEditing("new");
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98]"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  New job
                </button>
              </>
            ) : (
              <span className="rounded-full bg-gray-700 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-300">
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
            className="shrink-0 rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={Building2} value={dayFigures.sites} label="Sites running" />
          <StatTile icon={AlertTriangle} value={dayFigures.needCrew} label="Need crew" tone="warn" />
          <StatTile icon={CalendarClock} value={dayFigures.startingSoon} label="Starting in the next 7 days" />
          <StatTile icon={Users} value={dayFigures.crewDeployed} label="Crew deployed" />
        </div>
        <div className="mt-3 empty:hidden">
          <UpcomingAlerts compact onSelect={selectAlert} />
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
              <div className="overflow-hidden rounded-xl border border-edge shadow-soft">
                <JobGridHeader totals={totals} />
                {running.length === 0 && (
                  <div className="py-8 text-center text-sm text-gray-500">
                    No jobs for this date yet. Add one, or copy yesterday's plan.
                  </div>
                )}
                {running.map((job) => (
                  <JobRow key={job.id} job={job} conflicts={conflictsFor(job)} {...rowProps} />
                ))}
              </div>

              {notRunning.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Inactive / stood down &middot; {notRunning.length}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-edge shadow-soft">
                    {notRunning.map((job) => (
                      <JobRow key={job.id} job={job} conflicts={{}} {...rowProps} />
                    ))}
                  </div>
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
          defaultProjectId={newJobPrefill?.projectId}
          defaultTitle={newJobPrefill?.title}
          fromInactiveProject={fromInactiveProject}
          onSaved={async (saved, { moved, completed }) => {
            if (completed) setMessage({ text: "Marked complete — moved to the Completed page." });
            else if (moved && saved) setMessage({ text: `Job moved to ${saved.date}.` });
            await refresh();
          }}
          onClose={() => {
            setEditing(null);
            setNewJobPrefill(null);
            setFromInactiveProject(false);
          }}
          onDelete={editing === "new" ? undefined : deleteJob}
        />
      )}

      {daySheet && (
        <DaySheetModal
          subject={daySheet.subject}
          body={daySheet.body}
          scopeJobs={daySheet.scopeJobs}
          onClose={() => setDaySheet(null)}
        />
      )}

      {canEdit && <CommandAssistant resources={resources} boardRows={boardRows} onAssign={handleAssign} />}
    </div>
  );
}
