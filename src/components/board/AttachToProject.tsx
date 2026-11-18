"use client";

import FormModal, { FieldDef } from "../FormModal";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { JobDTO, ProjectDTO } from "@/lib/types";

// A board job with no project (18 Nov 2026, Ilies "approve all"): "Attach to project" picks the project
// (components/ProjectSelect.tsx) and sends PATCH /api/jobs/:id { projectId }. When that project already has its job for
// the same day and shift, the server answers 409 { code: "job-clash" } and this asks "merge into it?" - yes moves the
// loose job's allocations and sign-ins onto that job and cancels the loose one (POST /api/jobs/:id/merge-into, kept
// forever with the reason). Never moves a job from one project to another.
export default function AttachToProject({
  job, projects, onDone, onClose,
}: {
  job: JobDTO;
  projects: ProjectDTO[];
  onDone: (message: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const fields: FieldDef[] = [
    { key: "job", label: "Job", type: "static", staticText: `${job.title} · ${job.date} · ${job.shift === "NIGHT" ? "night" : "day"} shift`, full: true },
    {
      key: "projectId", label: "Project", type: "project", required: true, full: true,
      noneLabel: "— pick the project this job belongs to —",
      projects,
      projectLabel: (p) => {
        const x = projects.find((y) => y.id === p.id);
        return [p.name, x?.jobNo, x?.client].filter(Boolean).join(" — ");
      },
    },
  ];

  async function save(v: Record<string, any>) {
    const project = projects.find((p) => p.id === v.projectId);
    if (!project) throw new Error("Pick a project.");
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id }),
    });
    if (res.ok) return onDone(`${job.title} is now on ${project.name}.`);
    const j = (await res.clone().json().catch(() => null)) as { code?: string; error?: string; targetJobId?: string } | null;
    if (res.status !== 409 || j?.code !== "job-clash" || !j.targetJobId) throw new Error(await serverErrorMessage(res, "Couldn't attach the job."));
    if (!window.confirm(`${j.error}\n\nMerging moves this job's allocations and sign-ins onto that job, and cancels this one (kept on record with the reason).`)) {
      throw new Error("Not attached - nothing changed.");
    }
    const m = await fetch(`/api/jobs/${job.id}/merge-into`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetJobId: j.targetJobId, reason: `Attached to ${project.name} - merged into its job for the day` }),
    });
    if (!m.ok) throw new Error(await serverErrorMessage(m, "Couldn't merge the jobs."));
    const out = (await m.json().catch(() => ({}))) as { moved?: { assignments: number; signIns: number } };
    const a = out.moved?.assignments ?? 0, s = out.moved?.signIns ?? 0;
    await onDone(`Merged into ${project.name}'s job: ${a} allocation${a === 1 ? "" : "s"} and ${s} sign-in${s === 1 ? "" : "s"} moved; the loose job is cancelled (kept).`);
  }

  return (
    <FormModal title="Attach to project" fields={fields} initial={{ projectId: "" }} onSave={save} onClose={onClose} submitLabel="Attach" />
  );
}
