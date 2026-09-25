"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/PageShell";
import UpcomingAlerts from "@/components/UpcomingAlerts";
import JobDetailsModal from "@/components/JobDetailsModal";
import JobFormModal from "@/components/JobFormModal";
import { ShiftBadge, ShiftIcon } from "@/components/ShiftBadge";
import { CalendarJobDTO, ProjectDTO } from "@/lib/types";
import { localISODate } from "@/lib/resource";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { apiFetch } from "@/lib/apiFetch";
import {
  addDays,
  daysBetween,
  endOfMonth,
  fmtDay,
  isWeekend,
  parseISO,
  rangeDays,
  startOfMonth,
  startOfWeek,
} from "@/lib/dates";

type View = "day" | "week" | "month";

interface Row {
  key: string;
  name: string;
  jobNo: string | null;
  startDate: string | null;
  jobs: CalendarJobDTO[];
}

// The visible date range. When the period contains today, past days are left out
// (the calendar looks ahead from today) unless "Show past days" is on:
//  - week:  today .. today+6
//  - month: today .. end of month, stretched to at least 3 weeks so late in the month
//           you still see what's coming next month
function rangeFor(view: View, anchor: string, today: string, showPast: boolean): [string, string] {
  if (view === "day") return [anchor, anchor];
  if (view === "week") {
    const s = startOfWeek(anchor);
    if (!showPast && s <= today && today <= addDays(s, 6)) return [today, addDays(today, 6)];
    return [s, addDays(s, 6)];
  }
  const first = startOfMonth(anchor);
  const last = endOfMonth(anchor);
  if (!showPast && first <= today && today <= last) {
    const end = addDays(today, 20) > last ? addDays(today, 20) : last;
    return [today, end];
  }
  return [first, last];
}

function label(view: View, from: string, to: string) {
  if (view === "day")
    return fmtDay(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const isFullMonth = from === startOfMonth(from) && to === endOfMonth(from);
  if (view === "month" && isFullMonth) return fmtDay(from, { month: "long", year: "numeric" });
  return `${fmtDay(from, { day: "numeric", month: "short" })} – ${fmtDay(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

type ShiftFilter = "ALL" | "DAY" | "NIGHT";

// A stronger line at the start of each week (Monday) so weeks read as blocks.
const weekStart = (d: string) => (parseISO(d).getDay() === 1 ? "border-l-2 border-l-gray-400" : "");

// One shift's block in a grid cell - shown for every job on the day regardless of
// whether anything has been allocated to it yet (an empty box used to mean "nothing
// scheduled", which was indistinguishable from "scheduled but not staffed").
function JobPill({ job, compact }: { job: CalendarJobDTO; compact: boolean }) {
  // The sun/moon keeps its own colour regardless of the pill's status tone, so shift
  // stays legible at a glance even on an amber/red warning pill.
  const icon = <ShiftIcon shift={job.shift} />;
  const noCrew = !job.notRunning && job.crew === 0; // nobody on it yet (whether or not gear is)
  const tone = job.notRunning
    ? "border-gray-600 bg-gray-800 text-gray-500 line-through"
    : noCrew
    ? "border-amber-500/70 bg-amber-950/50 text-amber-200"
    : !job.hasSupervisor
    ? "border-red-500/70 bg-red-950/40 text-red-200"
    : job.shift === "NIGHT"
    ? "border-purple-500/60 bg-purple-950/50 text-purple-200"
    : "border-blue-500/60 bg-blue-950/50 text-blue-200";
  const status = job.notRunning
    ? " · not running"
    : ` · ${job.crew} crew, ${job.plant} plant, ${job.hire} hire${noCrew ? " · no crew" : !job.hasSupervisor ? " · no supervisor" : ""}`;
  const title = `${job.title} (${job.shift === "NIGHT" ? "night" : "day"})${status}`;
  return (
    <div title={title} className={`rounded border px-1 py-0.5 text-[10px] leading-tight ${tone}`}>
      {compact ? (
        <>
          {icon}
          {noCrew ? "–" : job.crew}
        </>
      ) : (
        <>
          {icon} {noCrew ? "No crew" : `${job.crew} crew`}
          {job.plant > 0 && ` · ${job.plant}p`}
          {job.hire > 0 && ` · ${job.hire}h`}
        </>
      )}
    </div>
  );
}

export default function CalendarPage() {
  // "today" is state so the calendar rolls over by itself at midnight.
  const [today, setToday] = useState(localISODate());
  useEffect(() => {
    const t = setInterval(() => setToday((cur) => (localISODate() !== cur ? localISODate() : cur)), 60_000);
    return () => clearInterval(t);
  }, []);

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(today);
  const [showPast, setShowPast] = useState(false);
  const [search, setSearch] = useState("");
  const [shift, setShift] = useState<ShiftFilter>("ALL");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [allJobs, setJobs] = useState<CalendarJobDTO[]>([]);
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [loading, setLoading] = useState(true);
  // Which project/day's details panel is open (null = closed).
  const [detail, setDetail] = useState<{
    key: string;
    name: string;
    jobNo: string | null;
    startDate: string | null;
    date: string;
  } | null>(null);
  // Which project/day the "add a job" form is open for (null = closed).
  const [addingJob, setAddingJob] = useState<{ projectId?: string; title: string; date: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const [from, to] = useMemo(() => rangeFor(view, anchor, today, showPast), [view, anchor, today, showPast]);
  const days = useMemo(() => rangeDays(from, to), [from, to]);

  const jobs = useMemo(
    () => (shift === "ALL" ? allJobs : allJobs.filter((j) => j.shift === shift)),
    [allJobs, shift]
  );

  // Only the newest request may update state (a slow response for a range you've
  // already left must not overwrite the current one).
  const req = useRef(0);
  const load = useCallback(async () => {
    const id = ++req.current;
    const [j, p] = await Promise.all([
      apiFetch(`/api/calendar?from=${from}&to=${to}`),
      apiFetch(`/api/projects?date=${today}`),
    ]);
    const jobsData = j.ok ? await j.json() : null;
    const projData = p.ok ? await p.json() : null;
    if (id !== req.current) return;
    if (jobsData) setJobs(jobsData);
    if (projData) setProjects(projData);
    setLoading(false);
  }, [from, to, today]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Keep it current: refresh quietly when you return to the tab and every minute.
  useAutoRefresh(load);

  // Makes sure a date's jobs are in `allJobs` before opening its details panel - covers
  // clicking a "starting within a week" alert whose date can fall outside whatever
  // range the grid currently has loaded (e.g. you're on Week view, the alert is later).
  const ensureDateLoaded = useCallback(
    async (date: string) => {
      if (date >= from && date <= to) return; // already covered by the current range
      const res = await apiFetch(`/api/calendar?from=${date}&to=${date}`);
      if (!res.ok) return;
      const extra: CalendarJobDTO[] = await res.json();
      setJobs((prev) => {
        const ids = new Set(prev.map((j) => j.id));
        const fresh = extra.filter((j) => !ids.has(j.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    },
    [from, to]
  );

  const openDetail = useCallback(
    async (key: string, name: string, jobNo: string | null, startDate: string | null, date: string) => {
      await ensureDateLoaded(date);
      setDetail({ key, name, jobNo, startDate, date });
    },
    [ensureDateLoaded]
  );

  // Wide grids (month view) open scrolled so today and the days ahead are visible.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>("[data-today]");
    if (box && el) box.scrollLeft = Math.max(0, el.offsetLeft - 200);
    else if (box) box.scrollLeft = 0;
  }, [loading, view, from]);

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    const byProject = new Map(projects.map((p) => [p.id, p]));
    for (const j of jobs) {
      const key = j.projectId ?? `t:${j.title}`;
      const p = j.projectId ? byProject.get(j.projectId) : undefined;
      if (!map.has(key))
        map.set(key, {
          key,
          name: p?.name ?? j.title,
          jobNo: p?.jobNo ?? j.siteCode,
          startDate: p?.startDate ?? null,
          jobs: [],
        });
      map.get(key)!.jobs.push(j);
    }
    // Projects starting inside the range show even before any job is scheduled.
    for (const p of projects) {
      if (p.status !== "ACTIVE" || !p.startDate || p.startDate < from || p.startDate > to) continue;
      if (shift !== "ALL") continue; // a shift filter only shows projects with jobs on that shift
      if (!map.has(p.id))
        map.set(p.id, { key: p.id, name: p.name, jobNo: p.jobNo, startDate: p.startDate, jobs: [] });
    }
    const q = search.trim().toLowerCase();
    // A running job needs a look if it has no crew yet (including nothing allocated
    // at all) or has crew but no supervisor.
    const needsAttention = (j: CalendarJobDTO) => !j.notRunning && (j.crew === 0 || !j.hasSupervisor);
    return Array.from(map.values())
      .filter((r) => !q || `${r.name} ${r.jobNo ?? ""}`.toLowerCase().includes(q))
      .filter((r) => !attentionOnly || r.jobs.some(needsAttention))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs, projects, from, to, search, attentionOnly, shift]);

  function step(dir: 1 | -1) {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const first = startOfMonth(anchor);
      setAnchor(dir === 1 ? addDays(endOfMonth(first), 1) : startOfMonth(addDays(first, -1)));
    }
  }

  // "Within a week" band shown on the day headers.
  const soon = (d: string) => d >= today && daysBetween(today, d) <= 7;

  const compact = view === "month";
  const colW = compact ? "min-w-[38px]" : "min-w-[130px]";

  return (
    <PageShell
      title="Calendar"
      subtitle="What's planned day by day. Click any day to see the job and its details."
    >
      <UpcomingAlerts
        onSelect={(a) => openDetail(a.projectId, a.name, a.jobNo, a.startDate, a.startDate)}
      />

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-md border border-edge text-xs font-semibold uppercase tracking-wide">
          {(["day", "week", "month"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 ${view === v ? "bg-blue-600 text-white" : "bg-panel text-gray-400 hover:text-gray-200"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="rounded-md border border-edge px-2 py-1 text-sm text-gray-300 hover:bg-panel2">‹</button>
          <button onClick={() => setAnchor(today)} className="rounded-md border border-edge px-2 py-1 text-xs text-gray-300 hover:bg-panel2">Today</button>
          <button onClick={() => step(1)} className="rounded-md border border-edge px-2 py-1 text-sm text-gray-300 hover:bg-panel2">›</button>
        </div>
        <div className="text-sm font-semibold text-gray-100">{label(view, from, to)}</div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          className="w-56 rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="flex overflow-hidden rounded-md border border-edge text-xs font-semibold uppercase tracking-wide">
          {(["ALL", "DAY", "NIGHT"] as ShiftFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setShift(v)}
              className={`flex items-center gap-1 px-3 py-1.5 ${
                shift === v ? "bg-blue-600 text-white" : "bg-panel text-gray-400 hover:text-gray-200"
              }`}
            >
              {v !== "ALL" && (
                <span className={shift === v ? "" : v === "NIGHT" ? "text-purple-500" : "text-amber-500"} aria-hidden>
                  {v === "NIGHT" ? "☾" : "☀"}
                </span>
              )}
              {v === "ALL" ? "All shifts" : v === "DAY" ? "Day" : "Night"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
          Needs attention only
        </label>
        {view !== "day" && (
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
            Show past days
          </label>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
          <span><span className="text-amber-500">☀</span> day</span>
          <span><span className="text-purple-500">☾</span> night</span>
          <span>Empty box = nothing scheduled</span>
          <span className="text-amber-300">Amber = no crew yet</span>
          <span className="text-red-300">Red = no supervisor</span>
          <span className="text-blue-300">▶ = project starts</span>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : view === "day" ? (
        <DayView
          day={from}
          jobs={jobs}
          projects={projects}
          today={today}
          onOpen={(j) => {
            const p = j.projectId ? projects.find((x) => x.id === j.projectId) : undefined;
            openDetail(j.projectId ?? `t:${j.title}`, p?.name ?? j.title, p?.jobNo ?? j.siteCode, p?.startDate ?? null, j.date);
          }}
        />
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-600">Nothing scheduled in this period.</div>
      ) : (
        <div ref={scroller} className="overflow-x-auto rounded-lg border border-edge">
          {/* Every day/project pair is its own bordered box, showing every job on that
              day whether or not it's been staffed yet. A box is only truly empty when
              nothing is scheduled there at all. */}
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-panel">
                <th className="sticky left-0 z-10 min-w-[190px] border border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Project
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    data-today={d === today ? "" : undefined}
                    className={`${colW} border border-edge px-1 py-1.5 text-center text-[10px] font-semibold uppercase ${weekStart(d)} ${
                      d === today ? "bg-blue-900/40 text-blue-200" : soon(d) ? "bg-amber-950/30 text-amber-200/80" : "text-gray-500"
                    } ${isWeekend(d) ? "opacity-70" : ""}`}
                  >
                    <div>{fmtDay(d, { weekday: "short" })}</div>
                    <div className="text-xs">{Number(d.slice(8))}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="sticky left-0 z-10 border border-edge bg-canvas px-3 py-2">
                    <div className="truncate text-sm font-semibold text-gray-100">{row.name}</div>
                    {row.jobNo && <div className="text-[11px] text-gray-500">{row.jobNo}</div>}
                  </td>
                  {days.map((d) => {
                    const cell = row.jobs.filter((j) => j.date === d);
                    const starts = row.startDate === d;
                    return (
                      <td
                        key={d}
                        className={`h-12 border border-edge p-0 align-top ${weekStart(d)} ${
                          d === today ? "bg-blue-900/15" : isWeekend(d) ? "bg-panel2/70" : "bg-panel"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openDetail(row.key, row.name, row.jobNo, row.startDate, d)}
                          title="Show details"
                          className="flex h-full min-h-[2.75rem] w-full flex-col gap-0.5 p-0.5 text-left hover:bg-panel2"
                        >
                          {starts && (
                            <span className="rounded bg-blue-600 px-1 py-0.5 text-center text-[9px] font-bold uppercase text-white">
                              ▶ {compact ? "" : "start"}
                            </span>
                          )}
                          {cell.map((j) => (
                            <JobPill key={j.id} job={j} compact={compact} />
                          ))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <JobDetailsModal
          title={detail.name}
          jobNo={detail.jobNo}
          date={detail.date}
          onAddJob={() => {
            const d = detail;
            setAddingJob({
              projectId: d.key.startsWith("t:") ? undefined : d.key,
              title: d.key.startsWith("t:") ? d.name : "",
              date: d.date,
            });
            setDetail(null);
          }}
          startsThisDay={detail.startDate === detail.date}
          // Read from the live data (not a snapshot) so it stays current on auto-refresh.
          jobs={allJobs.filter(
            (j) => (j.projectId ?? `t:${j.title}`) === detail.key && j.date === detail.date
          )}
          onClose={() => setDetail(null)}
        />
      )}

      {addingJob && (
        <JobFormModal
          editing="new"
          projects={projects}
          defaultDate={addingJob.date}
          defaultProjectId={addingJob.projectId}
          defaultTitle={addingJob.title}
          onSaved={async () => {
            await load();
          }}
          onClose={() => setAddingJob(null)}
        />
      )}
    </PageShell>
  );
}

function DayView({
  day,
  jobs,
  projects,
  today,
  onOpen,
}: {
  day: string;
  jobs: CalendarJobDTO[];
  projects: ProjectDTO[];
  today: string;
  onOpen: (job: CalendarJobDTO) => void;
}) {
  const starting = projects.filter((p) => p.status === "ACTIVE" && p.startDate === day);
  // Active jobs first, inactive ones trailing - both shown in full so this is a
  // complete view of what's on, not just what's running. Completed jobs never reach
  // here at all (the calendar API excludes them; they live on the Completed page).
  const ordered = [...jobs].sort((a, b) => Number(a.notRunning) - Number(b.notRunning));

  return (
    <div>
      {starting.map((p) => (
        <div key={p.id} className="mb-2 rounded-md border border-blue-500/50 bg-blue-950/30 px-3 py-2 text-sm text-blue-200">
          ▶ <b>{p.name}</b> starts {day === today ? "today" : "this day"}
        </div>
      ))}
      {ordered.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-600">Nothing scheduled for this day.</div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {ordered.map((j) => (
          <button
            type="button"
            key={j.id}
            onClick={() => onOpen(j)}
            className={`rounded-lg border p-3 text-left ${
              j.notRunning
                ? "border-edge bg-panel/60 opacity-70 hover:border-gray-500"
                : "border-edge bg-panel hover:border-blue-500/60"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className={`truncate text-sm font-semibold ${j.notRunning ? "text-gray-400 line-through" : "text-gray-100"}`}>
                {j.title}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {j.notRunning && (
                  <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-300">
                    Not running
                  </span>
                )}
                <ShiftBadge shift={j.shift} className="shrink-0 py-0.5 text-[10px] uppercase" />
              </div>
            </div>
            <div className="text-[11px] text-gray-500">
              {j.siteCode && `${j.siteCode} · `}
              {(j.startTime || j.endTime) && `${j.startTime ?? "?"} – ${j.endTime ?? "?"}`}
            </div>
            {j.dayBrief && <div className="mt-1 text-sm text-gray-300">{j.dayBrief}</div>}
            {!j.notRunning && j.crew + j.plant + j.hire === 0 && (
              <div className="mt-1 rounded border border-dashed border-gray-400 px-2 py-1 text-xs font-medium text-gray-500">
                Vacant — no people or resources allocated yet
              </div>
            )}
            {!j.notRunning && j.crew === 0 && j.plant + j.hire > 0 && (
              <div className="mt-1 text-xs font-medium text-amber-300">No crew assigned yet</div>
            )}
            {!j.notRunning && j.crew > 0 && !j.hasSupervisor && <div className="mt-1 text-xs font-medium text-red-400">No supervisor</div>}
            <Names label="Crew" names={j.people} />
            <Names label="Plant" names={j.plantNames} />
            <Names label="Hire" names={j.hireNames} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Names({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-gray-400">
      <span className="mr-1 uppercase tracking-wide text-gray-600">{label} {names.length}</span>
      {names.join(", ")}
    </div>
  );
}
