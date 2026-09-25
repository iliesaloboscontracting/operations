"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import FormModal, { FieldDef } from "@/components/FormModal";
import { ProjectDTO } from "@/lib/types";
import { localISODate, money } from "@/lib/resource";
import { daysBetween } from "@/lib/dates";
import UpcomingAlerts from "@/components/UpcomingAlerts";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Handshake,
  Link2,
  LucideIcon,
  Plus,
  Truck,
  Users,
  Wrench,
} from "lucide-react";

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

function startsWithinWeek(p: ProjectDTO) {
  if (!p.startDate) return false;
  const n = daysBetween(localISODate(), p.startDate);
  return n >= 0 && n <= 7;
}

// A running site with nobody rostered on today is the one thing on this page
// that actually needs a decision, not just information.
function needsAttention(p: ProjectDTO) {
  return p.status === "ACTIVE" && !!p.counts && p.counts.crew === 0;
}

// Only shown when there's actually something to report - a row of five zeroes
// on every card was the single noisiest thing about the old layout.
function CountStat({ icon: Icon, n, label }: { icon: LucideIcon; n: number; label: string }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 text-gray-300" title={`${n} ${label}`}>
      <Icon size={12} className="text-gray-500" />
      {n}
    </span>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  tone = "default",
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3.5 shadow-soft">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          tone === "warn" && value > 0 ? "bg-amber-500/15 text-amber-600" : "bg-brand-500/10 text-brand-600"
        }`}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-tight text-gray-100">{value}</div>
        <div className="truncate text-[11px] text-gray-500">{label}</div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { canEdit } = useAuth();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
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

  // Only meaningful for the current (non-archived) list - a stat strip for
  // "what needs a look today", not a report on the whole project history.
  const stats = useMemo(() => {
    if (showArchived) return null;
    return {
      active: projects.filter((p) => p.status === "ACTIVE").length,
      needsAttention: projects.filter(needsAttention).length,
      startingSoon: projects.filter(startsWithinWeek).length,
      crewToday: projects.reduce((n, p) => n + (p.counts?.crew ?? 0), 0),
    };
  }, [projects, showArchived]);

  const visible = attentionOnly && !showArchived ? projects.filter(needsAttention) : projects;

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
      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={Building2} value={stats.active} label="Active sites" />
          <StatTile icon={AlertTriangle} value={stats.needsAttention} label="Need crew today" tone="warn" />
          <StatTile icon={CalendarClock} value={stats.startingSoon} label="Starting within a week" />
          <StatTile icon={Users} value={stats.crewToday} label="Crew deployed today" />
        </div>
      )}

      <UpcomingAlerts />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-full bg-panel2 p-1 text-xs">
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
        {!showArchived && (
          <button
            onClick={() => setAttentionOnly((a) => !a)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              attentionOnly
                ? "border-amber-500/50 bg-amber-500/15 text-amber-600"
                : "border-edge text-gray-500 hover:text-gray-300"
            }`}
          >
            Needs attention only{stats ? ` (${stats.needsAttention})` : ""}
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((p) => {
          const allocated = p.counts
            ? p.counts.crew + p.counts.plant + p.counts.attach + p.counts.trucks + p.counts.hire
            : 0;
          return (
            <button
              key={p.id}
              onClick={() => canEdit && setEditing(p)}
              className={`rounded-xl border border-edge bg-panel p-3.5 text-left shadow-soft hover:-translate-y-0.5 hover:shadow-soft-md ${
                p.status !== "ACTIVE" ? "opacity-70" : ""
              } ${needsAttention(p) ? "ring-1 ring-amber-500/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {p.status === "ACTIVE" && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    )}
                    <span className="truncate text-sm font-semibold text-gray-100">{p.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-500">
                    {p.client ?? <span className="italic text-gray-600">No client set</span>}
                    {p.jobNo && <span className="text-gray-400"> · {p.jobNo}</span>}
                  </div>
                </div>
                {p.status !== "ACTIVE" && (
                  <span className="shrink-0 rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-300">
                    {STATUS_LABEL[p.status]}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                {p.dayStart && (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-amber-500">☀</span>
                    {p.dayStart}{p.dayEnd ? `–${p.dayEnd}` : ""}
                  </span>
                )}
                {p.nightStart && (
                  <span className="inline-flex items-center gap-1">
                    <span className="text-purple-500">☾</span>
                    {p.nightStart}{p.nightEnd ? `–${p.nightEnd}` : ""}
                  </span>
                )}
                {startsIn(p) && (
                  <span className="ml-auto shrink-0 rounded-full bg-brand-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200">
                    ▶ {startsIn(p)}
                  </span>
                )}
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-edge pt-2 text-[11px]">
                {allocated > 0 ? (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <CountStat icon={Users} n={p.counts!.crew} label="crew" />
                    <CountStat icon={Wrench} n={p.counts!.plant} label="plant" />
                    <CountStat icon={Link2} n={p.counts!.attach} label="attachments" />
                    <CountStat icon={Truck} n={p.counts!.trucks} label="trucks" />
                    <CountStat icon={Handshake} n={p.counts!.hire} label="hire" />
                  </div>
                ) : (
                  <span className="text-gray-500">Nothing allocated today</span>
                )}
                {!!p.costToDate && (
                  <span
                    className="shrink-0 font-semibold text-gray-300"
                    title="Plant, attachments, vehicles and hire, at their daily rate, for every day worked so far"
                  >
                    {money(p.costToDate)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
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
        {!loadError && !loading && visible.length === 0 && (
          <div className="col-span-full py-10 text-center text-sm text-gray-500">
            {attentionOnly && projects.length > 0
              ? "Nothing needs attention right now — every active site has crew on today."
              : "No projects here."}
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
