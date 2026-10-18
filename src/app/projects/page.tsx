"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/PageShell";
import FormModal from "@/components/FormModal";
import { ProjectDTO } from "@/lib/types";
import { PROJECT_FORM_FIELDS } from "@/lib/projectFormFields";
import { localISODate, money } from "@/lib/resource";
import { daysBetween } from "@/lib/dates";
import UpcomingAlerts from "@/components/UpcomingAlerts";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import {
  ClipboardList,
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
  COMPLETED: "Completed",
};

// "Starts in 3 days" for a project whose start date is today or in the future.
function startsIn(p: ProjectDTO) {
  if (!p.startDate) return null;
  const n = daysBetween(localISODate(), p.startDate);
  if (n < 0) return null;
  if (n === 0) return "Starts today";
  if (n === 1) return "Starts tomorrow";
  return `Starts in ${n} days`;
}

// A running site with nobody rostered on today needs a decision today.
function noCrewToday(p: ProjectDTO) {
  return p.status === "ACTIVE" && !!p.counts && p.counts.crew === 0;
}

// An active site whose Project File still has blanks (lib/projectFile.ts).
function missingInfo(p: ProjectDTO) {
  return p.status === "ACTIVE" && !!p.completeness && p.completeness.missing.length > 0;
}

// The reasons an active project needs attention - one filter, reasons shown
// on the card. Nothing here ever marks a project READY.
function attentionReasons(p: ProjectDTO): string[] {
  const reasons: string[] = [];
  if (noCrewToday(p)) reasons.push("No crew today");
  if (missingInfo(p)) reasons.push("Missing information");
  return reasons;
}

function needsAttention(p: ProjectDTO) {
  return attentionReasons(p).length > 0;
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


type Tab = "current" | "inactive" | "archived";

export default function ProjectsPage() {
  const { canEdit } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [tab, setTab] = useState<Tab>("current");
  const [attentionOnly, setAttentionOnly] = useState(false);
  // Editing an existing project happens on its own page (/projects/[id]);
  // this page only adds new ones.
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects?date=${localISODate()}${tab === "archived" ? "&archived=1" : ""}`
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
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // A new project opens straight on its own page, ready for the Site,
  // Contacts and Scope information.
  async function create(values: Record<string, any>) {
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Save failed"));
    const created = await res.json();
    router.push(`/projects/${created.id}`);
  }

  // A project marked Completed leaves this page entirely - same idea as a completed
  // job leaving the Command Centre board - and lives on the Completed page instead.
  const notCompleted = useMemo(() => projects.filter((p) => p.status !== "COMPLETED"), [projects]);

  // The dashboard (Current tab) is Active sites only now - Inactive ones get their
  // own tab so they're still reachable (to reactivate, or just to check on), rather
  // than cluttering the main view or becoming a dead end with nowhere to find them.
  const byTab = useMemo(() => {
    if (tab === "archived") return notCompleted;
    if (tab === "inactive") return notCompleted.filter((p) => p.status === "INACTIVE");
    return notCompleted.filter((p) => p.status === "ACTIVE");
  }, [notCompleted, tab]);

  // The daily figures bar now lives on Allocations (Ilies, 18 Oct 2026); only
  // the "Needs attention" count is still used here.
  const stats = useMemo(() => {
    if (tab !== "current") return null;
    return { needsAttention: byTab.filter(needsAttention).length };
  }, [byTab, tab]);

  const visible = attentionOnly && tab === "current" ? byTab.filter(needsAttention) : byTab;

  return (
    <PageShell
      title="Projects"
      subtitle="What every active site needs, and what's at risk of arriving late."
      actions={
        canEdit ? (
          <button
            onClick={() => setAdding(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98]"
          >
            <Plus size={16} strokeWidth={2.5} />
            Add project
          </button>
        ) : undefined
      }
    >

      <UpcomingAlerts />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-full bg-panel2 p-1 text-xs">
          {([
            ["current", "Current"],
            ["inactive", "Inactive"],
            ["archived", "Archived"],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 font-medium ${
                tab === t ? "bg-panel text-gray-100 shadow-sm" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "current" && (
          <button
            onClick={() => setAttentionOnly((a) => !a)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              attentionOnly
                ? "border-amber-500/50 bg-amber-500/15 text-amber-600"
                : "border-edge text-gray-500 hover:text-gray-300"
            }`}
          >
            Needs attention{stats ? ` (${stats.needsAttention})` : ""}
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
              onClick={() => router.push(`/projects/${p.id}`)}
              className={`rounded-xl border-2 border-brand-500 bg-brand-950/10 p-3.5 text-left shadow-soft hover:-translate-y-0.5 hover:shadow-soft-md ${
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

              {p.status === "ACTIVE" && (p.completeness || attentionReasons(p).length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {attentionReasons(p).map((r) => (
                    <span key={r} className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-600">
                      {r}
                    </span>
                  ))}
                  {p.completeness && (
                    <span
                      className="ml-auto inline-flex items-center gap-1 text-gray-500"
                      title={
                        p.completeness.missing.length
                          ? `Not filled in yet: ${p.completeness.missing.join(", ")}`
                          : "Every Project File field has something in it"
                      }
                    >
                      <ClipboardList size={11} />
                      Project file {p.completeness.filled}/{p.completeness.total}
                    </span>
                  )}
                </div>
              )}
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
              ? "Nothing needs attention right now — every active site has crew on today and a complete project file."
              : "No projects here."}
          </div>
        )}
      </div>

      {adding && (
        <FormModal
          title="Add project"
          fields={PROJECT_FORM_FIELDS}
          initial={{ status: "ACTIVE", dayStart: "7am", dayEnd: "3:30pm", unpaidBreakMinutes: 30 }}
          onSave={create}
          onClose={() => setAdding(false)}
        />
      )}
    </PageShell>
  );
}
