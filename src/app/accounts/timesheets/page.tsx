"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CircleHelp, Download, Lock } from "lucide-react";
import PageShell from "@/components/PageShell";
import TimesheetsExplainer from "@/components/accounts/TimesheetsExplainer";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import { ApprovalHistory, hrs, longDate, PersonView, SiteView, Tile, ViewToggle, when, type TimesheetData } from "@/components/timesheets/TimesheetGrid";
import type { Explainer } from "@/lib/accountsTimesheets";

// Accounts -> Timesheets (2 Nov 2026, Ilies: "accounts dash needs access to the time sheets no changes just export
// button for her pay roll"). The same weekly staff timesheets as /timesheets, view only: any week, each person's
// days and hours, whether the Manager has approved and locked it. The one action is Export (hours-only CSV). The
// first time the accounts login opens it, "How timesheets work" comes up until "Got it" (kept on the server).

type Data = TimesheetData & { explainerSeen: boolean; explainer: Explainer };

const shiftDate = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

export default function AccountsTimesheetsPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [week, setWeek] = useState(() => localISODate());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"site" | "person">("person");
  const [explainer, setExplainer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoShown, setAutoShown] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/accounts/timesheets?week=${week}`);
    if (!res.ok) return setError(res.status === 403 ? "This screen is for accounts." : "Couldn't load timesheets.");
    setError(null);
    setData(await res.json());
  }, [week]);
  useEffect(() => {
    load();
  }, [load]);

  // Comes up by itself once, for the accounts login only (Admins open it from the link).
  useEffect(() => {
    if (data && accountsOnly && !data.explainerSeen && !autoShown) {
      setExplainer(true);
      setAutoShown(true);
    }
  }, [data, accountsOnly, autoShown]);

  const gotIt = async () => {
    setSaving(true);
    const res = await apiFetch("/api/accounts/timesheets/explainer", { method: "POST" });
    setSaving(false);
    setExplainer(false);
    if (res.ok) setData((d) => (d ? { ...d, explainerSeen: true } : d));
  };

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Timesheets"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;

  return (
    <PageShell title="Timesheets" subtitle="Lobos staff hours for the week from site sign-ins - view only. Export the week for payroll.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="rounded-lg border border-edge p-2 text-gray-300 hover:bg-panel2" onClick={() => setWeek(shiftDate(data?.weekStart ?? week, -7))} aria-label="Previous week">
          <ChevronLeft size={16} />
        </button>
        <input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} className="rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200" aria-label="Pick a week" />
        <button className="rounded-lg border border-edge p-2 text-gray-300 hover:bg-panel2" onClick={() => setWeek(shiftDate(data?.weekStart ?? week, 7))} aria-label="Next week">
          <ChevronRight size={16} />
        </button>
        {data && <span className="text-sm text-gray-300">Week {longDate(data.weekStart)} – {longDate(data.weekEnd)}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setExplainer(true)} disabled={!data} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-brand-300 hover:underline disabled:opacity-40">
            <CircleHelp size={14} /> How timesheets work
          </button>
          <span className="rounded-full bg-gray-700/60 px-3 py-1 text-xs text-gray-300">View only</span>
          {data && (
            <a href={`/api/accounts/timesheets/export?week=${data.weekStart}`} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500">
              <Download size={14} /> Export for payroll{data.approval ? "" : " (draft)"}
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
              Approved and locked by {data.approval.approvedBy} on {when(data.approval.approvedAt)}. The export sends exactly what was approved.
              {data.changedSinceApproval > 0 && (
                <span className="mt-1 block text-amber-300">
                  {data.changedSinceApproval} sign-in{data.changedSinceApproval === 1 ? "" : "s"} for this week differ from what was approved - the office would need to reopen the week to bring them in.
                </span>
              )}
            </div>
          ) : (
            <div className={`mb-4 rounded-xl border p-3 text-sm ${data.issues + (data.travelIssues ?? 0) ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-edge bg-panel text-gray-400"}`}>
              Not approved by a Manager yet{!data.weekEnded ? " - this week is still running" : ""}. The export is a DRAFT until the week is locked.
              {data.issues > 0 && ` ${data.issues} sign-in${data.issues === 1 ? "" : "s"} still need the office (no sign-out, or waiting for the supervisor).`}
              {(data.travelIssues ?? 0) > 0 && ` ${data.travelIssues} regional travel leg${data.travelIssues === 1 ? "" : "s"} still need the office (never ended, over 8h or still travelling).`}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="People" value={data.people.length} />
            <Tile label="Total hours" value={hrs(data.totalHours)} />
            <Tile label="Travel (regional)" value={hrs(data.travelHours ?? 0)} tone={data.travelIssues ? "text-amber-400" : "text-sky-200"} />
            <Tile label="Need sorting" value={data.issues + (data.travelIssues ?? 0)} tone={data.issues + (data.travelIssues ?? 0) ? "text-amber-400" : ""} />
            <Tile label="Status" value={data.approval ? "Locked" : "Draft"} tone={data.approval ? "text-emerald-400" : "text-gray-300"} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <ViewToggle view={view} setView={setView} />
            <input placeholder="Search a name..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-xs rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200" />
          </div>

          {view === "site" ? <SiteView data={data} search={search} /> : <PersonView data={data} search={search} />}

          <ApprovalHistory history={data.history} />
          <p className="mt-4 text-[11px] text-gray-500">
            To have a time changed, ask the office - they change it on Sign-ins with a reason. Approve or query each person&apos;s week in Payroll.
          </p>
        </>
      )}

      {explainer && data && <TimesheetsExplainer explainer={data.explainer} busy={saving} onClose={() => setExplainer(false)} onGotIt={gotIt} />}
    </PageShell>
  );
}
