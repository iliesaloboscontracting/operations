"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import UpcomingAlerts from "@/components/UpcomingAlerts";
import JobDetailsModal from "@/components/JobDetailsModal";
import JobFormModal from "@/components/JobFormModal";
import { ShiftBadge } from "@/components/ShiftBadge";
import { CalendarJobDTO, ProjectDTO } from "@/lib/types";
import { localISODate } from "@/lib/resource";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { apiFetch } from "@/lib/apiFetch";
import { useAuth } from "@/components/AuthProvider";
import { coordinatorHref } from "@/lib/roles";
import { CalendarSpanDTO, CalendarSpansResponse, NoDatesDTO, spanDays, spanWords } from "@/lib/calendarSpans";
import { assignColours, buildBars, dayMarks, NEUTRAL_TILE, weekRows } from "@/lib/calendarTiles";
import { TileAgenda, TileGrid, TileLegend, TileTimeline, type TileRow } from "@/components/calendar/CalendarTiles";
import {
  addDays,
  endOfMonth,
  fmtDay,
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

const endOfWeek = (iso: string) => addDays(startOfWeek(iso), 6);

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
// The month view is a calendar grid of whole weeks (Monday to Sunday, 12 Nov 2026), so its range runs out to the
// Sunday of the last week, and back to the Monday of the first week when past days are shown.
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
  const month = view === "month";
  if (!showPast && first <= today && today <= last) {
    const end = addDays(today, minDays) > last ? addDays(today, minDays) : last;
    return [today, month ? endOfWeek(end) : end];
  }
  return month ? [startOfWeek(first), endOfWeek(last)] : [first, last];
}

function label(view: View, from: string, to: string, anchor: string) {
  if (view === "day")
    return fmtDay(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // The month grid: the month's name (its range runs out to whole weeks either side).
  if (view === "month" && from <= startOfMonth(anchor) && to >= endOfMonth(anchor)) return fmtDay(anchor, { month: "long", year: "numeric" });
  const isFullMonth = from === startOfMonth(from) && to === endOfMonth(from);
  if (view === "month" && isFullMonth) return fmtDay(from, { month: "long", year: "numeric" });
  if (view === "quarter" && from === startOfMonth(from) && to === endOfMonth(to))
    return `${fmtDay(from, { month: "short", ...(from.slice(0, 4) === to.slice(0, 4) ? {} : { year: "numeric" }) })} – ${fmtDay(to, { month: "short", year: "numeric" })}`;
  return `${fmtDay(from, { day: "numeric", month: "short" })} – ${fmtDay(to, { day: "numeric", month: "short", year: "numeric" })}`;
}

type ShiftFilter = "ALL" | "DAY" | "NIGHT";

// A job only shows on the grid once something has been allocated to it (people, plant,
// vehicles or hire). Until then its box stays completely empty - showing every job
// every day regardless of staffing turned out to be more noise than signal on a wide
// month grid, so this is back to "nothing there yet = nothing shown".
const hasAllocation = (j: CalendarJobDTO) => j.crew + j.plant + j.hire > 0;

const shortDay = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });
const shortDayYear = (iso: string) => fmtDay(iso, { day: "numeric", month: "short", year: "numeric" });

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

  // The colour pool (12 Nov 2026): the projects with a planned span from a month back to four months ahead, fetched for
  // that fixed window (not the view), so moving between months or filtering never repaints a project. Active first.
  const [colourTiers, setColourTiers] = useState<string[][] | null>(null); // null = not loaded yet
  useEffect(() => {
    let live = true;
    apiFetch(`/api/calendar/spans?from=${addDays(today, -30)}&to=${addDays(today, 120)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CalendarSpansResponse | null) => {
        if (!live) return;
        if (!d) return setColourTiers([]); // no pool: colours still come, from what is on screen
        const ids = (st: string) => d.spans.filter((x) => x.status === st).map((x) => x.projectId);
        setColourTiers([ids("ACTIVE"), ids("INACTIVE")]);
      })
      .catch(() => live && setColourTiers([]));
    return () => {
      live = false;
    };
  }, [today]);

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

  // The 3-month timeline opens scrolled so today sits just right of the sticky project column (a week of past days
  // shows when "Show past days" is on).
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const el = box.querySelector<HTMLElement>("[data-today]");
    const name = box.querySelector<HTMLElement>("[data-name-col]");
    if (!el) return void (box.scrollLeft = 0);
    const x = el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
    box.scrollLeft = Math.max(0, x - (name?.offsetWidth ?? 0) - 7 * 16);
  }, [loading, view, from, colourTiers]);

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

  // Tiles (12 Nov 2026): each project's bars (its planned span joined with its days on the board), the board's marks per
  // day, and its colour. Colours come from every open project, not the ones on screen, so a filter or another month
  // never repaints one (lib/calendarTiles.ts assignColours).
  const colours = useMemo(() => assignColours(colourTiers ?? [], rows.map((r) => r.key)), [colourTiers, rows]);
  const tiles: TileRow[] = useMemo(
    () =>
      rows
        .map((r) => {
          const marks = dayMarks(r.jobs);
          const booked = [...marks].filter(([, m]) => m.booked).map(([d]) => d);
          return {
            key: r.key,
            name: r.name,
            jobNo: r.jobNo,
            span: r.span,
            bars: buildBars(r.key, r.span, booked, from, to),
            marks,
            colour: colours.get(r.key) ?? NEUTRAL_TILE,
          };
        })
        .filter((t) => t.bars.length > 0),
    [rows, from, to, colours]
  );
  // Lane and list order: by start (the first bar), then name.
  const orderedTiles = useMemo(
    () => [...tiles].sort((a, b) => a.bars[0].from.localeCompare(b.bars[0].from) || a.name.localeCompare(b.name)),
    [tiles]
  );
  const order = useMemo(() => orderedTiles.map((t) => t.key), [orderedTiles]);
  const weeks = useMemo(() => (view === "month" ? weekRows(from, to) : [days]), [view, from, to, days]);
  const openTile = (key: string, date: string) => {
    const r = rows.find((x) => x.key === key);
    if (r) openDetail(r.key, r.name, r.jobNo, r.startDate, date);
  };

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
        <div className="text-sm font-semibold text-gray-100">{label(view, from, to, anchor)}</div>
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
      </div>
      {view !== "day" && <TileLegend rows={orderedTiles} />}

      {loading || (view !== "day" && !colourTiers) ? (
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
      ) : orderedTiles.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-600">Nothing scheduled in this period.</div>
      ) : view === "quarter" ? (
        // 3 months: a timeline, one row per project, each a thick labelled tile (it scrolls inside its own box on a
        // phone, never the page).
        <TileTimeline
          days={days}
          today={today}
          rows={orderedTiles}
          onOpen={openTile}
          scrollerRef={scroller}
          nameCell={(r) => (
            <div title={r.span ? spanTitle(r.span) : "No planned dates - drawn over its days on the board"}>
              <div className="truncate text-sm font-semibold text-gray-100">{r.name}</div>
              {r.jobNo && <div className="truncate text-[11px] text-gray-500">{r.jobNo}</div>}
              {r.span && <SpanTags span={r.span} />}
            </div>
          )}
        />
      ) : (
        <>
          {/* Phones: a month / week grid is unreadable - a list by day instead. */}
          <div className="sm:hidden">
            <TileAgenda days={days} today={today} rows={orderedTiles} order={order} onOpen={openTile} />
          </div>
          <div className="hidden sm:block">
            <TileGrid weeks={weeks} from={from} to={to} today={today} rows={orderedTiles} order={order} tall={view === "week"} onOpen={openTile} />
          </div>
        </>
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
