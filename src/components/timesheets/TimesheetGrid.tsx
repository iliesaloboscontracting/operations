"use client";

import { useCallback, useEffect, useState } from "react";
import type { TimesheetLine, TimesheetPerson, TravelLine } from "@/lib/timesheets";
import { allPlaces, mondayOf } from "@/lib/timesheetView";

// The weekly timesheet grids (21 Oct 2026), shared by the Operations Timesheets page (/timesheets) and the
// read-only copy on the Accounts screen (/accounts/timesheets, 2 Nov 2026). Display only - no actions in here.

export type TimesheetData = {
  weekStart: string;
  weekEnd: string;
  days: string[];
  today: string;
  weekEnded: boolean;
  people: TimesheetPerson[];
  totalHours: number;
  travelHours?: number; // regional travel (2 Nov 2026) - its own total, never in totalHours
  travelIssues?: number;
  issues: number;
  approval: { approvedBy: string; approvedAt: string } | null;
  changedSinceApproval: number;
  history: { id: string; approvedBy: string; approvedAt: string; totalHours: number; people: number; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null }[];
  accounts?: Record<string, { status: string; note: string | null; by: string }>; // Accounts stage 2: Victoria's decision per person
  // The Sign-ins page's flag counts for the week so far (10 Nov 2026) - the office only, information only.
  signInFlags?: { toConfirm: number; late: number; longDay: number; noSignIn: number; location?: number };
};

export const dayHead = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
export const longDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
export const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const hrs = (n: number | null) => (n == null ? "–" : n % 1 === 0 ? `${n}h` : `${n.toFixed(2).replace(/0$/, "")}h`);

export function Tile({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${tone || "text-gray-100"}`}>{value}</div>
    </div>
  );
}

function Entry({ l, today, showSite = true }: { l: TimesheetLine; today: string; showSite?: boolean }) {
  const onNow = !l.out && (l.onSite ?? l.date >= today); // still on site, not a missing sign-out
  const noOut = !l.out && !onNow;
  const pending = l.status === "TO_CONFIRM";
  // In and out within a few minutes - usually a mis-tap worth a look.
  const zero = l.hours === 0;
  return (
    <div
      className={`rounded-md border px-1.5 py-1 ${noOut || pending || zero ? "border-amber-500/50 bg-amber-500/10" : "border-edge bg-panel2"}`}
      title={[l.site, l.changedByOffice ? "Office changed: " + l.changedByOffice : null, l.allocated ? null : "Not on the allocation"].filter(Boolean).join("\n")}
    >
      {showSite && <div className="truncate text-[11px] text-gray-300">{l.site}</div>}
      <div className="flex items-baseline justify-between gap-1">
        <span className="whitespace-nowrap text-[10px] text-gray-500">
          {l.in}–{l.out ?? "?"}
        </span>
        <span className="text-xs font-semibold text-gray-100">{hrs(l.hours)}</span>
      </div>
      {(onNow || noOut || pending || zero || l.overlap || l.changedByOffice || !l.allocated || !!l.flagNotes?.length) && (
        <div className="text-[10px] leading-tight text-amber-400">
          {[onNow && "on site now", noOut && "no sign-out", pending && "to confirm", zero && !l.overlap && "check: 0h", l.overlap && "overlap - counted once", l.breakMinutes > 0 && `less ${l.breakMinutes} min break`, l.changedByOffice && "office changed", !l.allocated && "not allocated", ...(l.flagNotes ?? [])].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

// Regional travel (2 Nov 2026): one leg - out (to site) or home - with its own hours.
const TRAVEL_FLAG: Record<string, string> = { ON_THE_WAY: "on the way", NOT_ENDED: "never ended - no hours", OVER_CAP: "over 8h - not counted" };
function TravelChip({ t }: { t: TravelLine }) {
  const warn = t.flag === "NOT_ENDED" || t.flag === "OVER_CAP";
  return (
    <div className={`rounded-md border px-1.5 py-1 ${warn ? "border-amber-500/50 bg-amber-500/10" : "border-sky-500/40 bg-sky-500/10"}`} title={[t.site, t.changedByOffice ? "Office changed: " + t.changedByOffice : null].filter(Boolean).join("\n")}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="whitespace-nowrap text-[10px] text-sky-300">{t.direction === "OUT" ? "Travel out" : "Travel home"}</span>
        <span className="text-xs font-semibold text-sky-200">{hrs(t.hours)}</span>
      </div>
      <div className="whitespace-nowrap text-[10px] text-gray-500">{t.start}–{t.end ?? "?"}</div>
      {(t.flag || t.changedByOffice) && <div className="text-[10px] leading-tight text-amber-400">{[t.flag && TRAVEL_FLAG[t.flag], t.changedByOffice && "office changed"].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

// Accounts stage 2: Victoria's latest decision on this person's week, if any.
function AccountsNote({ a }: { a?: { status: string; note: string | null } }) {
  if (!a) return null;
  return <div className={`text-[11px] ${a.status === "QUERY" ? "text-amber-300" : "text-emerald-400"}`}>{a.status === "QUERY" ? `Accounts query: ${a.note ?? ""}` : "Approved by accounts"}</div>;
}

// Under a name in a "By site" box (2 Nov 2026): the person's whole week across every place, and where else - so a
// box's row (one site, one truck) is never read as their week.
function WholeWeek({ person, site }: { person?: TimesheetPerson; site: string }) {
  if (!person) return null;
  const w = allPlaces(person, site);
  return (
    <div className="text-[11px] text-sky-300" data-testid="whole-week">
      Week, all places: {hrs(w.total)}{w.travelTotal ? ` + ${hrs(w.travelTotal)} travel` : ""}
      {w.also.length > 0 && <span className="text-gray-400"> (also: {w.also.join(", ")})</span>}
    </div>
  );
}

// ?week=YYYY-MM-DD in the address bar (2 Nov 2026, like the board's ?date=): opens that week (any date -> its Monday),
// and the week shown is kept there, so a link or a refresh lands on the same week. `ready` is false until the
// address bar has been read - load nothing before then.
export function useWeekInUrl(today: () => string) {
  const [week, setWeekState] = useState<string>(today);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = mondayOf(new URLSearchParams(window.location.search).get("week"));
    if (w) setWeekState(w);
    setReady(true);
  }, []);
  const setWeek = useCallback((w: string) => setWeekState(w), []);
  // Called with the Monday the server answered for: written back to the address bar.
  const shown = useCallback((weekStart: string) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("week") === weekStart) return;
    url.searchParams.set("week", weekStart);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return { week, setWeek, ready, shown };
}

// By site (21 Oct 2026, Ilies): each project (then office, yard, trucks) as
// its own tile with the people who worked there under it, Monday-Sunday.
export function SiteView({ data, search, emptyText = "No staff sign-ins this week." }: { data: TimesheetData; search: string; emptyText?: string }) {
  const lines = data.people.flatMap((p) => Object.values(p.days).flat());
  const sites = new Map<string, TimesheetLine[]>();
  for (const l of lines) sites.set(l.site, [...(sites.get(l.site) ?? []), l]);
  // Regional travel goes with the site it was to / from.
  const travel = data.people.flatMap((p) => Object.values(p.travel ?? {}).flat());
  for (const t of travel) if (!sites.has(t.site)) sites.set(t.site, []);
  const groups = [...sites.entries()]
    .map(([site, ls]) => {
      const people = new Map<string, TimesheetLine[]>();
      for (const l of ls) people.set(l.resourceId, [...(people.get(l.resourceId) ?? []), l]);
      const tl = travel.filter((t) => t.site === site);
      const names = new Map(tl.map((t) => [t.resourceId, { name: t.name, role: t.role }]));
      for (const t of tl) if (!people.has(t.resourceId)) people.set(t.resourceId, []);
      return {
        site,
        point: ls.some((l) => l.point),
        total: Math.round(ls.reduce((n, l) => n + (l.hours ?? 0), 0) * 4) / 4,
        issues: ls.filter((l) => (!l.out && !l.onSite) || l.status === "TO_CONFIRM").length,
        people: [...people.entries()]
          .map(([id, pl]) => {
            const pt = tl.filter((t) => t.resourceId === id);
            return { id, name: pl[0]?.name ?? names.get(id)!.name, role: pl[0]?.role ?? names.get(id)!.role, lines: pl, travel: pt, total: Math.round(pl.reduce((n, l) => n + (l.hours ?? 0), 0) * 4) / 4, travelTotal: Math.round(pt.reduce((n, t) => n + (t.hours ?? 0), 0) * 4) / 4 };
          })
          .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((g) => g.people.length > 0)
    // Project sites first (A-Z), then the office, yard and trucks.
    .sort((a, b) => Number(a.point) - Number(b.point) || a.site.localeCompare(b.site));

  if (groups.length === 0) return <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">{emptyText}</p>;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.site} className={`overflow-hidden rounded-xl border shadow-soft ${g.issues ? "border-amber-500/50" : "border-edge"}`}>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge bg-panel px-4 py-2.5">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-100">{g.site}</h3>
            <span className="text-xs text-gray-400">
              {g.people.length} {g.people.length === 1 ? "person" : "people"}
              {g.issues > 0 && <span className="ml-1.5 font-semibold text-amber-400">· {g.issues} to sort</span>}
            </span>
            <span className="text-sm font-bold text-gray-100">{hrs(g.total)}</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-panel/70 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="sticky left-0 z-10 w-44 bg-panel px-3 py-1.5">Employee</th>
                  {data.days.map((d) => (
                    <th key={d} className={`px-2 py-1.5 ${d === data.today ? "text-brand-300" : ""}`}>{dayHead(d)}</th>
                  ))}
                  <th className="px-3 py-1.5 text-right">Travel here</th>
                  <th className="px-3 py-1.5 text-right">Hours here</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60 bg-panel/60 align-top">
                {g.people.map((p) => (
                  <tr key={p.id}>
                    <td className="sticky left-0 z-10 bg-panel px-3 py-2">
                      <div className="font-medium text-gray-100">{p.name}</div>
                      <div className="text-[11px] text-gray-500">{p.role ?? ""}</div>
                      <WholeWeek person={data.people.find((x) => x.resourceId === p.id)} site={g.site} />
                      <AccountsNote a={data.accounts?.[p.id]} />
                    </td>
                    {data.days.map((d) => (
                      <td key={d} className="w-32 space-y-1 px-1.5 py-1.5">
                        {p.lines.filter((l) => l.date === d).map((l) => (
                          <Entry key={l.attendanceId} l={l} today={data.today} showSite={false} />
                        ))}
                        {p.travel.filter((t) => t.date === d).map((t) => <TravelChip key={t.legId} t={t} />)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-sky-200">{p.travelTotal ? hrs(p.travelTotal) : ""}</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-100">{hrs(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// By person: one row per person, their sign-ins under each day, the week total, and a day-total footer.
export function PersonView({ data, search, emptyText = "No staff sign-ins this week." }: { data: TimesheetData; search: string; emptyText?: string }) {
  const people = data.people.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  const dayTotals = data.days.map((d) => data.people.reduce((n, p) => n + (p.days[d] ?? []).reduce((m, l) => m + (l.hours ?? 0), 0), 0));
  if (people.length === 0) return <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">{emptyText}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-edge shadow-soft">
      <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
        <thead className="bg-panel text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="sticky left-0 z-10 w-44 bg-panel px-3 py-2">Employee</th>
            {data.days.map((d) => (
              <th key={d} className={`px-2 py-2 ${d === data.today ? "text-brand-300" : ""}`}>{dayHead(d)}</th>
            ))}
            <th className="px-3 py-2 text-right">Travel</th>
            <th className="px-3 py-2 text-right">Week</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge/60 bg-panel/60 align-top">
          {people.map((p) => (
            <tr key={p.resourceId}>
              <td className="sticky left-0 z-10 bg-panel px-3 py-2">
                <div className="font-medium text-gray-100">{p.name}</div>
                <div className="text-[11px] text-gray-500">{p.role ?? ""}</div>
                <AccountsNote a={data.accounts?.[p.resourceId]} />
              </td>
              {data.days.map((d) => (
                <td key={d} className="w-32 space-y-1 px-1.5 py-1.5">
                  {(p.days[d] ?? []).map((l) => (
                    <Entry key={l.attendanceId} l={l} today={data.today} />
                  ))}
                  {(p.travel?.[d] ?? []).map((t) => <TravelChip key={t.legId} t={t} />)}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-sm text-sky-200">{p.travelTotal ? hrs(p.travelTotal) : ""}</td>
              <td className={`px-3 py-2 text-right text-base font-bold ${p.issues ? "text-amber-400" : "text-gray-100"}`}>{hrs(p.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-panel text-xs text-gray-400">
          <tr>
            <td className="sticky left-0 z-10 bg-panel px-3 py-2 font-semibold">Day total</td>
            {dayTotals.map((t, i) => (
              <td key={i} className="px-2 py-2 font-semibold">{t ? hrs(Math.round(t * 4) / 4) : ""}</td>
            ))}
            <td className="px-3 py-2 text-right text-sm font-semibold text-sky-200">{data.travelHours ? hrs(data.travelHours) : ""}</td>
            <td className="px-3 py-2 text-right text-sm font-bold text-gray-100">{hrs(data.totalHours)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ViewToggle({ view, setView }: { view: "site" | "person"; setView: (v: "site" | "person") => void }) {
  return (
    <div className="flex gap-1">
      {([
        ["site", "By site"],
        ["person", "By person"],
      ] as const).map(([k, label]) => (
        <button
          key={k}
          onClick={() => setView(k)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${view === k ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ApprovalHistory({ history }: { history: TimesheetData["history"] }) {
  if (history.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Approval history</div>
      <ul className="space-y-1 text-xs text-gray-400">
        {history.map((h) => (
          <li key={h.id}>
            Approved by {h.approvedBy} on {when(h.approvedAt)} - {h.people} people, {hrs(h.totalHours)}
            {h.reopenedAt && <span className="text-amber-400"> · reopened by {h.reopenedBy} on {when(h.reopenedAt)}: {h.reopenReason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
