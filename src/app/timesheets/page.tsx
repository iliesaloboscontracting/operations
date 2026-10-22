"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, TriangleAlert } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import type { TimesheetLine, TimesheetPerson } from "@/lib/timesheets";

// Timesheets (21 Oct 2026): Lobos staff hours for a Monday-Sunday week from
// site sign-ins, across every site, office, yard and truck. A Manager
// approves the week (it then can't change), exports it for accounts, and can
// go back to any earlier week. Hours only - no pay rates.

type Data = {
  weekStart: string;
  weekEnd: string;
  days: string[];
  today: string;
  weekEnded: boolean;
  people: TimesheetPerson[];
  totalHours: number;
  issues: number;
  approval: { approvedBy: string; approvedAt: string } | null;
  changedSinceApproval: number;
  history: { id: string; approvedBy: string; approvedAt: string; totalHours: number; people: number; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null }[];
};

const shiftDate = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localISODate(d);
};
const dayHead = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
const longDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const hrs = (n: number | null) => (n == null ? "–" : n % 1 === 0 ? `${n}h` : `${n.toFixed(2).replace(/0$/, "")}h`);

function Tile({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
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
      {(onNow || noOut || pending || zero || l.changedByOffice || !l.allocated) && (
        <div className="text-[10px] leading-tight text-amber-400">
          {[onNow && "on site now", noOut && "no sign-out", pending && "to confirm", zero && "check: 0h", l.changedByOffice && "office changed", !l.allocated && "not allocated"].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

// By site (21 Oct 2026, Ilies): each project (then office, yard, trucks) as
// its own tile with the people who worked there under it, Monday-Sunday.
function SiteView({ data, search }: { data: Data; search: string }) {
  const lines = data.people.flatMap((p) => Object.values(p.days).flat());
  const sites = new Map<string, TimesheetLine[]>();
  for (const l of lines) sites.set(l.site, [...(sites.get(l.site) ?? []), l]);
  const groups = [...sites.entries()]
    .map(([site, ls]) => {
      const people = new Map<string, TimesheetLine[]>();
      for (const l of ls) people.set(l.resourceId, [...(people.get(l.resourceId) ?? []), l]);
      return {
        site,
        point: ls.some((l) => l.point),
        total: Math.round(ls.reduce((n, l) => n + (l.hours ?? 0), 0) * 4) / 4,
        issues: ls.filter((l) => (!l.out && !l.onSite) || l.status === "TO_CONFIRM").length,
        people: [...people.values()]
          .map((pl) => ({ id: pl[0].resourceId, name: pl[0].name, role: pl[0].role, lines: pl, total: Math.round(pl.reduce((n, l) => n + (l.hours ?? 0), 0) * 4) / 4 }))
          .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((g) => g.people.length > 0)
    // Project sites first (A-Z), then the office, yard and trucks.
    .sort((a, b) => Number(a.point) - Number(b.point) || a.site.localeCompare(b.site));

  if (groups.length === 0) return <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">No staff sign-ins this week.</p>;
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
                  <th className="px-3 py-1.5 text-right">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60 bg-panel/60 align-top">
                {g.people.map((p) => (
                  <tr key={p.id}>
                    <td className="sticky left-0 z-10 bg-panel px-3 py-2">
                      <div className="font-medium text-gray-100">{p.name}</div>
                      <div className="text-[11px] text-gray-500">{p.role ?? ""}</div>
                    </td>
                    {data.days.map((d) => (
                      <td key={d} className="w-32 space-y-1 px-1.5 py-1.5">
                        {p.lines.filter((l) => l.date === d).map((l) => (
                          <Entry key={l.attendanceId} l={l} today={data.today} showSite={false} />
                        ))}
                      </td>
                    ))}
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

export default function TimesheetsPage() {
  const { canEdit, isAdmin, timesheetsOnly } = useAuth();
  const [week, setWeek] = useState(() => localISODate());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"site" | "person">("site");

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/timesheets?week=${week}`);
    if (!res.ok) return setError(res.status === 403 ? "Timesheets are for managers." : "Couldn't load timesheets.");
    setError(null);
    setData(await res.json());
  }, [week]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: "approve" | "reopen") => {
    let reason: string | null = null;
    if (action === "reopen") {
      reason = window.prompt("Why is this week being reopened? (kept on record)");
      if (!reason) return;
    } else if (!window.confirm(`Approve ${data?.people.length} people, ${hrs(data?.totalHours ?? 0)} for the week of ${longDate(data!.weekStart)}? Its sign-ins will be locked.`)) {
      return;
    }
    setBusy(true);
    const res = await apiFetch("/api/timesheets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: data!.weekStart, action, reason }) });
    setBusy(false);
    if (!res.ok) return window.alert((await res.json().catch(() => ({}))).error ?? "That didn't work.");
    load();
  };

  if (!canEdit && !timesheetsOnly) return <PageShell title="Timesheets"><p className="text-sm text-gray-400">Timesheets are for managers.</p></PageShell>;

  const people = (data?.people ?? []).filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  const dayTotals = (data?.days ?? []).map((d) => (data?.people ?? []).reduce((n, p) => n + (p.days[d] ?? []).reduce((m, l) => m + (l.hours ?? 0), 0), 0));

  return (
    <PageShell title="Timesheets" subtitle={`Lobos staff hours for the week from site sign-ins - every site, the office, yard and trucks.${timesheetsOnly ? "" : " Approve the week, then export it for accounts."}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="rounded-lg border border-edge p-2 text-gray-300 hover:bg-panel2" onClick={() => setWeek(shiftDate(data?.weekStart ?? week, -7))} aria-label="Previous week">
          <ChevronLeft size={16} />
        </button>
        <input
          type="date"
          value={week}
          onChange={(e) => e.target.value && setWeek(e.target.value)}
          className="rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200"
        />
        <button className="rounded-lg border border-edge p-2 text-gray-300 hover:bg-panel2" onClick={() => setWeek(shiftDate(data?.weekStart ?? week, 7))} aria-label="Next week">
          <ChevronRight size={16} />
        </button>
        {data && (
          <span className="text-sm text-gray-300">
            Week {longDate(data.weekStart)} – {longDate(data.weekEnd)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {data?.approval && isAdmin && (
            <button disabled={busy} onClick={() => act("reopen")} className="rounded-lg border border-edge px-3.5 py-2 text-sm text-gray-300 hover:bg-panel2">
              Reopen week
            </button>
          )}
          {data && !data.approval && canEdit && (
            <button
              disabled={busy || !data.weekEnded || data.issues > 0 || data.people.length === 0}
              onClick={() => act("approve")}
              title={!data.weekEnded ? "The week hasn't finished yet" : data.issues > 0 ? "Sort out the flagged sign-ins first" : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Lock size={14} /> Approve week
            </button>
          )}
          {timesheetsOnly && <span className="self-center rounded-full bg-gray-700/60 px-3 py-1 text-xs text-gray-300">Review only</span>}
          {data && canEdit && (
            <a href={`/api/timesheets/export?week=${data.weekStart}`} className="flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-200 hover:bg-panel2">
              <Download size={14} /> Export for accounts{data.approval ? "" : " (draft)"}
            </a>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {!data && !error && <div className="py-10 text-center text-sm text-gray-500">Loading...</div>}

      {data && (
        <>
          {data.approval ? (
            <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              <Lock size={14} className="mr-1.5 inline" />
              Approved by {data.approval.approvedBy} on {when(data.approval.approvedAt)}. This is what the export sends; the week&apos;s sign-ins are locked.
              {data.changedSinceApproval > 0 && (
                <span className="mt-1 block text-amber-300">
                  {data.changedSinceApproval} sign-in{data.changedSinceApproval === 1 ? "" : "s"} for this week differ from what was approved - reopen the week to bring them in.
                </span>
              )}
            </div>
          ) : (
            <div className={`mb-4 rounded-xl border p-3 text-sm ${data.issues ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-edge bg-panel text-gray-400"}`}>
              {data.issues > 0 ? (
                <>
                  <TriangleAlert size={14} className="mr-1.5 inline" />
                  {data.issues} sign-in{data.issues === 1 ? "" : "s"} need sorting on the Sign-ins page (no sign-out, or waiting for the supervisor) before this week can be approved.
                </>
              ) : !data.weekEnded ? (
                "This week is still running - it can be approved from Monday."
              ) : (
                "Not approved yet. Check the hours, then approve the week to lock it before sending to accounts."
              )}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="People" value={data.people.length} />
            <Tile label="Total hours" value={hrs(data.totalHours)} />
            <Tile label="Need sorting" value={data.issues} tone={data.issues ? "text-amber-400" : ""} />
            <Tile label="Status" value={data.approval ? "Approved" : "Draft"} tone={data.approval ? "text-emerald-400" : "text-gray-300"} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {([
                ["site", "By site"],
                ["person", "By person"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                    view === k ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              placeholder="Search a name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-xs rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200"
            />
          </div>

          {view === "site" ? (
            <SiteView data={data} search={search} />
          ) : people.length === 0 ? (
            <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">No staff sign-ins this week.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-edge shadow-soft">
              <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
                <thead className="bg-panel text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="sticky left-0 z-10 w-44 bg-panel px-3 py-2">Employee</th>
                    {data.days.map((d) => (
                      <th key={d} className={`px-2 py-2 ${d === data.today ? "text-brand-300" : ""}`}>{dayHead(d)}</th>
                    ))}
                    <th className="px-3 py-2 text-right">Week</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge/60 bg-panel/60 align-top">
                  {people.map((p) => (
                    <tr key={p.resourceId}>
                      <td className="sticky left-0 z-10 bg-panel px-3 py-2">
                        <div className="font-medium text-gray-100">{p.name}</div>
                        <div className="text-[11px] text-gray-500">{p.role ?? ""}</div>
                      </td>
                      {data.days.map((d) => (
                        <td key={d} className="w-32 space-y-1 px-1.5 py-1.5">
                          {(p.days[d] ?? []).map((l) => (
                            <Entry key={l.attendanceId} l={l} today={data.today} />
                          ))}
                        </td>
                      ))}
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
                    <td className="px-3 py-2 text-right text-sm font-bold text-gray-100">{hrs(data.totalHours)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {data.history.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Approval history</div>
              <ul className="space-y-1 text-xs text-gray-400">
                {data.history.map((h) => (
                  <li key={h.id}>
                    Approved by {h.approvedBy} on {when(h.approvedAt)} - {h.people} people, {hrs(h.totalHours)}
                    {h.reopenedAt && (
                      <span className="text-amber-400"> · reopened by {h.reopenedBy} on {when(h.reopenedAt)}: {h.reopenReason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-4 text-[11px] text-gray-500">
            Hours = signed in to signed out, less the site&apos;s unpaid break (office, yard and trucks: 30 min), to the nearest quarter hour. Lobos staff only - hire and subcontractor workers are on the Sign-ins page. To fix a time, use the Sign-ins page (the change and reason are kept).
          </p>
        </>
      )}
    </PageShell>
  );
}
