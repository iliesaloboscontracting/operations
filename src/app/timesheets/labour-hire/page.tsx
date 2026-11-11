"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Info, TriangleAlert } from "lucide-react";
import PageShell from "@/components/PageShell";
import HistoryButton from "@/components/HistoryButton";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import { hrs, longDate, PersonView, SiteView, Tile, useWeekInUrl, ViewToggle, when, type TimesheetData } from "@/components/timesheets/TimesheetGrid";
import type { TimesheetPerson } from "@/lib/timesheets";

// Labour hire hours (11 Nov 2026, Ilies: "a separate time sheet that's like the current one but just for labour hire
// guys (Advanced Labour Hire) ... exported in the same format ... so I can send to the labour hire company the precise
// hours of their guys"). The hire workers' sign-ins for a Monday-Sunday week, by company: the same grids as Timesheets
// and the same spreadsheet. View and export only - no approval or lock. Managers, Admins and the coordinator; the
// company-name mappings are Managers / Admins only. Hours only - never a rate.

type Company = { key: string; name: string; typed: { text: string; lines: number }[]; mappings: { typed: string; company: string; by: string }[]; groupedFrom: string; workers: number; lines: number; hours: number; unfinished: number; flagged: number; looksLikeLobos: boolean };
type Alias = { id: string; aliasText: string; alias: string; company: string; createdBy: string; createdAt: string; retiredAt: string | null; retiredBy: string | null; retireReason: string | null };
type Data = {
  weekStart: string; weekEnd: string; days: string[]; today: string; weekEnded: boolean;
  company: string; companies: Company[]; people: TimesheetPerson[]; totalHours: number; lines: number; unfinished: number; flagged: number;
  banner: string | null; aliases: Alias[]; canMap: boolean;
};

const shiftDate = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localISODate(d);
};
const input = "rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200";

export default function LabourHireHoursPage() {
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const { week, setWeek, ready, shown } = useWeekInUrl(() => localISODate());
  const [company, setCompany] = useState("all");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"site" | "person">("person");

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/timesheets/labour-hire?week=${week}&company=${encodeURIComponent(company)}`);
    if (!res.ok) return setError(res.status === 403 ? "Labour hire hours are for the office." : "Couldn't load the labour hire hours.");
    setError(null);
    const d: Data = await res.json();
    setData(d);
    shown(d.weekStart);
    if (d.company !== company) setCompany(d.company); // a company with no sign-ins this week -> All companies
  }, [week, company, shown]);
  useEffect(() => {
    if (ready) load();
  }, [load, ready]);

  // The shared grids take the staff timesheet's shape (no travel or approval here).
  const grid: TimesheetData | null = useMemo(() => data && ({
    weekStart: data.weekStart, weekEnd: data.weekEnd, days: data.days, today: data.today, weekEnded: data.weekEnded,
    people: data.people, totalHours: data.totalHours, travelHours: 0, travelIssues: 0, issues: data.unfinished,
    approval: null, changedSinceApproval: 0, history: [],
  }), [data]);

  if (!loading && !canEdit && !coordinatorOnly) return <PageShell title="Labour hire hours"><p className="text-sm text-gray-400">Labour hire hours are for the office.</p></PageShell>;

  const chosen = data?.companies.find((c) => c.key === data.company) ?? null;
  return (
    <PageShell title="Labour hire hours" subtitle="Hire workers' hours for the week from their site sign-ins, by company - to check and send to the labour hire company. View and export only.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="rounded-lg border border-edge p-2 text-gray-300 hover:bg-panel2" onClick={() => setWeek(shiftDate(data?.weekStart ?? week, -7))} aria-label="Previous week">
          <ChevronLeft size={16} />
        </button>
        <input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} className={input} />
        <button className="rounded-lg border border-edge p-2 text-gray-300 hover:bg-panel2" onClick={() => setWeek(shiftDate(data?.weekStart ?? week, 7))} aria-label="Next week">
          <ChevronRight size={16} />
        </button>
        {data && <span className="text-sm text-gray-300">Week {longDate(data.weekStart)} – {longDate(data.weekEnd)}</span>}
        <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className={`${input} min-w-[14rem]`}>
          <option value="all">All companies</option>
          {data?.companies.map((c) => <option key={c.key} value={c.key}>{c.name} ({hrs(c.hours)})</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          {coordinatorOnly && <span className="self-center rounded-full bg-gray-700/60 px-3 py-1 text-xs text-gray-300">View and export</span>}
          {data && (
            <a
              href={`/api/timesheets/labour-hire/export?week=${data.weekStart}&company=${encodeURIComponent(data.company)}`}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3.5 py-2 text-sm font-medium text-gray-200 hover:bg-panel2"
            >
              <Download size={14} /> Export {chosen ? chosen.name : "all companies"}
            </a>
          )}
          {/* PS-052: the all-companies file has every company's workers in it. */}
          {data && data.company === "all" && (
            <span className="w-full text-right text-xs text-amber-300" data-testid="lh-all-warning">
              Don&apos;t send this to a labour hire company – export one company at a time.
            </span>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {!data && !error && <div className="py-10 text-center text-sm text-gray-500">Loading...</div>}

      {data && grid && (
        <>
          <div className={`mb-4 rounded-xl border p-3 text-sm ${data.banner ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-edge bg-panel text-gray-400"}`} data-testid="lh-banner">
            {data.banner ? (
              <>
                <TriangleAlert size={14} className="mr-1.5 inline" />
                {data.banner}: no sign-out yet, or a poster sign-in the supervisor hasn&apos;t confirmed. Fix them on the <a href="/attendance" className="underline">Sign-ins page</a>.
              </>
            ) : data.lines === 0 ? "No labour hire sign-ins this week." : !data.weekEnded ? "This week is still running." : "Every line is signed out and confirmed."}
            {data.flagged > 0 && (
              <div className="mt-1.5 text-xs text-gray-300">
                {data.flagged} line{data.flagged === 1 ? "" : "s"} flagged late or long day on the Sign-ins page - worth a look <span className="text-gray-500">(information only; hours unchanged)</span>
              </div>
            )}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Workers" value={data.people.length} />
            <Tile label="Total hours" value={hrs(data.totalHours)} />
            <Tile label="Not finished" value={data.unfinished} tone={data.unfinished ? "text-amber-400" : ""} />
            <Tile label="Companies" value={data.companies.length} />
          </div>

          {/* Each company's totals and what was grouped into it (PS-051) - just the chosen one when filtered. */}
          {data.companies.length > 0 && <CompanyTotals companies={chosen ? [chosen] : data.companies} onPick={setCompany} />}
          {chosen?.looksLikeLobos && (
            <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              These people typed Lobos as their company - they&apos;re probably Lobos staff. On the Sign-ins page, use &quot;Move to&quot; to put them on their own name.
            </p>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <ViewToggle view={view} setView={setView} />
            <input placeholder="Search a name..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} w-full max-w-xs`} />
          </div>
          {view === "site"
            ? <SiteView data={grid} search={search} emptyText="No labour hire sign-ins this week." />
            : <PersonView data={grid} search={search} emptyText="No labour hire sign-ins this week." />}

          <CompanyNames data={data} reload={load} />

          <p className="mt-4 text-[11px] text-gray-500">
            Hire and subcontract workers sign in with their own name and the company they typed. Hours are worked out exactly as for staff: signed in to signed out; one unpaid break per person per day (the project&apos;s break) on any day over 4 hours (from 2 Nov 2026; 26 Oct - 1 Nov 2026 used the 5-hour rule: only a day over 5h, never taking it below 5h); time signed in twice at once counts once; each day rounded once to the quarter hour. Removed and rejected sign-ins are left out. Company names are grouped ignoring case, spaces, punctuation and words like Pty Ltd, Labour and Hire (not Group or Services - two companies can share those; map them if they are one). To fix a time, use the Sign-ins page (the change and reason are kept).
          </p>
        </>
      )}
    </PageShell>
  );
}

function CompanyTotals({ companies, onPick }: { companies: Company[]; onPick: (key: string) => void }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-xl border border-edge shadow-soft">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead className="bg-panel text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Company</th>
            <th className="px-3 py-2">Typed as</th>
            <th className="px-3 py-2 text-right">Workers</th>
            <th className="px-3 py-2 text-right">Not finished</th>
            <th className="px-3 py-2 text-right">Week</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge/60 bg-panel/60">
          {companies.map((c) => (
            <tr key={c.key}>
              <td className="px-3 py-2">
                <button className="font-medium text-brand-300 hover:underline" onClick={() => onPick(c.key)}>{c.name}</button>
              </td>
              <td className="px-3 py-2 text-xs text-gray-400">
                {c.typed.map((t) => `${t.text} (${t.lines})`).join(", ")}
                {c.mappings.length > 0 && (
                  <div className="mt-0.5 text-sky-300">
                    Office mapping{c.mappings.length === 1 ? "" : "s"}: {c.mappings.map((m) => `"${m.typed}" → ${m.company} (by ${m.by})`).join(", ")}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right text-gray-200">{c.workers}</td>
              <td className={`px-3 py-2 text-right ${c.unfinished ? "font-semibold text-amber-400" : "text-gray-500"}`}>{c.unfinished || ""}</td>
              <td className="px-3 py-2 text-right font-bold text-gray-100">{hrs(c.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Company names: what was typed, which company it counts as, and the office's mappings. Managers / Admins map a typed
// name to a company; the coordinator sees the list. A mapping is never deleted - it's retired, with a reason.
function CompanyNames({ data, reload }: { data: Data; reload: () => void }) {
  const [typed, setTyped] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const typedAll = data.companies.flatMap((c) => c.typed.map((t) => ({ text: t.text, now: c.name })));
  const live = data.aliases.filter((a) => !a.retiredAt);
  const retired = data.aliases.filter((a) => a.retiredAt);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    const res = await apiFetch("/api/timesheets/labour-hire/aliases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(j.error ?? "That didn't work.");
    reload();
    return true;
  };
  const save = async () => {
    if (await post({ action: "map", typed, company })) { setTyped(""); setCompany(""); setMsg("Saved - the week has been regrouped."); }
  };
  const retire = async (a: Alias) => {
    const reason = window.prompt(`Stop counting "${a.aliasText}" as ${a.company}? Say why (kept on record).`);
    if (reason) await post({ action: "retire", id: a.id, reason });
  };

  return (
    <section className="mt-6 rounded-xl border border-edge bg-panel p-4">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-100"><Info size={14} /> Company names</h3>
      <p className="mb-3 text-xs text-gray-400">
        Workers type their company when they sign in, so one company can be spelt several ways. Names that differ only in case, spaces, punctuation or words like Pty Ltd, Labour and Hire (not Group or Services - two companies can share those; map them if they are one) are grouped automatically.
        {data.canMap ? " For anything else (e.g. ALH), map the typed name to the company below." : " The office (Managers and Admins) maps any others."}
      </p>
      {data.canMap && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-400">
            Typed as
            <input list="lh-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="ALH" className={`${input} mt-1 block w-48`} />
            <datalist id="lh-typed">{typedAll.map((t) => <option key={t.text} value={t.text}>{t.now}</option>)}</datalist>
          </label>
          <label className="text-xs text-gray-400">
            Means the company
            <input list="lh-companies" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Advanced Labour Hire" className={`${input} mt-1 block w-64`} />
            <datalist id="lh-companies">{data.companies.map((c) => <option key={c.key} value={c.name} />)}</datalist>
          </label>
          <button disabled={busy || !typed.trim() || company.trim().length < 2} onClick={save} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40">
            Save mapping
          </button>
          {msg && <span className="self-center text-xs text-gray-300">{msg}</span>}
        </div>
      )}
      {live.length === 0 && retired.length === 0 ? (
        <p className="text-xs text-gray-500">No mappings yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {live.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2 text-gray-200">
              <span>&quot;{a.aliasText}&quot; counts as <b>{a.company}</b></span>
              <span className="text-xs text-gray-500">- {a.createdBy}, {when(a.createdAt)}</span>
              {data.canMap && <button disabled={busy} onClick={() => retire(a)} className="text-xs text-gray-400 underline hover:text-gray-200">Retire</button>}
              {data.canMap && <HistoryButton model="LabourHireCompanyAlias" id={a.id} />}
            </li>
          ))}
          {retired.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2 text-gray-500">
              <span className="line-through">&quot;{a.aliasText}&quot; - {a.company}</span>
              <span className="text-xs">retired by {a.retiredBy} on {when(a.retiredAt!)}: {a.retireReason}</span>
              {data.canMap && <HistoryButton model="LabourHireCompanyAlias" id={a.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
