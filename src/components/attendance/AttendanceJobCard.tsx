"use client";

import { useState } from "react";
import { Building2, ChevronDown, ChevronRight, Plus, Truck, Warehouse } from "lucide-react";
import { ShiftBadge } from "@/components/ShiftBadge";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { ResourceDTO } from "@/lib/types";
import { FLAG_LABEL, METHOD_LABEL, type AttendanceJob, type AttendanceRow } from "./types";
import { jobFinish } from "@/lib/shiftTimes";

const btn = "rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const inp = "rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200";

// ISO <-> the browser's local "YYYY-MM-DDTHH:MM" for datetime-local inputs
// (the office is in Sydney, so local = Sydney).
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-";

const flagTone = (f: string) => (f === "STILL_ON" ? "bg-emerald-500/15 text-emerald-400" : f === "REJECTED" ? "bg-gray-700 text-gray-300" : "bg-amber-500/15 text-amber-500");

export default function AttendanceJobCard({
  job,
  date,
  canEdit,
  canRemove = false,
  people,
  handover,
  onChanged,
}: {
  job: AttendanceJob;
  date: string;
  canEdit: boolean;
  canRemove?: boolean; // Admins: remove a sign-in (e.g. signed in twice)
  people: ResourceDTO[];
  handover: { name: string; expiresAt: string } | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [handing, setHanding] = useState(false);
  const [handTo, setHandTo] = useState("");
  const [handLink, setHandLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Sign out selected" (24 Oct 2026): tick the ones who forgot, one time for all.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [outAt, setOutAt] = useState("");
  const [outReason, setOutReason] = useState("Forgot to sign out");
  const [outNote, setOutNote] = useState<string | null>(null);
  const stillIn = job.rows.filter((r) => !r.signOutAt && r.status !== "REJECTED");
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const defaultOut = () => {
    const finish = jobFinish(date, job.shift, job.startTime, job.endTime);
    return toLocal((finish && finish.getTime() <= Date.now() ? finish : new Date()).toISOString());
  };

  async function send(url: string, method: string, body: unknown) {
    setError(null);
    const res = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setError(await serverErrorMessage(res, "Couldn't save."));
      return null;
    }
    const out = await res.json();
    onChanged();
    return out;
  }

  const point = job.kind === "POINT";
  const total = job.rows.filter((r) => r.status !== "REJECTED").reduce((n, r) => n + (r.hours ?? 0), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-edge shadow-soft">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-panel px-3.5 py-2.5">
        {point ? (
          <span className="flex items-center gap-1 rounded-full bg-brand-600/20 px-2 py-0.5 text-[11px] font-semibold text-brand-300">
            {job.place === "VEHICLE" ? <Truck size={12} /> : job.place === "YARD" ? <Warehouse size={12} /> : <Building2 size={12} />}
            {job.place === "VEHICLE" ? "Truck" : job.place === "YARD" ? "Yard" : "Office"}
          </span>
        ) : (
          <ShiftBadge shift={job.shift as "DAY" | "NIGHT"} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-100">{job.label}</div>
          <div className="truncate text-[11px] text-gray-500">
            {point ? "" : `${job.times ?? "No times set"} · ${job.allocated.length} allocated · `}
            {job.rows.filter((r) => r.status !== "REJECTED").length} signed in
            {total > 0 && ` · ${total}h signed`}
            {job.breakMinutes ? ` (less ${job.breakMinutes} min break)` : ""}
          </div>
          {job.note && <div className="text-[11px] text-gray-400">{job.note}</div>}
          {handover && <div className="text-[11px] text-brand-300">Sign-in handed to {handover.name} until {fmt(handover.expiresAt)}</div>}
        </div>
        {canEdit && (
          <div className="flex gap-1.5">
            <button className={quiet} onClick={() => setAdding((v) => !v)}><Plus size={12} className="inline" /> Missed sign-in</button>
            {!point && <button className={quiet} onClick={() => setHanding((v) => !v)}>Hand over</button>}
          </div>
        )}
      </div>

      {error && <div className="bg-red-900/30 px-3.5 py-1.5 text-xs text-red-300">{error}</div>}

      {canEdit && stillIn.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-edge/70 bg-panel2/40 px-3.5 py-2 text-xs">
          <label className="flex items-center gap-1.5 text-gray-300">
            <input
              type="checkbox"
              checked={picked.size > 0 && stillIn.every((r) => picked.has(r.id))}
              onChange={(e) => {
                setPicked(e.target.checked ? new Set(stillIn.map((r) => r.id)) : new Set());
                if (e.target.checked && !outAt) setOutAt(defaultOut());
              }}
            />
            Select all still signed in ({stillIn.length})
          </label>
          {picked.size > 0 && (
            <>
              <input type="datetime-local" className={inp} value={outAt} onChange={(e) => setOutAt(e.target.value)} />
              <input className={`${inp} min-w-0 flex-1`} value={outReason} onChange={(e) => setOutReason(e.target.value)} placeholder="Reason" />
              <button
                className={btn}
                disabled={!outAt || outReason.trim().length < 3}
                onClick={async () => {
                  setOutNote(null);
                  const out = await send("/api/attendance/sign-out", "POST", { ids: [...picked], signOutAt: fromLocal(outAt), reason: outReason });
                  if (out) {
                    setPicked(new Set());
                    const probs = (out.problems ?? []) as { name: string; error: string }[];
                    setOutNote(`Signed out ${out.signedOut}.${probs.length ? ` Not changed: ${probs.map((p) => `${p.name} (${p.error})`).join(", ")}` : ""}`);
                  }
                }}
              >
                Sign out {picked.size}
              </button>
            </>
          )}
          {outNote && <span className="w-full text-gray-400">{outNote}</span>}
        </div>
      )}

      {handing && canEdit && (
        <div className="border-b border-edge/70 bg-panel2/40 px-3.5 py-2 text-xs">
          <div className="mb-1 text-gray-400">Give someone today&apos;s sign-in for this job (e.g. the supervisor is off). Their link stops working at the end of the day.</div>
          <div className="flex flex-wrap gap-2">
            <select className={inp} value={handTo} onChange={(e) => setHandTo(e.target.value)}>
              <option value="">Pick who…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              className={btn}
              disabled={!handTo}
              onClick={async () => {
                const out = await send("/api/site-links", "POST", { kind: "HANDOVER", jobId: job.id, resourceId: handTo });
                if (out) setHandLink(out.url);
              }}
            >
              Make link
            </button>
          </div>
          {handLink && (
            <div className="mt-2 rounded-md border border-brand-500 bg-brand-600/10 p-2">
              <div className="break-all font-mono text-gray-300">{handLink}</div>
              <button className={`${btn} mt-1`} onClick={() => navigator.clipboard.writeText(handLink)}>Copy link</button>
              <span className="ml-2 text-gray-400">Send it to them only. It&apos;s shown once.</span>
            </div>
          )}
        </div>
      )}

      {adding && canEdit && <AddMissed job={job} date={date} people={people} onSave={(b) => send("/api/attendance", "POST", b).then((o) => o && setAdding(false))} />}

      {job.rows.length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-gray-600">Nobody has signed in.</div>
      ) : (
        <div className="divide-y divide-edge/50">
          {job.rows.map((r) => (
            <div key={r.id} className="px-3.5 py-2 text-sm">
              <div className="flex items-start gap-3">
                {canEdit && stillIn.length > 0 && (
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    disabled={!!r.signOutAt || r.status === "REJECTED"}
                    checked={picked.has(r.id)}
                    onChange={() => {
                      toggle(r.id);
                      if (!outAt) setOutAt(defaultOut());
                    }}
                    aria-label={`Select ${r.name}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className={r.status === "REJECTED" ? "text-gray-500 line-through" : "text-gray-200"}>{r.name}</span>
                  {r.company && <span className="text-xs text-gray-400"> ({r.company})</span>}
                  {r.slot && <span className="ml-1.5 rounded-full border border-yellow-400/60 bg-yellow-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-200">{r.slot}</span>}
                  <div className="text-[11px] text-gray-500">
                    {METHOD_LABEL[r.signInMethod] ?? r.signInMethod}
                    {r.runBy && ` · ${r.runBy}`}
                    {r.confirmedBy && r.signInMethod === "POSTER" && ` · confirmed by ${r.confirmedBy}`}
                  </div>
                  {(r.flags.length > 0 || r.edits.length > 0) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {r.flags.map((f) => (
                        <span key={f} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${flagTone(f)}`}>{FLAG_LABEL[f] ?? f}</span>
                      ))}
                      {r.edits.length > 0 && (
                        <button className="flex items-center text-[11px] text-gray-400" onClick={() => setHistory(history === r.id ? null : r.id)}>
                          {history === r.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {r.edits.length} office change{r.edits.length === 1 ? "" : "s"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-16 shrink-0 text-xs text-gray-300"><div className="text-[10px] text-gray-500">In</div>{r.in}</div>
                <div className="w-16 shrink-0 text-xs text-gray-300"><div className="text-[10px] text-gray-500">Out</div>{r.out ?? "-"}</div>
                <div className="w-12 shrink-0 text-right text-xs font-medium text-gray-200"><div className="text-[10px] font-normal text-gray-500">Hours</div>{r.hours != null ? `${r.hours}h` : "-"}</div>
                {canEdit && (
                  <button className={`${quiet} shrink-0 self-center`} onClick={() => setEditing(editing === r.id ? null : r.id)}>Change</button>
                )}
                {canRemove && (
                  <button
                    className={`${quiet} shrink-0 self-center text-red-300`}
                    onClick={() => {
                      const reason = window.prompt(`Remove ${r.name}'s sign-in (in ${r.in}${r.out ? `, out ${r.out}` : ""})? It won't count for any hours. Why?`, "Signed in twice");
                      if (reason && reason.trim().length >= 3) send(`/api/attendance/${r.id}`, "DELETE", { reason });
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {history === r.id && (
                <ul className="mt-1 space-y-0.5 rounded-md bg-panel2/50 px-2 py-1 text-[11px] text-gray-400">
                  {r.edits.map((e, i) => (
                    <li key={i}>
                      {fmt(e.editedAt)} · {e.editedBy}: {e.field} {e.field.endsWith("At") ? `${fmt(e.before)} → ${fmt(e.after)}` : `${e.before ?? "-"} → ${e.after ?? "-"}`} - &ldquo;{e.reason}&rdquo;
                    </li>
                  ))}
                </ul>
              )}
              {editing === r.id && <EditRow row={r} onSave={(b) => send(`/api/attendance/${r.id}`, "PATCH", b).then((o) => o && setEditing(null))} />}
            </div>
          ))}
        </div>
      )}

      {job.noShows.length > 0 && (
        <div className="border-t border-edge/70 px-3.5 py-2 text-xs text-amber-500">
          {point ? "Not signed in" : "Allocated, not signed in"}: {job.noShows.map((p) => p.name).join(", ")}
        </div>
      )}
    </div>
  );
}

// The office changing a sign-in: times and/or status, always with a reason.
function EditRow({ row, onSave }: { row: AttendanceRow; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const init = { in: toLocal(row.signInAt), out: toLocal(row.signOutAt), status: row.status };
  const [v, setV] = useState({ ...init, reason: "" });
  // Only what was actually changed (the inputs drop seconds - an untouched
  // time mustn't count as an edit).
  const changes = {
    ...(v.in !== init.in ? { signInAt: fromLocal(v.in) } : {}),
    ...(v.out !== init.out ? { signOutAt: fromLocal(v.out) } : {}),
    ...(v.status !== init.status ? { status: v.status } : {}),
  };
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-edge bg-panel2/40 p-2 text-xs">
      <label className="flex flex-col gap-0.5 text-gray-400">In<input type="datetime-local" className={inp} value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} /></label>
      <label className="flex flex-col gap-0.5 text-gray-400">Out<input type="datetime-local" className={inp} value={v.out} onChange={(e) => setV({ ...v, out: e.target.value })} /></label>
      <label className="flex flex-col gap-0.5 text-gray-400">
        Status
        <select className={inp} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as AttendanceRow["status"] })}>
          <option value="CONFIRMED">Confirmed</option>
          <option value="TO_CONFIRM">To confirm</option>
          <option value="REJECTED">Wasn&apos;t there</option>
        </select>
      </label>
      <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-gray-400">
        Reason (kept with the change)
        <input className={inp} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. forgot to sign out - supervisor says 3:30pm" />
      </label>
      <button
        className={btn}
        disabled={v.reason.trim().length < 3 || !v.in || Object.keys(changes).length === 0}
        onClick={() => onSave({ ...changes, reason: v.reason })}
      >
        Save
      </button>
    </div>
  );
}

// The office adding a sign-in that was missed (Lobos crew or a hire worker).
function AddMissed({ job, date, people, onSave }: { job: AttendanceJob; date: string; people: ResourceDTO[]; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const [v, setV] = useState({ who: "", hireName: "", company: "", in: `${date}T07:00`, out: "", reason: "" });
  const hire = v.who === "HIRE";
  const allocatedIds = new Set(job.allocated.map((p) => p.id));
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-edge/70 bg-panel2/40 px-3.5 py-2 text-xs">
      <label className="flex flex-col gap-0.5 text-gray-400">
        Who
        <select className={inp} value={v.who} onChange={(e) => setV({ ...v, who: e.target.value })}>
          <option value="">Pick…</option>
          <optgroup label={job.kind === "POINT" ? "Listed here" : "Allocated"}>{job.allocated.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          <optgroup label="Everyone else">{people.filter((p) => !allocatedIds.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          <option value="HIRE">Hire / subcontractor worker…</option>
        </select>
      </label>
      {hire && (
        <>
          <input className={inp} placeholder="Name" value={v.hireName} onChange={(e) => setV({ ...v, hireName: e.target.value })} />
          <input className={inp} placeholder="Company" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
        </>
      )}
      <label className="flex flex-col gap-0.5 text-gray-400">In<input type="datetime-local" className={inp} value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} /></label>
      <label className="flex flex-col gap-0.5 text-gray-400">Out<input type="datetime-local" className={inp} value={v.out} onChange={(e) => setV({ ...v, out: e.target.value })} /></label>
      <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-gray-400">
        Reason
        <input className={inp} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. phone flat - supervisor confirmed" />
      </label>
      <button
        className={btn}
        disabled={!v.who || !v.in || v.reason.trim().length < 3 || (hire && (!v.hireName.trim() || !v.company.trim()))}
        onClick={() =>
          onSave({
            ...(job.kind === "POINT" ? { place: job.place, vehicleId: job.vehicleId } : { jobId: job.id }),
            ...(hire ? { hire: { name: v.hireName, company: v.company } } : { resourceId: v.who }),
            signInAt: fromLocal(v.in),
            signOutAt: fromLocal(v.out),
            reason: v.reason,
          })
        }
      >
        Add
      </button>
    </div>
  );
}
