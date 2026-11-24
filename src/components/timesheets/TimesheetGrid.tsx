"use client";

import { useCallback, useEffect, useState } from "react";
import type { TimesheetLine, TimesheetPerson, TipRunLine, TravelLine } from "@/lib/timesheets";
import type { SupervisorLine } from "@/lib/payroll/store";
import { allPlaces, mondayOf } from "@/lib/timesheetView";
import { TIP_FLAG_LABEL, tipNeedsOffice } from "@/lib/tipRun/rules";
import { markWords, timesheetDayCell, type AbsenceLine } from "@/lib/absence/rules";
import { amberFlag, FLAG_LABEL, modeMissing, modeOf, paidText, paidTravelHours } from "@/lib/travel/rules";

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
  travelPaidHours?: number; // travel pay (23-24 Nov 2026): the paid part of travelHours
  travelModeMissing?: number; // legs with hours but no mode (recorded before it was asked) - no paid figure
  tipRunHours?: number; // regional tip runs (19 Nov 2026) - worked hours, the part of totalHours that is tip runs
  tipRunIssues?: number;
  absenceDays?: number; // Sick / Not in days marked this week (23 Nov 2026) - information only, no hours
  issues: number;
  approval: { approvedBy: string; approvedAt: string } | null;
  changedSinceApproval: number;
  history: { id: string; approvedBy: string; approvedAt: string; totalHours: number; people: number; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null }[];
  accounts?: Record<string, { status: string; note: string | null; by: string }>; // Accounts stage 2: Victoria's decision per person
  // The Sign-ins page's flag counts for the week so far (10 Nov 2026) - the office only, information only.
  signInFlags?: { toConfirm: number; late: number; longDay: number; noSignIn: number; location?: number };
  // The supervisors' "Approve hours" per sign-in line (18 Nov 2026) - Managers and Admins only, information only.
  supervisor?: Record<string, SupervisorLine>;
};

// The supervisor's approval of one line, in words (lib/payroll/rules.ts dayState - the same rule accounts' Payroll uses).
export const SUPERVISOR_WORDS: Record<string, { text: string; tone: string }> = {
  APPROVED: { text: "✓ supervisor approved", tone: "text-emerald-400" },
  FLAGGED: { text: "⚑ supervisor flagged", tone: "text-orange-300" },
  CHANGED: { text: "changed since supervisor approved", tone: "text-orange-300" },
  NOT_APPROVED: { text: "not approved by supervisor", tone: "text-amber-400" },
};
// A person's week: days with site sign-ins, and how many of them the supervisor approved in full.
export function supervisorDays(p: TimesheetPerson, sup?: Record<string, SupervisorLine>) {
  if (!sup) return null;
  let days = 0, approved = 0;
  for (const ls of Object.values(p.days)) {
    const site = ls.filter((l) => !l.point && sup[l.attendanceId] && sup[l.attendanceId].state !== "NO_SUPERVISOR");
    if (!site.length) continue;
    days++;
    if (site.every((l) => sup[l.attendanceId].state === "APPROVED")) approved++;
  }
  return days ? { days, approved } : null;
}
function SupervisorWeek({ p, sup }: { p: TimesheetPerson; sup?: Record<string, SupervisorLine> }) {
  const d = supervisorDays(p, sup);
  if (!d) return null;
  return (
    <div className={`text-[11px] ${d.approved === d.days ? "text-emerald-400" : "text-amber-400"}`} data-testid="supervisor-days">
      Supervisor approved {d.approved} of {d.days} day{d.days === 1 ? "" : "s"}
    </div>
  );
}

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

function Entry({ l, today, showSite = true, sup }: { l: TimesheetLine; today: string; showSite?: boolean; sup?: SupervisorLine }) {
  const sw = sup && !l.point ? SUPERVISOR_WORDS[sup.state] : undefined;
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
      {sw && (
        <div className={`text-[10px] leading-tight ${sw.tone}`} title={sup?.by ? `${sup.state === "NOT_APPROVED" ? "Day approved" : "Approved"} by ${sup.by}${sup.at ? ` on ${when(sup.at)}` : ""}${sup.flag ? ` - "${sup.flag}"` : ""}` : "The supervisor hasn't approved this day's hours"}>
          {sw.text}{sup?.by && sup.state !== "NOT_APPROVED" ? ` (${sup.by.split(" ")[0]})` : ""}
        </div>
      )}
    </div>
  );
}

// Regional travel (2 Nov 2026): one leg - out (to site) or home - with its own hours. Travel pay (23-24 Nov 2026): the
// paid hours under it - "paid 1h (passenger)" / "paid 2h (own vehicle)" - or "mode not recorded" (amber, for the office).
// Crew travel (24 Nov 2026): worked out from their driver - "paid 1h (with Turori's truck)"; "no driver found" and (TP-001)
// "overlaps a sign-in - not paid" are amber too.
const TRAVEL_FLAG: Record<string, string> = FLAG_LABEL;
function TravelChip({ t }: { t: TravelLine }) {
  const warn = amberFlag(t.flag);
  const noMode = modeMissing({ hours: t.hours, mode: modeOf(t.mode) });
  const paid = paidText({ hours: t.hours, mode: modeOf(t.mode), paidHours: t.paidHours, via: t.via });
  return (
    <div className={`rounded-md border px-1.5 py-1 ${warn ? "border-amber-500/50 bg-amber-500/10" : "border-sky-500/40 bg-sky-500/10"}`} title={[t.site, t.changedByOffice ? "Office changed: " + t.changedByOffice : null].filter(Boolean).join("\n")} data-testid="travel-leg">
      <div className="flex items-baseline justify-between gap-1">
        <span className="whitespace-nowrap text-[10px] text-sky-300">{t.direction === "OUT" ? "Travel out" : "Travel home"}</span>
        <span className="text-xs font-semibold text-sky-200">{hrs(t.hours)}</span>
      </div>
      <div className="whitespace-nowrap text-[10px] text-gray-500">{t.start}–{t.end ?? "?"}</div>
      {paid && <div className={`text-[10px] leading-tight ${noMode ? "text-amber-400" : "text-sky-300"}`} data-testid="travel-paid">{paid}</div>}
      {(t.flag || t.changedByOffice) && <div className="text-[10px] leading-tight text-amber-400">{[t.flag && TRAVEL_FLAG[t.flag], t.changedByOffice && "office changed"].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}
// "2h · paid 1h" for a travel total cell.
const travelCell = (total: number, paid: number | undefined) => (total ? `${hrs(total)} · paid ${hrs(paid ?? 0)}` : "");

// Regional tip run (19 Nov 2026): worked hours on the shift's day, in its own box.
const TIP_FLAG: Record<string, string> = TIP_FLAG_LABEL;
function TipRunChip({ r }: { r: TipRunLine }) {
  const warn = tipNeedsOffice(r.flag);
  return (
    <div className={`rounded-md border px-1.5 py-1 ${warn ? "border-amber-500/50 bg-amber-500/10" : "border-violet-500/40 bg-violet-500/10"}`} title={[r.site, r.changedByOffice ? "Office changed: " + r.changedByOffice : null].filter(Boolean).join("\n")} data-testid="tip-run">
      <div className="flex items-baseline justify-between gap-1">
        <span className="whitespace-nowrap text-[10px] text-violet-300">Tip run</span>
        <span className="text-xs font-semibold text-violet-200">{hrs(r.hours)}</span>
      </div>
      <div className="whitespace-nowrap text-[10px] text-gray-500">{r.start}–{r.end ?? "?"}</div>
      {(r.flag || r.changedByOffice) && <div className="text-[10px] leading-tight text-amber-400">{[r.flag && TIP_FLAG[r.flag], r.changedByOffice && "office changed"].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}

// "Not in today" (23 Nov 2026): a day the office marked Sick / Not in - grey, no hours. Amber "Marked Sick but signed
// in" when they signed in that day too: the sign-in's hours stand, someone checks the mark.
function AbsenceChip({ a, linesThatDay }: { a: AbsenceLine; linesThatDay: TimesheetLine[] }) {
  const cell = timesheetDayCell(a, linesThatDay);
  if (!cell) return null;
  return (
    <div
      className={`rounded-md border px-1.5 py-1 ${cell.warn ? "border-amber-500/50 bg-amber-500/10" : "border-gray-500/40 bg-gray-600/20"}`}
      title={markWords({ ...a, id: a.absenceId, cancelledAt: null, cancelledBy: null, cancelReason: null }, when)}
      data-testid="absence-day"
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[11px] font-semibold text-gray-200">{a.label}</span>
        <span className="text-[10px] text-gray-500">no hours</span>
      </div>
      {cell.warn && <div className="text-[10px] leading-tight text-amber-400">{cell.text}</div>}
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
  // ...and regional tip runs (19 Nov 2026) with the shift's site - worked hours there.
  const tips = data.people.flatMap((p) => Object.values(p.tipRuns ?? {}).flat());
  for (const r of tips) if (!sites.has(r.site)) sites.set(r.site, []);
  const q4 = (n: number) => Math.round(n * 4) / 4;
  const groups = [...sites.entries()]
    .map(([site, ls]) => {
      const people = new Map<string, TimesheetLine[]>();
      for (const l of ls) people.set(l.resourceId, [...(people.get(l.resourceId) ?? []), l]);
      const tl = travel.filter((t) => t.site === site);
      const rl = tips.filter((r) => r.site === site);
      const names = new Map([...tl, ...rl].map((t) => [t.resourceId, { name: t.name, role: t.role }]));
      for (const t of [...tl, ...rl]) if (!people.has(t.resourceId)) people.set(t.resourceId, []);
      return {
        site,
        point: ls.some((l) => l.point),
        total: q4(ls.reduce((n, l) => n + (l.hours ?? 0), 0) + rl.reduce((n, r) => n + (r.hours ?? 0), 0)),
        issues: ls.filter((l) => (!l.out && !l.onSite) || l.status === "TO_CONFIRM").length + rl.filter((r) => tipNeedsOffice(r.flag)).length,
        people: [...people.entries()]
          .map(([id, pl]) => {
            const pt = tl.filter((t) => t.resourceId === id);
            const pr = rl.filter((r) => r.resourceId === id);
            const tipTotal = q4(pr.reduce((n, r) => n + (r.hours ?? 0), 0));
            return { id, name: pl[0]?.name ?? names.get(id)!.name, role: pl[0]?.role ?? names.get(id)!.role, lines: pl, travel: pt, tips: pr, tipTotal, total: q4(pl.reduce((n, l) => n + (l.hours ?? 0), 0) + tipTotal), travelTotal: q4(pt.reduce((n, t) => n + (t.hours ?? 0), 0)), travelPaid: q4(pt.reduce((n, t) => n + (t.paidHours ?? paidTravelHours(t.hours, modeOf(t.mode)) ?? 0), 0)) };
          })
          .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((g) => g.people.length > 0)
    // Project sites first (A-Z), then the office, yard and trucks.
    .sort((a, b) => Number(a.point) - Number(b.point) || a.site.localeCompare(b.site));

  // Sick / Not in (23 Nov 2026) belong to no site - listed after the sites, with no hours.
  const off = data.people.filter((p) => p.absences && Object.keys(p.absences).length && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  if (groups.length === 0 && off.length === 0) return <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">{emptyText}</p>;
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
                  <th className="px-3 py-1.5 text-right">Tip run</th>
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
                          <Entry key={l.attendanceId} l={l} today={data.today} showSite={false} sup={data.supervisor?.[l.attendanceId]} />
                        ))}
                        {p.tips.filter((r) => r.date === d).map((r) => <TipRunChip key={r.tipRunId} r={r} />)}
                        {p.travel.filter((t) => t.date === d).map((t) => <TravelChip key={t.legId} t={t} />)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-sky-200">{travelCell(p.travelTotal, p.travelPaid)}</td>
                    <td className="px-3 py-2 text-right text-violet-200">{p.tipTotal ? hrs(p.tipTotal) : ""}</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-100">{hrs(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {off.length > 0 && <AbsenceList people={off} days={data.days} />}
    </div>
  );
}

// "By site": the week's Sick / Not in days (23 Nov 2026) - one line per person, no hours.
function AbsenceList({ people, days }: { people: TimesheetPerson[]; days: string[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-edge shadow-soft" data-testid="absence-list">
      <header className="border-b border-edge bg-panel px-4 py-2.5 text-sm font-semibold text-gray-100">Sick / Not in <span className="text-xs font-normal text-gray-400">· marked by the office · no hours</span></header>
      <ul className="divide-y divide-edge/60 bg-panel/60 text-sm">
        {people.map((p) => (
          <li key={p.resourceId} className="flex flex-wrap items-start gap-2 px-4 py-2">
            <span className="w-44 shrink-0 font-medium text-gray-100">{p.name}</span>
            {days.filter((d) => p.absences?.[d]).map((d) => (
              <span key={d} className="w-32 shrink-0">
                <span className="text-[10px] text-gray-500">{dayHead(d)}</span>
                <AbsenceChip a={p.absences![d]} linesThatDay={p.days[d] ?? []} />
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

// By person: one row per person, their sign-ins under each day, the week total, and a day-total footer.
export function PersonView({ data, search, emptyText = "No staff sign-ins this week." }: { data: TimesheetData; search: string; emptyText?: string }) {
  const people = data.people.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  // Worked hours a day: sign-ins + tip runs (19 Nov 2026).
  const dayTotals = data.days.map((d) => data.people.reduce((n, p) => n + (p.days[d] ?? []).reduce((m, l) => m + (l.hours ?? 0), 0) + (p.tipRuns?.[d] ?? []).reduce((m, r) => m + (r.hours ?? 0), 0), 0));
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
            <th className="px-3 py-2 text-right">Tip run</th>
            <th className="px-3 py-2 text-right">Week</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge/60 bg-panel/60 align-top">
          {people.map((p) => (
            <tr key={p.resourceId}>
              <td className="sticky left-0 z-10 bg-panel px-3 py-2">
                <div className="font-medium text-gray-100">{p.name}</div>
                <div className="text-[11px] text-gray-500">{p.role ?? ""}</div>
                <SupervisorWeek p={p} sup={data.supervisor} />
                <AccountsNote a={data.accounts?.[p.resourceId]} />
              </td>
              {data.days.map((d) => (
                <td key={d} className="w-32 space-y-1 px-1.5 py-1.5">
                  {(p.days[d] ?? []).map((l) => (
                    <Entry key={l.attendanceId} l={l} today={data.today} sup={data.supervisor?.[l.attendanceId]} />
                  ))}
                  {(p.tipRuns?.[d] ?? []).map((r) => <TipRunChip key={r.tipRunId} r={r} />)}
                  {(p.travel?.[d] ?? []).map((t) => <TravelChip key={t.legId} t={t} />)}
                  {p.absences?.[d] && <AbsenceChip a={p.absences[d]} linesThatDay={p.days[d] ?? []} />}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-sm text-sky-200">{travelCell(p.travelTotal, p.travelPaidTotal)}</td>
              <td className="px-3 py-2 text-right text-sm text-violet-200">{p.tipRunTotal ? hrs(p.tipRunTotal) : ""}</td>
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
            <td className="px-3 py-2 text-right text-sm font-semibold text-sky-200">{travelCell(data.travelHours ?? 0, data.travelPaidHours)}</td>
            <td className="px-3 py-2 text-right text-sm font-semibold text-violet-200">{data.tipRunHours ? hrs(data.tipRunHours) : ""}</td>
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
