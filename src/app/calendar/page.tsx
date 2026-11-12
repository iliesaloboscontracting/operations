"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import UpcomingAlerts from "@/components/UpcomingAlerts";
import JobDetailsModal from "@/components/JobDetailsModal";
import JobFormModal from "@/components/JobFormModal";
import { ShiftBadge, ShiftIcon } from "@/components/ShiftBadge";
import { CalendarJobDTO, ProjectDTO } from "@/lib/types";
import { localISODate } from "@/lib/resource";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { apiFetch } from "@/lib/apiFetch";
import { useAuth } from "@/components/AuthProvider";
import { coordinatorHref } from "@/lib/roles";
import { CalendarSpanDTO, CalendarSpansResponse, NoDatesDTO, spanDays, spanWords } from "@/lib/calendarSpans";
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

// "quarter" = the 3-month view (12 Nov 2026), so long jobs read across months.
type View = "day" | "week" | "month" | "quarter";
const VIEW_LABEL: Record<View, string> = { day: "day", week: "week", month: "month", quarter: "3 months" };

interface Row {
  key: string;
  name: string;
  jobNo: string | null;
  startDate: string | null;
  jobs: CalendarJobDTO[];
  span?: CalendarSpanDTO; // the project's planned span in this range (lib/calendarSpans.ts)
}

// The first day of the month `n` months away from `iso`'s month.
function monthsAhead(iso: string, n: number) {
  let m = startOfMonth(iso);
  for (let i = 0; i < Math.abs(n); i++) m = n > 0 ? addDays(endOfMonth(m), 1) : startOfMonth(addDays(m, -1));
  return m;
}

// The visible date range. When the period contains today, past days are left out
// (the calendar looks ahead from today) unless "Show past days" is on:
//  - week:  today .. today+6
//  - month: today .. end of month, stretched to at least 3 weeks so late in the month
//           you still see what's coming next month
//  - 3 months: today .. the end of the third month, stretched to at least 12 weeks
function rangeFor(view: View, anchor: string, today: string, showPast: boolean): [string, string] {
  if (view === "day") return [anchor, anchor];
  if (view === "week") {
    const s = startOfWeek(anchor);
    if (!showPast && s <= today && today <= addDays(s, 6)) return [today, addDays(today, 6)];
    return [s, addDays(s, 6)];
  }
  const first = startOfMonth(anchor);
  const last = view === "quarter" ? endOfMonth(monthsAhead(first, 2)) : endOfMonth(anchor);
  const minDays = view === "quarter" ? 83 : 20;
  if (!showPast && first <= today && today <= last) {
    const end = addDays(today, minDays) > last ? addDays(today, minDays) : last;
    return [today, end];
  }
  return [first, last];
}

function label(view: View, from: string, to: string) {
  if (view === "day")
    return fmtDay(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const isFullMonth = from === startOfMonth(from) && to === endOfMonth(from);
  if (view === "month" && isFullMonth) return fmtDay(from, { month: "long", year: "numeric" });
  if (view === "quarter" && from === startOfMonth(from) && to === endOfMonth(to))
    return `${fmtDay(from, { month: "short", ...(from.slice(0, 4) === to.slice(0, 4) ? {} : { year: "numeric" }) })} – ${fmtDay(to, { month: "short", year: "numeric" })}`;
  return `${fmtDay(from, { day: "numeric", month: "short" })} – ${fmtDay(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

type ShiftFilter = "ALL" | "DAY" | "NIGHT";

// A stronger line at the start of each week (Monday) so weeks read as blocks.
const weekStart = (d: string) => (parseISO(d).getDay() === 1 ? "border-l-2 border-l-gray-400" : "");

// A job only shows on the grid once something has been allocated to it (people, plant,
// vehicles or hire). Until then its box stays completely empty - showing every job
// every day regardless of staffing turned out to be more noise than signal on a wide
// month grid, so this is back to "nothing there yet = nothing shown".
const hasAllocation = (j: CalendarJobDTO) => j.crew + j.plant + j.hire > 0;

// One shift's block in a grid cell (only rendered for jobs with an allocation).
function JobPill({ job, compact }: { job: CalendarJobDTO; compact: boolean }) {
  // The sun/moon keeps its own colour regardless of the pill's status tone, so shift
  // stays legible at a glance even on an amber/red warning pill.
  const icon = <ShiftIcon shift={job.shift} />;
  const noCrew = !job.notRunning && job.crew === 0; // gear allocated, nobody on it
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

// The 3-month view's day columns are too narrow for a pill: the same block as a small mark in the same colours, with
// the same words on hover.
function JobMark({ job }: { job: CalendarJobDTO }) {
  const noCrew = !job.notRunning && job.crew === 0;
  const tone = job.notRunning
    ? "bg-gray-600"
    : noCrew
    ? "bg-amber-500"
    : !job.hasSupervisor
    ? "bg-red-500"
    : job.shift === "NIGHT"
    ? "bg-purple-500"
    : "bg-blue-500";
  const status = job.notRunning
    ? " · not running"
    : ` · ${job.crew} crew, ${job.plant} plant, ${job.hire} hire${noCrew ? " · no crew" : !job.hasSupervisor ? " · no supervisor" : ""}`;
  return <div title={`${job.title} (${job.shift === "NIGHT" ? "night" : "day"})${status}`} className={`relative h-2.5 w-full rounded-sm ${tone}`} />;
}

const shortDay = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });
const shortDayYear = (iso: string) => fmtDay(iso, { day: "numeric", month: "short", year: "numeric" });

// One day's piece of a project's planned span (lib/calendarSpans.ts): a thin bar along the bottom of the cell, behind
// the booked-day chips. Solid = start confirmed (or not stated), dashed and lighter = start tentative, grey = inactive.
// A TBC finish fades out at the edge of the view; days past the expected finish are amber with stripes (and the row
// says "Past expected finish" in words).
function SpanPiece({ span, day }: { span: CalendarSpanDTO; day: string }) {
  if (day < span.from || day > span.to) return null;
  const over = !!span.pastFinish && !!span.finish && day > span.finish;
  const first = day === span.start;
  const last = over ? day === span.pastFinish!.until : day === span.finish;
  const fade = span.finishTbc && day === span.to && span.clippedEnd;
  const inactive = span.status === "INACTIVE";
  const base = over
    ? "bg-[repeating-linear-gradient(135deg,rgb(245_158_11/0.85)_0_3px,rgb(245_158_11/0.35)_3px_6px)]"
    : span.tentative
    ? // dashed along the top and bottom only, closed at the span's own ends - not at every day's edge
      `border-y border-dashed ${first ? "border-l" : ""} ${last ? "border-r" : ""} ${inactive ? "border-gray-400/80 bg-gray-500/20" : "border-brand-400 bg-brand-500/25"}`
    : inactive
    ? "bg-gray-500/70"
    : "bg-brand-500/80";
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-1 h-1.5 ${first ? "left-1 rounded-l-full" : "left-0"} ${
        last ? "right-1 rounded-r-full" : "right-0"
      } ${base} ${fade ? "border-r-0 [mask-image:linear-gradient(to_right,black,transparent)]" : ""}`}
    />
  );
}

// The row's words about its span, in the sticky project column - always on screen, whatever the scroll.
function SpanTags({ span }: { span: CalendarSpanDTO }) {
  const tags: { text: string; tone: string }[] = [];
  if (span.upcoming)
    tags.push({ text: `${span.upcoming.kind === "RECOMMENCES" ? "Recommences" : "Starts"} ${shortDay(span.upcoming.date)}`, tone: "bg-gray-500/20 text-gray-300" });
  else if (span.status === "INACTIVE") tags.push({ text: "Inactive", tone: "bg-gray-500/20 text-gray-300" });
  if (span.pastFinish) tags.push({ text: "⚠ Past expected finish", tone: "bg-amber-500/15 text-amber-600" });
  if (span.finishTbc) tags.push({ text: "Finish TBC", tone: "bg-gray-500/20 text-gray-400" });
  if (span.tentative) tags.push({ text: "Start tentative", tone: "bg-gray-500/20 text-gray-400" });
  if (tags.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t.text} className={`whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold ${t.tone}`}>
          {t.text}
        </span>
      ))}
    </div>
  );
}

const spanTitle = (s: CalendarSpanDTO) => {
  const n = spanDays(s);
  return `Planned ${spanWords(s, shortDayYear)}${n ? ` (${n} days)` : ""}`;
};

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
  const [spans, setSpans] = useState<CalendarSpanDTO[]>([]);
  const [noDates, setNoDates] = useState<NoDatesDTO[]>([]);
  const { coordinatorOnly } = useAuth();
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
    const [j, p, s] = await Promise.all([
      apiFetch(`/api/calendar?from=${from}&to=${to}`),
      apiFetch(`/api/projects?date=${today}`),
      apiFetch(`/api/calendar/spans?from=${from}&to=${to}`),
    ]);
    const jobsData = j.ok ? await j.json() : null;
    const projData = p.ok ? await p.json() : null;
    const spanData: CalendarSpansResponse | null = s.ok ? await s.json() : null;
    if (id !== req.current) return;
    if (jobsData) setJobs(jobsData);
    if (projData) setProjects(projData);
    if (spanData) {
      setSpans(spanData.spans);
      setNoDates(spanData.noDates);
    }
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
    // Each project's planned span (12 Nov 2026) - on its row, and a row of its own while nothing is booked yet.
    for (const s of spans) {
      const row = map.get(s.projectId);
      if (row) row.span = s;
      else if (shift === "ALL") // a shift filter only shows projects with jobs on that shift
        map.set(s.projectId, { key: s.projectId, name: s.name, jobNo: s.jobNo, startDate: s.status === "ACTIVE" ? s.start : null, jobs: [], span: s });
    }
    const q = search.trim().toLowerCase();
    // Only blocks that are actually visible on the grid (i.e. have an allocation) can need attention - and a project
    // past its expected finish.
    const needsAttention = (j: CalendarJobDTO) =>
      !j.notRunning && hasAllocation(j) && (j.crew === 0 || !j.hasSupervisor);
    return Array.from(map.values())
      .filter((r) => !q || `${r.name} ${r.jobNo ?? ""}`.toLowerCase().includes(q))
      .filter((r) => !attentionOnly || r.jobs.some(needsAttention) || !!r.span?.pastFinish)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs, projects, spans, from, to, search, attentionOnly, shift]);

  const noDatesShown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return noDates.filter((p) => !q || `${p.name} ${p.jobNo ?? ""}`.toLowerCase().includes(q));
  }, [noDates, search]);

  function step(dir: 1 | -1) {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else setAnchor(monthsAhead(anchor, (view === "quarter" ? 3 : 1) * dir));
  }

  // "Within a week" band shown on the day headers.
  const soon = (d: string) => d >= today && daysBetween(today, d) <= 7;

  const quarter = view === "quarter";
  const compact = view === "month" || quarter;
  const colW = quarter ? "min-w-[16px] w-[16px]" : compact ? "min-w-[38px]" : "min-w-[130px]";
  // The 3-month view's month header: one cell per month, as wide as its days in the range.
  const monthsInRange = useMemo(() => {
    const out: { key: string; days: number }[] = [];
    for (const d of days) {
      const k = d.slice(0, 7);
      if (out.length && out[out.length - 1].key === k) out[out.length - 1].days++;
      else out.push({ key: k, days: 1 });
    }
    return out;
  }, [days]);

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
          {(["day", "week", "month", "quarter"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`whitespace-nowrap px-3 py-1.5 ${view === v ? "bg-brand-600 text-white" : "bg-panel text-gray-400 hover:text-gray-200"}`}
            >
              {VIEW_LABEL[v]}
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
          className="w-full max-w-56 rounded-md sm:w-56 border border-edge bg-panel px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <div className="flex overflow-hidden rounded-md border border-edge text-xs font-semibold uppercase tracking-wide">
          {(["ALL", "DAY", "NIGHT"] as ShiftFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setShift(v)}
              className={`flex items-center gap-1 px-3 py-1.5 ${
                shift === v ? "bg-brand-600 text-white" : "bg-panel text-gray-400 hover:text-gray-200"
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
          <span>Empty box = nothing allocated</span>
          <span className="text-amber-300">Amber = gear but no crew</span>
          <span className="text-red-300">Red = no supervisor</span>
          <span className="text-blue-300">▶ = project starts</span>
        </div>
      </div>
      {view !== "day" && (
        // The planned span's legend (12 Nov 2026) - each mark drawn as it is on the grid.
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span className="font-semibold uppercase tracking-wide text-gray-600">Planned span</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-6 rounded-full bg-brand-500/80" /> start confirmed</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-6 rounded-full border border-dashed border-brand-400 bg-brand-500/25" /> start tentative</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-6 rounded-full bg-gray-500/70" /> inactive</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-6 rounded-l-full bg-brand-500/80 [mask-image:linear-gradient(to_right,black,transparent)]" /> finish TBC</span>
          <span className="flex items-center gap-1.5 text-amber-600">
            <span className="inline-block h-1.5 w-6 rounded-full bg-[repeating-linear-gradient(135deg,rgb(245_158_11/0.85)_0_3px,rgb(245_158_11/0.35)_3px_6px)]" /> ⚠ past expected finish
          </span>
        </div>
      )}

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
          {/* Every day/project pair is its own bordered box. A box stays empty until
              something has been allocated to that project on that day. */}
          <table className="w-full border-collapse text-left">
            <thead>
              {quarter && (
                <tr className="bg-panel">
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-20 w-[150px] min-w-[150px] max-w-[150px] border border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:w-[190px] sm:min-w-[190px] sm:max-w-[190px]"
                  >
                    Project
                  </th>
                  {monthsInRange.map((m) => (
                    <th
                      key={m.key}
                      colSpan={m.days}
                      className="border border-edge px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400"
                    >
                      <span className="sticky left-[158px] sm:left-[198px]">{fmtDay(`${m.key}-01`, { month: "long", year: "numeric" })}</span>
                    </th>
                  ))}
                </tr>
              )}
              <tr className="bg-panel">
                {!quarter && (
                  <th className="sticky left-0 z-20 w-[150px] min-w-[150px] max-w-[150px] border border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:w-[190px] sm:min-w-[190px] sm:max-w-[190px]">
                    Project
                  </th>
                )}
                {days.map((d) => (
                  <th
                    key={d}
                    data-today={d === today ? "" : undefined}
                    title={quarter ? fmtDay(d, { weekday: "short", day: "numeric", month: "short" }) : undefined}
                    className={`${colW} border border-edge ${quarter ? "px-0" : "px-1"} py-1.5 text-center text-[10px] font-semibold uppercase ${weekStart(d)} ${
                      d === today ? "bg-blue-900/40 text-blue-200" : soon(d) ? "bg-amber-950/30 text-amber-200/80" : "text-gray-500"
                    } ${isWeekend(d) ? "opacity-70" : ""}`}
                  >
                    {quarter ? (
                      // Mondays carry the date; the other days are just columns.
                      <div className="text-[9px] leading-none">{parseISO(d).getDay() === 1 || d === today ? Number(d.slice(8)) : " "}</div>
                    ) : (
                      <>
                        <div>{fmtDay(d, { weekday: "short" })}</div>
                        <div className="text-xs">{Number(d.slice(8))}</div>
                      </>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td
                    className="sticky left-0 z-10 w-[150px] min-w-[150px] max-w-[150px] border border-edge bg-canvas px-2 py-1.5 sm:w-[190px] sm:min-w-[190px] sm:max-w-[190px] sm:px-3"
                    title={row.span ? spanTitle(row.span) : undefined}
                  >
                    <div className="truncate text-sm font-semibold text-gray-100">{row.name}</div>
                    {row.jobNo && <div className="truncate text-[11px] text-gray-500">{row.jobNo}</div>}
                    {row.span && <SpanTags span={row.span} />}
                  </td>
                  {days.map((d) => {
                    const cell = row.jobs.filter((j) => j.date === d && hasAllocation(j));
                    const starts = row.startDate === d;
                    const onSpan = !!row.span && d >= row.span.from && d <= row.span.to;
                    return (
                      <td
                        key={d}
                        className={`${quarter ? "h-10" : "h-12"} border border-edge p-0 align-top ${weekStart(d)} ${
                          d === today ? "bg-blue-900/15" : isWeekend(d) ? "bg-panel2/70" : "bg-panel"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openDetail(row.key, row.name, row.jobNo, row.startDate, d)}
                          title={onSpan ? `${spanTitle(row.span!)} - show details` : "Show details"}
                          className={`relative flex h-full ${quarter ? "min-h-[2.25rem] gap-px p-px pb-3" : "min-h-[2.75rem] gap-0.5 p-0.5 pb-3"} w-full flex-col text-left hover:bg-panel2`}
                        >
                          {row.span && <SpanPiece span={row.span} day={d} />}
                          {starts && !quarter && (
                            <span className="relative rounded bg-brand-600 px-1 py-0.5 text-center text-[9px] font-bold uppercase text-white">
                              ▶ {compact ? "" : "start"}
                            </span>
                          )}
                          {starts && quarter && <span className="relative text-center text-[9px] leading-none text-brand-300">▶</span>}
                          {cell.map((j) =>
                            quarter ? <JobMark key={j.id} job={j} /> : <JobPill key={j.id} job={j} compact={compact} />
                          )}
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
      {view !== "day" && !loading && noDatesShown.length > 0 && (
        // Projects that can't be drawn (12 Nov 2026): no start date, or paused with no date to come back. Collapsed,
        // so the gap is visible without taking over the page.
        <details className="mt-3 rounded-lg border border-edge bg-panel px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-gray-400">
            No dates yet ({noDatesShown.length})
          </summary>
          <p className="mt-1 text-[11px] text-gray-500">
            Not drawn on the calendar: set a start date (and expected completion) on the project page to show its span.
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {noDatesShown.map((p) => {
              const href = coordinatorHref(`/projects/${p.projectId}`, coordinatorOnly);
              const name = (
                <>
                  <span className="font-medium text-gray-200">{p.name}</span>
                  {p.jobNo && <span className="text-gray-500"> · {p.jobNo}</span>}
                </>
              );
              return (
                <li key={p.projectId} className="min-w-0 truncate text-xs">
                  {href ? <Link href={href} className="hover:underline">{name}</Link> : name}
                  <span className="text-gray-500">
                    {" "}
                    · {p.status === "ACTIVE" ? "active" : "inactive"},{" "}
                    {p.reason === "NO_RESTART" ? "paused, finish TBC, no restart date" : "no start date"}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
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
          plan={(() => {
            const s = spans.find((x) => x.projectId === detail.key);
            return s ? spanTitle(s) : undefined;
          })()}
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
          onProjectReactivated={() => { load(); }}
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
        <div key={p.id} className="mb-2 rounded-md border border-brand-500/50 bg-brand-950/30 px-3 py-2 text-sm text-brand-200">
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
                : "border-edge bg-panel hover:border-brand-500/60"
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
