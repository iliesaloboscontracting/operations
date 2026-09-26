"use client";

import { JobDTO, ProjectDTO } from "@/lib/types";
import FormModal, { FieldDef } from "./FormModal";

export interface SavedJobInfo {
  isNew: boolean;
  moved: boolean; // date changed on an existing job
  completed: boolean; // status just flipped to Completed
}

// Shared create/edit form for a job - the Command Centre's "+ New job" / "Edit job"
// and the Calendar's "+ Add job" both use this, so they stay in lockstep.
export default function JobFormModal({
  editing,
  projects,
  defaultDate,
  defaultProjectId,
  defaultTitle,
  onSaved,
  onClose,
  onDelete,
}: {
  editing: JobDTO | "new";
  projects: ProjectDTO[];
  defaultDate: string; // used when creating
  defaultProjectId?: string; // preselect a project when creating (e.g. from a Calendar row)
  defaultTitle?: string; // prefill the name when creating with no project picked
  onSaved: (job: JobDTO, info: SavedJobInfo) => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}) {
  const isNew = editing === "new";
  // Job / site name, Client, Job number and Address are site identity, not a
  // per-job detail - once a job is linked to a project they're the project's
  // own fields (same as the Projects page edits), so editing them here saves
  // straight to the project and shows the same everywhere immediately. A
  // one-off job with no project keeps its own copy, same as before.
  const linkedProjectId = isNew ? defaultProjectId : (editing as JobDTO).projectId ?? undefined;
  const knownProject = linkedProjectId ? projects.find((p) => p.id === linkedProjectId) : undefined;

  const jobFields: FieldDef[] = [
    // Only ask which project when one isn't already known - once it is, the
    // fields below (starting with the name) *are* that project's own details,
    // so a separate "Project" line would just repeat the same thing twice.
    ...(isNew && !knownProject
      ? ([
          {
            key: "projectId",
            label: "Project",
            type: "select",
            full: true,
            section: "Job details",
            options: [
              { value: "", label: "— pick a project (or type a one-off below) —" },
              ...projects
                .filter((p) => p.status === "ACTIVE")
                .map((p) => ({ value: p.id, label: p.client ? `${p.name} — ${p.client}` : p.name })),
            ],
          },
        ] as FieldDef[])
      : []),
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
        { value: "ACTIVE", label: "Active" },
        { value: "INACTIVE", label: "Inactive" },
        { value: "COMPLETED", label: "Completed (moves to the Completed page)" },
      ],
    },
    {
      key: "dayBrief",
      label: "Scope of works / day brief",
      type: "textarea",
      full: true,
      section: "Work instructions",
    },
  ];

  async function handleSave(v: Record<string, any>) {
    const project = projects.find((p) => p.id === v.projectId);
    const shift = v.shift || "DAY";
    const title = (v.title || project?.name || "").trim();
    if (!title) throw new Error("Pick a project or enter a job name");
    const dflt = (day?: string | null, night?: string | null) =>
      (shift === "NIGHT" ? night : day) || null;
    const status = v.status || "ACTIVE";
    const date = v.date || defaultDate;

    if (project) {
      // These are the project's own fields once it's linked - save them there,
      // not on the job, so every job for this project shows the same thing.
      const siteRes = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          client: v.client || null,
          jobNo: v.siteCode || null,
          address: v.siteAddress || null,
        }),
      });
      if (!siteRes.ok) throw new Error("Couldn't save the site details");
    }

    const body = {
      title,
      // Left blank, a job takes its client from the project - same as its hours do.
      client: v.client || project?.client || null,
      siteCode: v.siteCode || project?.jobNo || null,
      siteAddress: v.siteAddress || project?.address || null,
      date,
      shift,
      startTime: v.startTime || dflt(project?.dayStart, project?.nightStart),
      endTime: v.endTime || dflt(project?.dayEnd, project?.nightEnd),
      dayBrief: v.dayBrief || null,
      status,
      notRunning: status === "INACTIVE",
    };
    const moved = !isNew && (editing as JobDTO).date !== date;
    const completed = !isNew && status === "COMPLETED" && (editing as JobDTO).status !== "COMPLETED";
    const res = await fetch(isNew ? "/api/jobs" : `/api/jobs/${(editing as JobDTO).id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isNew ? { ...body, projectId: project?.id ?? null } : body),
    });
    if (!res.ok) throw new Error("Couldn't save job");
    const saved: JobDTO = await res.json();
    await onSaved(saved, { isNew, moved, completed });
  }

  return (
    <FormModal
      title={isNew ? "New job" : "Edit job"}
      fields={jobFields}
      initial={
        isNew
          ? {
              shift: "DAY",
              status: "ACTIVE",
              projectId: defaultProjectId ?? "",
              date: defaultDate,
              title: knownProject?.name ?? defaultTitle ?? "",
              client: knownProject?.client ?? "",
              siteCode: knownProject?.jobNo ?? "",
              siteAddress: knownProject?.address ?? "",
            }
          : editing
      }
      onSave={handleSave}
      onClose={onClose}
      onDelete={onDelete}
      deleteLabel="Delete Job"
      submitLabel="Save Job"
    />
  );
}
