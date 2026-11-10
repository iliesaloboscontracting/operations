"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Lock, TriangleAlert } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import { ApprovalHistory, hrs, longDate, PersonView, SiteView, Tile, useWeekInUrl, ViewToggle, when, type TimesheetData as Data } from "@/components/timesheets/TimesheetGrid";

// Timesheets (21 Oct 2026): Lobos staff hours for a Monday-Sunday week from
// site sign-ins, across every site, office, yard and truck. A Manager
// approves the week (it then can't change), exports it for accounts, and can
// go back to any earlier week. Hours only - no pay rates. The grids are shared
// with the read-only Accounts copy (components/timesheets/TimesheetGrid.tsx).

const shiftDate = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

export default function TimesheetsPage() {
  const { canEdit, isAdmin, timesheetsOnly: reviewer, coordinatorOnly } = useAuth();
  // The TIMESHEETS login and the coordinator (2 Nov 2026) look only - no approve, reopen or export.
  const timesheetsOnly = reviewer || coordinatorOnly;
  // ?week= in the address bar opens that week and keeps the one shown (2 Nov 2026).
  const { week, setWeek, ready, shown } = useWeekInUrl(() => localISODate());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  // Opens "By person" (2 Nov 2026): one row per person with every site, truck, yard and office line.
  const [view, setView] = useState<"site" | "person">("person");

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/timesheets?week=${week}`);
    if (!res.ok) return setError(res.status === 403 ? "Timesheets are for managers." : "Couldn't load timesheets.");
    setError(null);
    const d = await res.json();
    setData(d);
    shown(d.weekStart);
  }, [week, shown]);
  useEffect(() => {
    if (ready) load();
  }, [load, ready]);

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
              disabled={busy || !data.weekEnded || data.issues + (data.travelIssues ?? 0) > 0 || data.people.length === 0}
              onClick={() => act("approve")}
              title={!data.weekEnded ? "The week hasn't finished yet" : data.issues + (data.travelIssues ?? 0) > 0 ? "Sort out the flagged sign-ins and travel first" : undefined}
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
            <div className={`mb-4 rounded-xl border p-3 text-sm ${data.issues + (data.travelIssues ?? 0) ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-edge bg-panel text-gray-400"}`}>
              {data.issues + (data.travelIssues ?? 0) > 0 ? (
                <>
                  <TriangleAlert size={14} className="mr-1.5 inline" />
                  {[data.issues > 0 && `${data.issues} sign-in${data.issues === 1 ? "" : "s"} (no sign-out, or waiting for the supervisor)`, (data.travelIssues ?? 0) > 0 && `${data.travelIssues} regional travel leg${data.travelIssues === 1 ? "" : "s"} (never ended, over 8h or still travelling)`].filter(Boolean).join(" and ")} need sorting on the Sign-ins page before this week can be approved.
                </>
              ) : !data.weekEnded ? (
                "This week is still running - it can be approved from Monday."
              ) : (
                "Not approved yet. Check the hours, then approve the week to lock it before sending to accounts."
              )}
              {/* The Sign-ins page's flags for the week so far (10 Nov 2026) - worth a look before approving; they don't
                  stop the approval. */}
              {data.signInFlags && Object.values(data.signInFlags).some((n) => n > 0) && (
                <div className="mt-1.5 text-xs text-gray-300">
                  Worth a look on the <a href="/attendance" className="text-brand-300 underline">Sign-ins page</a> this week:{" "}
                  {data.signInFlags.toConfirm} to confirm · {data.signInFlags.late} late · {data.signInFlags.longDay} long day · {data.signInFlags.noSignIn} no sign-in
                  <span className="text-gray-500"> (information only)</span>
                </div>
              )}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="People" value={data.people.length} />
            <Tile label="Total hours" value={hrs(data.totalHours)} />
            <Tile label="Travel (regional)" value={hrs(data.travelHours ?? 0)} tone={data.travelIssues ? "text-amber-400" : "text-sky-200"} />
            <Tile label="Need sorting" value={data.issues + (data.travelIssues ?? 0)} tone={data.issues + (data.travelIssues ?? 0) ? "text-amber-400" : ""} />
            <Tile label="Status" value={data.approval ? "Approved" : "Draft"} tone={data.approval ? "text-emerald-400" : "text-gray-300"} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <ViewToggle view={view} setView={setView} />
            <input
              placeholder="Search a name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-xs rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200"
            />
          </div>

          {view === "site" ? <SiteView data={data} search={search} /> : <PersonView data={data} search={search} />}

          <ApprovalHistory history={data.history} />
          <p className="mt-4 text-[11px] text-gray-500">
            Hours = signed in to signed out; one unpaid break per person per day, only when the day is over 5h and never taking it below 5h (the largest break of that day&apos;s places - office, yard and trucks: 30 min), off their longest line; time signed in at two places at once counts once; each day rounded once to the quarter hour. From 26 Oct 2026 - earlier days keep the old break on each sign-in. Travel (regional jobs only) is its own column: start travel to the site sign-in, and travelling home to arrived - no break, not in Hours, legs over 8h or never ended count nothing. Lobos staff only - hire and subcontractor workers are on the Sign-ins page. To fix a time, use the Sign-ins page (the change and reason are kept).
          </p>
        </>
      )}
    </PageShell>
  );
}
