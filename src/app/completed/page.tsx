"use client";

import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import FormModal, { FieldDef } from "@/components/FormModal";
import JobStatusBadge from "@/components/JobStatusBadge";
import { ShiftBadge } from "@/components/ShiftBadge";
import { JobDTO, ProjectDTO } from "@/lib/types";
import { fmtDay } from "@/lib/dates";
import { localISODate } from "@/lib/resource";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";

// Job / site name, Client, Job number and Address are site identity - once
// this job is linked to a project they're the project's own fields (same
// layout as the Projects page), and saveJob() below writes them there instead
// of onto the job. See src/lib/jobs.ts for why.
function jobFieldsFor(job: JobDTO): FieldDef[] {
  return [
    { key: "title", label: "Job / site name", full: true, section: "Job details" },
    { key: "client", label: "Client" },
    { key: "siteCode", label: "Job number" },
    { key: "siteAddress", label: "Address", full: true },
    { key: "date", label: "Date", type: "date", section: "Shift details" },
    {
      key: "shift",
      label: "Shift",
      type: "select",
      options: [
        { value: "DAY", label: "☀ Day" },
        { value: "NIGHT", label: "☾ Night" },
      ],
    },
    { key: "startTime", label: "Start time", placeholder: "7am" },
    { key: "endTime", label: "Finish time", placeholder: "3:30pm" },
    {
      key: "status",
      label: "Status",
      type: "select",
      full: true,
      options: [
        { value: "COMPLETED", label: "Completed" },
        { value: "ACTIVE", label: "Active (moves back onto the Allocations board)" },
        { value: "INACTIVE", label: "Inactive" },
      ],
    },
    { key: "dayBrief", label: "Scope of works / day brief", type: "textarea", full: true, section: "Work instructions" },
  ];
}

const PROJECT_FIELDS: FieldDef[] = [
  { key: "name", label: "Job / site name", required: true, full: true },
  { key: "client", label: "Client", placeholder: "e.g. CD Constructions" },
  { key: "jobNo", label: "Job number" },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "COMPLETED", label: "Completed" },
      { value: "ACTIVE", label: "Active (moves back onto the Projects page)" },
      { value: "INACTIVE", label: "Inactive" },
    ],
  },
];

// Jobs and projects marked Completed leave their normal board/page and land here
// instead - a standing record you can search whenever you need it, and reopen to
// reactivate either one if it turns out there's still work to do.
export default function CompletedPage() {
  const { canEdit } = useAuth();
  const [jobs, setJobs] = useState<JobDTO[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingJob, setEditingJob] = useState<JobDTO | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [jr, pr] = await Promise.all([
      apiFetch("/api/jobs/completed"),
      apiFetch(`/api/projects?date=${localISODate()}`),
    ]);
    if (jr.ok) setJobs(await jr.json());
    if (pr.ok) setAllProjects(await pr.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const projects = allProjects.filter((p) => p.status === "COMPLETED");

  const q = search.trim().toLowerCase();
  const visibleJobs = jobs.filter(
    (j) => !q || `${j.title} ${j.client ?? ""} ${j.siteCode ?? ""}`.toLowerCase().includes(q)
  );
  const visibleProjects = projects.filter(
    (p) => !q || `${p.name} ${p.client ?? ""} ${p.jobNo ?? ""}`.toLowerCase().includes(q)
  );

  async function saveJob(v: Record<string, any>) {
    if (!editingJob) return;
    const project = editingJob.projectId ? allProjects.find((p) => p.id === editingJob.projectId) : undefined;
    if (project) {
      const siteRes = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: v.title || project.name,
          client: v.client || null,
          jobNo: v.siteCode || null,
          address: v.siteAddress || null,
        }),
      });
      if (!siteRes.ok) throw new Error("Couldn't save the site details");
    }
    const res = await fetch(`/api/jobs/${editingJob.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...v,
        notRunning: v.status === "INACTIVE",
      }),
    });
    if (!res.ok) throw new Error("Couldn't save job");
    if (v.status !== "COMPLETED") {
      setMessage(
        v.status === "ACTIVE"
          ? `Moved back to Active — find it in Allocations on ${v.date}.`
          : "Moved off the Completed list."
      );
    }
    await load();
  }

  async function saveProject(v: Record<string, any>) {
    if (!editingProject) return;
    const res = await fetch(`/api/projects/${editingProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    });
    if (!res.ok) throw new Error("Couldn't save project");
    if (v.status !== "COMPLETED") {
      setMessage(
        v.status === "ACTIVE" ? "Moved back to Active — find it on the Projects page." : "Moved off the Completed list."
      );
    }
    await load();
  }

  return (
    <PageShell
      title="Completed"
      subtitle="Jobs and projects marked Completed live here. Reopen one to change it back to Active if there's more work to do."
    >
      {message && (
        <div className="mb-3 rounded-md bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-300">{message}</div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search completed jobs & projects..."
        className="mb-4 w-64 rounded-md border border-edge bg-panel2 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <>
          {visibleProjects.length > 0 && (
            <div className="mb-6">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Projects &middot; {visibleProjects.length}
              </div>
              <div className="overflow-hidden rounded-lg border border-edge">
                <div className="grid grid-cols-[1.4fr_1fr] gap-3 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <div>Project</div>
                  <div>Job number</div>
                </div>
                {visibleProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => canEdit && setEditingProject(p)}
                    className="grid w-full grid-cols-[1.4fr_1fr] gap-3 border-b border-edge/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-panel2/60"
                  >
                    <div className="min-w-0 truncate font-medium text-gray-100">
                      {p.name}
                      {p.client && <span className="ml-1.5 font-normal text-gray-500">· {p.client}</span>}
                    </div>
                    <div className="text-gray-400">{p.jobNo ?? "—"}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {visibleJobs.length > 0 && (
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Jobs &middot; {visibleJobs.length}
            </div>
          )}
          {visibleJobs.length === 0 && visibleProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge py-10 text-center text-sm text-gray-500">
              {jobs.length === 0 && projects.length === 0 ? "Nothing completed yet." : "No matches."}
            </div>
          ) : visibleJobs.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-edge">
              <div className="grid grid-cols-[1.4fr_0.6fr_1.8fr_0.8fr] gap-3 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <div>Job</div>
                <div>Date</div>
                <div>Crew &amp; plant</div>
                <div>Status</div>
              </div>
              {visibleJobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => canEdit && setEditingJob(j)}
                  className="grid w-full grid-cols-[1.4fr_0.6fr_1.8fr_0.8fr] gap-3 border-b border-edge/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-panel2/60"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-100">{j.title}</div>
                    <div className="truncate text-[11px] text-gray-500">
                      {j.client ?? "—"} {j.siteCode && `· ${j.siteCode}`}
                    </div>
                  </div>
                  <div className="text-gray-400">
                    <div>{fmtDay(j.date, { day: "numeric", month: "short", year: "numeric" })}</div>
                    <ShiftBadge shift={j.shift} className="mt-0.5" />
                  </div>
                  <div className="min-w-0 truncate text-gray-400">
                    {j.assignments.length === 0
                      ? "—"
                      : j.assignments.map((a) => a.resource.name).join(", ")}
                  </div>
                  <div>
                    <JobStatusBadge status={j.status} />
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {editingJob && (
        <FormModal
          title={`Edit ${editingJob.title}`}
          fields={jobFieldsFor(editingJob)}
          initial={editingJob}
          onSave={saveJob}
          onClose={() => setEditingJob(null)}
          submitLabel="Save"
        />
      )}

      {editingProject && (
        <FormModal
          title={`Edit ${editingProject.name}`}
          fields={PROJECT_FIELDS}
          initial={editingProject}
          onSave={saveProject}
          onClose={() => setEditingProject(null)}
          submitLabel="Save"
        />
      )}
    </PageShell>
  );
}
