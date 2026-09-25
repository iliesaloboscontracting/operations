"use client";

import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import FormModal, { FieldDef } from "@/components/FormModal";
import { ProjectDTO } from "@/lib/types";
import { localISODate, money } from "@/lib/resource";
import { daysBetween } from "@/lib/dates";
import UpcomingAlerts from "@/components/UpcomingAlerts";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { Plus } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-900/60 text-emerald-300",
  INACTIVE: "bg-gray-700 text-gray-300",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

const FIELDS: FieldDef[] = [
  { key: "name", label: "Job / site name", required: true, full: true },
  { key: "client", label: "Client", placeholder: "e.g. CD Constructions" },
  { key: "jobNo", label: "Job number" },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "ACTIVE", label: "Active" },
      { value: "INACTIVE", label: "Inactive" },
    ],
  },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "address", label: "Address" },
  { key: "dayStart", label: "Day start", placeholder: "7am" },
  { key: "dayEnd", label: "Day end", placeholder: "3:30pm" },
  { key: "nightStart", label: "Night start", placeholder: "10pm" },
  { key: "nightEnd", label: "Night end", placeholder: "6am" },
  { key: "notes", label: "Notes", type: "textarea" },
];

// "Starts in 3 days" for a project whose start date is today or in the future.
function startsIn(p: ProjectDTO) {
  if (!p.startDate) return null;
  const n = daysBetween(localISODate(), p.startDate);
  if (n < 0) return null;
  if (n === 0) return "Starts today";
  if (n === 1) return "Starts tomorrow";
  return `Starts in ${n} days`;
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span className={n ? "text-gray-300" : "text-gray-600"}>
      {n} {label}
    </span>
  );
}

export default function ProjectsPage() {
  const { canEdit } = useAuth();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProjectDTO | "new" | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects?date=${localISODate()}${showArchived ? "&archived=1" : ""}`
      );
      if (res.ok) {
        setProjects(await res.json());
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: Record<string, any>) {
    const isNew = editing === "new";
    const res = await fetch(
      isNew ? "/api/projects" : `/api/projects/${(editing as ProjectDTO).id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      }
    );
    if (!res.ok) throw new Error("Save failed");
    await load();
  }

  async function toggleArchive() {
    const p = editing as ProjectDTO;
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !p.archived }),
    });
    await load();
  }

  return (
    <PageShell
      title="Projects"
      subtitle="What every active site needs, and what's at risk of arriving late."
      actions={
        canEdit ? (
          <button
            onClick={() => setEditing("new")}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98]"
          >
            <Plus size={16} strokeWidth={2.5} />
            Add project
          </button>
        ) : undefined
      }
    >
      <UpcomingAlerts />

      <div className="mb-5 inline-flex gap-1 rounded-full bg-panel2 p-1 text-xs">
        <button
          onClick={() => setShowArchived(false)}
          className={`rounded-full px-3 py-1 font-medium ${
            !showArchived ? "bg-panel text-gray-100 shadow-sm" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Current
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={`rounded-full px-3 py-1 font-medium ${
            showArchived ? "bg-panel text-gray-100 shadow-sm" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Archived
        </button>
      </div>

      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => canEdit && setEditing(p)}
            className={`rounded-xl border border-edge bg-panel p-4 text-left shadow-soft hover:-translate-y-0.5 hover:shadow-soft-md ${
              p.status !== "ACTIVE" ? "opacity-70" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-100">{p.name}</div>
                <div className="truncate text-[11px] text-gray-500">
                  {p.client ?? <span className="text-gray-600">No client set</span>}
                  {p.jobNo && ` · ${p.jobNo}`}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[p.status]}`}>
                {STATUS_LABEL[p.status]}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              {startsIn(p) && (
                <span className="rounded-full bg-brand-900/70 px-2 py-0.5 font-semibold text-brand-200">
                  ▶ {startsIn(p)}
                </span>
              )}
              {p.dayStart && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-600">
                  <span className="text-amber-500">☀</span> {p.dayStart}{p.dayEnd ? `–${p.dayEnd}` : ""}
                </span>
              )}
              {p.nightStart && (
                <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-purple-600">
                  <span className="text-purple-500">☾</span> {p.nightStart}{p.nightEnd ? `–${p.nightEnd}` : ""}
                </span>
              )}
            </div>
            {p.counts && (
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-edge pt-2.5 text-[10px] uppercase tracking-wide">
                <Count n={p.counts.crew} label="crew" />
                <Count n={p.counts.plant} label="plant" />
                <Count n={p.counts.attach} label="attach" />
                <Count n={p.counts.trucks} label="trucks" />
                <Count n={p.counts.hire} label="hire" />
              </div>
            )}
            {!!p.costToDate && (
              <div
                className="mt-2 text-xs font-semibold text-gray-300"
                title="Plant, attachments, vehicles and hire, at their daily rate, for every day worked so far"
              >
                {money(p.costToDate)} <span className="font-normal text-gray-500">cost to date, ex GST</span>
              </div>
            )}
          </button>
        ))}
        {loadError && (
          <div className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-red-400">
            Couldn't load projects. Your session may have expired.
            <button
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="rounded-md border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2"
            >
              Try again
            </button>
          </div>
        )}
        {!loadError && !loading && projects.length === 0 && (
          <div className="col-span-full py-10 text-center text-sm text-gray-600">
            No projects here.
          </div>
        )}
      </div>

      {editing && (
        <FormModal
          title={editing === "new" ? "Add project" : "Edit project"}
          fields={FIELDS}
          initial={editing === "new" ? { status: "ACTIVE", dayStart: "7am", dayEnd: "3:30pm" } : (editing as any)}
          onSave={save}
          onClose={() => setEditing(null)}
          onDelete={editing === "new" ? undefined : toggleArchive}
          deleteLabel={editing !== "new" && (editing as ProjectDTO).archived ? "Unarchive" : "Archive"}
        />
      )}
    </PageShell>
  );
}
