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
  const knownProject = defaultProjectId ? projects.find((p) => p.id === defaultProjectId) : undefined;

  const jobFields: FieldDef[] = [
    ...(isNew
      ? ([
          knownProject
            ? {
                key: "projectId",
                label: "Project",
                type: "static",
                full: true,
                section: "Job details",
                staticText: knownProject.client ? `${knownProject.name} — ${knownProject.client}` : knownProject.name,
              }
            : {
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
    { key: "client", label: "Client", section: "Job details" },
    { key: "siteCode", label: "Job number" },
    { key: "title", label: "Job / site name", full: true },
    { key: "siteAddress", label: "Site address", full: true },
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
    const body = {
      title,
      // Left blank, a job takes its client from the project - same as its hours do.
      client: v.client || project?.client || null,
      siteCode: v.siteCode || project?.jobNo || null,
      siteAddress: v.siteAddress || null,
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
          ? { shift: "DAY", status: "ACTIVE", projectId: defaultProjectId ?? "", date: defaultDate, title: defaultTitle ?? "" }
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
