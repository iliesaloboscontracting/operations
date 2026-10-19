"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import DateTabs from "@/components/DateTabs";
import { ShiftBadge } from "@/components/ShiftBadge";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import { DayReviewDTO, DayReviewJobDTO, DayReviewRowDTO, ResourceDTO, SignInSummary } from "@/lib/types";
import { Lock, Plus, TriangleAlert, Unlock, X } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  PERSONNEL: "Crew",
  EQUIPMENT: "Plant",
  ATTACHMENT: "Attachment",
  VEHICLE: "Vehicle",
  HIRE: "Hire",
};

function CostStatusBadge({ status }: { status: DayReviewRowDTO["costStatus"] }) {
  if (status === "RATE_MISSING") {
    return <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">Rate missing</span>;
  }
  if (status === "RATE_UNCONFIRMED") {
    return <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Unconfirmed rate</span>;
  }
  if (status === "HOURS_UNKNOWN") {
    return <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Hours unclear</span>;
  }
  return null;
}

function JobCard({
  job,
  date,
  canEdit,
  closed,
  resources,
  onChanged,
}: {
  job: DayReviewJobDTO;
  date: string;
  canEdit: boolean;
  closed: boolean;
  resources: ResourceDTO[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [pickerId, setPickerId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const disabled = !canEdit || closed;
  const rowResourceIds = new Set(job.rows.map((r) => r.resourceId));
  const pickable = resources.filter((r) => !rowResourceIds.has(r.id));
  // Site sign-in times show once anyone has signed in on this job.
  const usesSignIn = job.rows.some((r) => r.signIn) || (job.otherSignIns?.length ?? 0) > 0;

  async function saveActual(resourceId: string, patch: Record<string, unknown>) {
    setBusy(resourceId);
    await apiFetch("/api/day-review/actual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, resourceId, ...patch }),
    });
    setBusy(null);
    onChanged();
  }

  async function addUnplanned() {
    if (!pickerId) return;
    await saveActual(pickerId, { attended: true });
    setPickerId("");
    setAdding(false);
  }

  async function removeUnplanned(resourceId: string) {
    setBusy(resourceId);
    await apiFetch(`/api/day-review/actual?jobId=${job.id}&resourceId=${resourceId}`, { method: "DELETE" });
    setBusy(null);
    onChanged();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-edge shadow-soft">
      <div className="flex items-center gap-2 border-b border-edge bg-panel px-3.5 py-2.5">
        <ShiftBadge shift={job.shift} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-100">{job.title}</div>
          <div className="truncate text-[11px] text-gray-500">
            {job.client ?? "No client set"}
            {job.siteCode && ` · ${job.siteCode}`}
            {job.startTime && job.endTime && ` · ${job.startTime}–${job.endTime}`}
          </div>
        </div>
      </div>

      {job.dayBrief && <div className="border-b border-edge/70 bg-panel2/40 px-3.5 py-2 text-xs text-gray-400">{job.dayBrief}</div>}

      {job.rows.length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-gray-600">Nobody planned or logged on this job.</div>
      ) : (
        <div className="divide-y divide-edge/50">
          {job.rows.map((r) => (
            <div key={r.resourceId} className="flex items-center gap-3 px-3.5 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.attended ?? true}
                  disabled={disabled || busy === r.resourceId}
                  onChange={(e) => saveActual(r.resourceId, { attended: e.target.checked })}
                  className="h-4 w-4 rounded border-edge bg-panel2 accent-brand-600"
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-gray-200">
                  {r.name}
                  {!r.planned && <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-brand-500">Unplanned</span>}
                </div>
                <div className="truncate text-[11px] text-gray-500">
                  {TYPE_LABEL[r.type] ?? r.type}
                  {r.role && ` · ${r.role}`}
                </div>
                {usesSignIn && r.type === "PERSONNEL" && <SignInLine s={r.signIn ?? null} />}
              </div>
              {r.signIn?.hours != null && r.signIn.hours !== r.actualHours && !disabled && (
                <button
                  onClick={() => saveActual(r.resourceId, { attended: true, actualHours: r.signIn!.hours })}
                  className="rounded-md border border-edge px-1.5 py-0.5 text-[10px] text-brand-300 hover:bg-panel2"
                  title="Put the signed-in hours in the hours box"
                >
                  Use {r.signIn.hours}h
                </button>
              )}
              <CostStatusBadge status={r.costStatus} />
              <input
                type="number"
                step="0.25"
                min="0"
                placeholder="Hrs"
                key={`${r.resourceId}-${r.actualHours}`}
                defaultValue={r.actualHours ?? ""}
                disabled={disabled || busy === r.resourceId}
                onBlur={(e) => saveActual(r.resourceId, { actualHours: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-16 rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200 disabled:opacity-50"
              />
              {!r.planned && !disabled && (
                <button onClick={() => removeUnplanned(r.resourceId)} className="text-gray-500 hover:text-red-400" title="Remove">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(job.otherSignIns?.length ?? 0) > 0 && (
        <div className="border-t border-edge/70 px-3.5 py-2 text-[11px] text-gray-400">
          <div className="mb-1 font-semibold text-gray-300">Also signed in (hire / not allocated here)</div>
          {job.otherSignIns!.map((s, i) => (
            <div key={i}>
              {s.name}
              {s.company && ` (${s.company})`} · <SignInLine s={s} inline />
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="border-t border-edge/70 px-3.5 py-2">
          {adding ? (
            <div className="flex items-center gap-2">
              <select
                value={pickerId}
                onChange={(e) => setPickerId(e.target.value)}
                className="flex-1 rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200"
              >
                <option value="">Pick who/what turned up...</option>
                {pickable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({TYPE_LABEL[r.type] ?? r.type})
                  </option>
                ))}
              </select>
              <button onClick={addUnplanned} disabled={!pickerId} className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                Add
              </button>
              <button onClick={() => setAdding(false)} className="text-gray-500 hover:text-gray-300">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300">
              <Plus size={12} /> Add unplanned
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SignInLine({ s, inline }: { s: SignInSummary | null; inline?: boolean }) {
  const cls = inline ? "" : "truncate text-[11px]";
  if (!s) return <div className={`${cls} text-amber-500`}>No sign-in</div>;
  return (
    <span className={`${inline ? "" : "block"} ${cls} text-gray-400`}>
      In {s.in ?? "-"} · Out {s.out ?? <span className="text-amber-500">not yet</span>}
      {s.hours != null && ` · ${s.hours}h`}
      {s.toConfirm && <span className="ml-1 text-amber-500">(to confirm)</span>}
    </span>
  );
}

export default function DayReviewPage() {
  const { canEdit, isAdmin } = useAuth();
  const [date, setDate] = useState(localISODate());
  const [data, setData] = useState<DayReviewDTO | null>(null);
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/day-review?date=${date}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    apiFetch("/api/resources").then((r) => (r.ok ? r.json() : [])).then(setResources);
  }, []);

  const closed = data?.dayClose.status === "CLOSED";

  async function closeDay() {
    if (!confirm(`Close ${date}? Every allocation's cost freezes as of now - an Admin can re-open it later if something needs correcting.`)) return;
    setBusy(true);
    const res = await apiFetch("/api/day-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, action: "close" }),
    });
    if (!res.ok) setMessage((await res.json()).error ?? "Couldn't close the day");
    setBusy(false);
    load();
  }

  async function reopenDay() {
    const reason = window.prompt(`Re-opening ${date} needs a reason (this is recorded):`);
    if (reason == null) return;
    if (!reason.trim()) {
      setMessage("A reason is required to re-open a closed day");
      return;
    }
    setBusy(true);
    const res = await apiFetch("/api/day-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, action: "reopen", reason }),
    });
    if (!res.ok) setMessage((await res.json()).error ?? "Couldn't re-open the day");
    setBusy(false);
    load();
  }

  const activeResources = useMemo(() => resources.filter((r) => r.active), [resources]);

  return (
    <PageShell title="Day Review" subtitle="Compare what was planned against what actually happened on site.">
      <div className="mb-4 space-y-2">
        <DateTabs selected={date} onSelect={setDate} />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-edge bg-panel2 px-2 py-1 text-sm text-gray-200"
        />
      </div>

      {data && (
        <div
          className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3.5 shadow-soft ${
            closed ? "border-edge bg-panel2/60" : "border-edge bg-panel"
          }`}
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${closed ? "bg-gray-500/10 text-gray-400" : "bg-brand-500/10 text-brand-600"}`}>
            {closed ? <Lock size={16} /> : <Unlock size={16} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-100">{closed ? "Closed" : "Open"}</div>
            <div className="text-[11px] text-gray-500">
              {closed
                ? `Closed by ${data.dayClose.closedBy ?? "—"}${data.dayClose.reopenedAt ? ` · last re-opened by ${data.dayClose.reopenedBy}: "${data.dayClose.reopenReason}"` : ""}`
                : "Still editable - close it once the day's actuals are locked in"}
            </div>
          </div>
          {(data.uncostedCount > 0 || data.unconfirmedCount > 0) && (
            <div className="flex items-center gap-1 text-[11px] text-amber-400">
              <TriangleAlert size={12} />
              {data.uncostedCount > 0 && `${data.uncostedCount} not costed`}
              {data.uncostedCount > 0 && data.unconfirmedCount > 0 && " · "}
              {data.unconfirmedCount > 0 && `${data.unconfirmedCount} unconfirmed`}
            </div>
          )}
          {canEdit && !closed && (
            <button onClick={closeDay} disabled={busy} className="rounded-md bg-panel2 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50">
              Close day
            </button>
          )}
          {isAdmin && closed && (
            <button onClick={reopenDay} disabled={busy} className="rounded-md bg-panel2 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50">
              Re-open (with reason)
            </button>
          )}
        </div>
      )}

      {message && (
        <div className="mb-4 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2 text-xs text-red-400">{message}</div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : !data || data.jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge py-10 text-center text-sm text-gray-500">No jobs on this day.</div>
      ) : (
        <div className="space-y-3">
          {data.jobs.map((j) => (
            <JobCard key={j.id} job={j} date={date} canEdit={canEdit} closed={closed} resources={activeResources} onChanged={load} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
