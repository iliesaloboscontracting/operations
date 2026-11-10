"use client";

import { useState } from "react";
import { Building2, ChevronDown, ChevronRight, Plus, Truck, Warehouse } from "lucide-react";
import { ShiftBadge } from "@/components/ShiftBadge";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { ResourceDTO } from "@/lib/types";
import { FLAG_LABEL, METHOD_LABEL, type AttendanceJob, type AttendanceRow } from "./types";
import { jobFinish, parseClock } from "@/lib/shiftTimes";

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

// The 10 Nov 2026 flags (late sign-in, long day, signed out together) stand out a little more - they're where hours
// went missing that week. Information only.
const HOURS_FLAGS = new Set(["LATE_IN", "LONG_SHIFT", "BULK_OUT"]);
const flagTone = (f: string) =>
  f === "STILL_ON" ? "bg-emerald-500/15 text-emerald-400" : f === "REJECTED" ? "bg-gray-700 text-gray-300" : HOURS_FLAGS.has(f) ? "bg-orange-500/20 text-orange-300" : "bg-amber-500/15 text-amber-500";

export default function AttendanceJobCard({
  job,
  date,
  canEdit,
  canRemove = false,
  people,
  handover,
  onChanged,
  filtered = false,
}: {
  job: AttendanceJob;
  date: string;
  filtered?: boolean; // the page's summary strip is filtering - only the matching lines are passed in
  canEdit: boolean;
  canRemove?: boolean; // Admins: remove a sign-in (e.g. signed in twice)
  people: ResourceDTO[];
  handover: { name: string; expiresAt: string } | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null); // fix 4: the hire row being moved onto a staff member
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addWho, setAddWho] = useState(""); // "Add missed sign-in" next to a no-show prefills who (10 Nov 2026)
  const [handing, setHanding] = useState(false);
  const [handTo, setHandTo] = useState("");
  const [handLink, setHandLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Sign out selected" (24 Oct 2026): tick the ones who forgot, one time for all.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [outAt, setOutAt] = useState("");
  const [outPick, setOutPick] = useState(SIGN_OUT_REASONS[0]);
  const [outOther, setOutOther] = useState("");
  const outReason = outPick === OTHER_REASON ? outOther.trim() : outPick;
  const [outNote, setOutNote] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null); // TF-006: how many other open sign-ins an add ended
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
            {filtered ? `${job.rows.length} shown (filtered)` : `${job.rows.filter((r) => r.status !== "REJECTED").length} signed in`}
            {!filtered && total > 0 && ` · ${total}h signed`}
            {job.breakMinutes ? ` (one ${job.breakMinutes} min break a day, over 5h)` : ""}
          </div>
          {job.note && <div className="text-[11px] text-gray-400">{job.note}</div>}
          {handover && <div className="text-[11px] text-brand-300">Sign-in handed to {handover.name} until {fmt(handover.expiresAt)}</div>}
        </div>
        {canEdit && (
          <div className="flex gap-1.5">
            <button className={quiet} onClick={() => { setAddWho(""); setAdding((v) => !v); }}><Plus size={12} className="inline" /> Missed sign-in</button>
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
              <select className={inp} value={outPick} onChange={(e) => setOutPick(e.target.value)} aria-label="Reason">
                {SIGN_OUT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value={OTHER_REASON}>Other – type it…</option>
              </select>
              {outPick === OTHER_REASON && (
                <input className={`${inp} min-w-0 flex-1`} value={outOther} onChange={(e) => setOutOther(e.target.value)} placeholder="Other reason" autoFocus />
              )}
              <button
                className={btn}
                disabled={!outAt || outReason.length < 3}
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

      {adding && canEdit && <AddMissed key={addWho} job={job} date={date} people={people} initialWho={addWho} onSave={(b) => send("/api/attendance", "POST", b).then((o) => { if (!o) return o; setAdding(false); setAddNote(o.ended ? null : "Added."); if (o.ended) setAddNote(`Added - and ended ${o.ended} other open sign-in${o.ended === 1 ? "" : "s"} of theirs at this sign-in time (kept with a note).`); return o; })} />}
      {addNote && <div className="border-b border-edge/70 px-3.5 py-1.5 text-xs text-gray-400">{addNote}</div>}

      {job.rows.length === 0 ? (
        !filtered && <div className="px-3.5 py-3 text-xs text-gray-600">Nobody has signed in.</div>
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
                        <span key={f} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${flagTone(f)}`} title={r.notes?.[f] ? FLAG_LABEL[f] : undefined}>{r.notes?.[f] ?? FLAG_LABEL[f] ?? f}</span>
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
                {canEdit && r.flags.includes("LOOKS_LIKE_STAFF") && (
                  <button className={`${quiet} shrink-0 self-center text-amber-300`} onClick={() => setMoving(moving === r.id ? null : r.id)}>Move to staff</button>
                )}
                {canEdit && (
                  <button className={`${quiet} shrink-0 self-center`} onClick={() => setEditing(editing === r.id ? null : r.id)}>Change</button>
                )}
                {canRemove && (
                  <button
                    className={`${quiet} shrink-0 self-center text-red-300`}
                    onClick={() => setRemoving(removing === r.id ? null : r.id)}
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
              {removing === r.id && <RemoveRow row={r} onCancel={() => setRemoving(null)} onSave={(b) => send(`/api/attendance/${r.id}`, "DELETE", b).then((o) => o && setRemoving(null))} />}
              {moving === r.id && <MoveToStaff row={r} people={people} onSave={(b) => send(`/api/attendance/${r.id}/person`, "POST", b).then((o) => o && setMoving(null))} />}
            </div>
          ))}
        </div>
      )}

      {job.noShows.length > 0 && (point ? (
        <div className="border-t border-edge/70 px-3.5 py-2 text-xs text-amber-500">
          Not signed in: {job.noShows.map((p) => p.name).join(", ")}
        </div>
      ) : (
        // "On the board, no sign-in" (10 Nov 2026): who was allocated here and didn't sign in here; "No sign-in
        // anywhere" when they have none that day at all (0 hours). One tap opens the missed sign-in form for them.
        <div className="border-t border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs">
          <div className="mb-1 font-semibold text-amber-300">Allocated, not signed in here ({job.noShows.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {job.noShows.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-panel px-2 py-1 text-gray-200">
                {p.name}
                {p.nowhere && <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300">No sign-in anywhere</span>}
                {p.staff && !p.nowhere && <span className="text-[10px] text-gray-400">signed in elsewhere</span>}
                {canEdit && p.staff && (
                  <button
                    className="rounded-md border border-edge px-1.5 py-0.5 text-[10px] text-brand-300 hover:bg-panel2"
                    onClick={() => { setAddWho(p.id); setAdding(true); }}
                  >
                    Add missed sign-in
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The office changing a sign-in: times and/or status, always with a reason.
function EditRow({ row, onSave }: { row: AttendanceRow; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const init = { in: toLocal(row.signInAt), out: toLocal(row.signOutAt), status: row.status };
  const [v, setV] = useState({ ...init, pick: "", reason: "" });
  const reason = v.pick === OTHER_REASON ? v.reason.trim() : v.pick;
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
      <label className="flex flex-col gap-0.5 text-gray-400">
        Reason (kept with the change)
        <select className={inp} value={v.pick} onChange={(e) => setV({ ...v, pick: e.target.value })}>
          <option value="">Pick…</option>
          {CHANGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value={OTHER_REASON}>Other – type it…</option>
        </select>
      </label>
      {v.pick === OTHER_REASON && (
        <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-gray-400">
          Other reason
          <input className={inp} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. forgot to sign out - supervisor says 3:30pm" autoFocus />
        </label>
      )}
      <button
        className={btn}
        disabled={reason.length < 3 || !v.in || Object.keys(changes).length === 0}
        onClick={() => onSave({ ...changes, reason })}
      >
        Save
      </button>
    </div>
  );
}

// An Admin deleting a sign-in (e.g. signed in twice) - the reason is picked, not typed (Ilies, 8 Nov 2026).
function RemoveRow({ row, onSave, onCancel }: { row: AttendanceRow; onSave: (body: Record<string, unknown>) => Promise<unknown>; onCancel: () => void }) {
  const [pick, setPick] = useState(REMOVE_REASONS[0]);
  const [other, setOther] = useState("");
  const reason = pick === OTHER_REASON ? other.trim() : pick;
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs">
      <div className="w-full text-gray-300">
        Delete {row.name}&apos;s sign-in (in {row.in}{row.out ? `, out ${row.out}` : ""})? It won&apos;t count for any hours.
      </div>
      <label className="flex flex-col gap-0.5 text-gray-400">
        Reason (kept)
        <select className={inp} value={pick} onChange={(e) => setPick(e.target.value)}>
          {REMOVE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value={OTHER_REASON}>Other – type it…</option>
        </select>
      </label>
      {pick === OTHER_REASON && (
        <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-gray-400">
          Other reason
          <input className={inp} value={other} onChange={(e) => setOther(e.target.value)} autoFocus />
        </label>
      )}
      <button className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50" disabled={reason.length < 3} onClick={() => onSave({ reason })}>
        Delete sign-in
      </button>
      <button className={quiet} onClick={onCancel}>Cancel</button>
    </div>
  );
}

// The office adding a sign-in that was missed (Lobos crew or a hire worker).
// Fix 4 (2 Nov 2026): a hire sign-in that was really Lobos staff - pick who it was (the likely ones first) and why.
function MoveToStaff({ row, people, onSave }: { row: AttendanceRow; people: ResourceDTO[]; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const suggested = row.staffLike ?? [];
  const others = people.filter((p) => p.active !== false && !suggested.some((s) => s.id === p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const [who, setWho] = useState(suggested.find((s) => s.exact)?.id ?? ""); // TF-009: pre-selected on a full-name match only
  const [reason, setReason] = useState(`Signed in as hire ("${row.name}${row.company ? ` / ${row.company}` : ""}") - is staff`);
  return (
    <div className="mt-1 flex flex-wrap items-end gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
      <label className="text-gray-400">Staff member<br />
        <select className="rounded-md border border-edge bg-panel2 px-2 py-1 text-gray-200" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Pick...</option>
          {suggested.length > 0 && <optgroup label="Likely">{suggested.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
          <optgroup label="Everyone">{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
        </select>
      </label>
      <label className="min-w-[14rem] flex-1 text-gray-400">Reason (kept)<br /><input className="w-full rounded-md border border-edge bg-panel2 px-2 py-1 text-gray-200" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button disabled={!who || reason.trim().length < 3} onClick={() => onSave({ resourceId: who, reason })} className="rounded-md bg-brand-600 px-3 py-1 font-medium text-white disabled:opacity-40">Move</button>
    </div>
  );
}

// Why a sign-in was added by the office - picked, not typed (Ilies, 6 Nov 2026); "Other" still types one.
const MISSED_REASONS = [
  "Phone flat / no phone",
  "No signal on site",
  "Forgot to sign in",
  "QR code wouldn't scan",
  "Signed in on the wrong site",
  "Supervisor confirmed they were on site",
];
// Why the office changed a sign-in - picked the same way (Ilies, 7 Nov 2026).
const CHANGE_REASONS = [
  "Forgot to sign out",
  "Signed in before getting to site",
  "Signed out after leaving site",
  "Phone flat / no signal",
  "Supervisor confirmed the times",
  "Wasn't on site",
];
// Why the office signed several people out at once - picked the same way (Ilies, 7 Nov 2026).
const SIGN_OUT_REASONS = [
  "Forgot to sign out",
  "Phone flat / no signal",
  "Left site without signing out",
  "Supervisor confirmed the finish time",
];
// Why an Admin deleted a sign-in - picked the same way (Ilies, 8 Nov 2026).
const REMOVE_REASONS = [
  "Signed in twice",
  "Signed in on the wrong site",
  "Signed in for someone else",
  "Test sign-in",
];
const OTHER_REASON = "OTHER";

function AddMissed({ job, date, people, initialWho = "", onSave }: { job: AttendanceJob; date: string; people: ResourceDTO[]; initialWho?: string; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  // "In" starts at the job's start on the board (7am when it has none) - the office checks it before adding.
  const start = parseClock(job.startTime);
  const startHHMM = start == null ? "07:00" : `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
  const [v, setV] = useState({ who: initialWho, hireName: "", company: "", in: `${date}T${startHHMM}`, out: "", pick: "", reason: "", endOpen: false });
  const hire = v.who === "HIRE";
  const reason = v.pick === OTHER_REASON ? v.reason.trim() : v.pick;
  const allocatedIds = new Set(job.allocated.map((p) => p.id));
  // Fix 2a (2 Nov 2026): an earlier day needs its sign-out too - only today's can be left open (still on site).
  const needsOut = date !== new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
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
      <label className="flex flex-col gap-0.5 text-gray-400">{needsOut ? "Out (needed)" : "Out (leave empty if still on site)"}<input type="datetime-local" className={inp} value={v.out} onChange={(e) => setV({ ...v, out: e.target.value })} /></label>
      <label className="flex flex-col gap-0.5 text-gray-400">
        Reason
        <select className={inp} value={v.pick} onChange={(e) => setV({ ...v, pick: e.target.value })}>
          <option value="">Pick…</option>
          {MISSED_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value={OTHER_REASON}>Other – type it…</option>
        </select>
      </label>
      {v.pick === OTHER_REASON && (
        <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-gray-400">
          Other reason
          <input className={inp} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. new starter, no app yet" autoFocus />
        </label>
      )}
      {/* TF-006: with a sign-out filled in, ending another open sign-in is the office's choice (an open one always ends it). */}
      {v.out && (
        <label className="flex items-center gap-1.5 text-gray-300" title="If they still have a sign-in open somewhere else, it ends at this sign-in time (kept with a note).">
          <input type="checkbox" checked={v.endOpen} onChange={(e) => setV({ ...v, endOpen: e.target.checked })} /> End their other open sign-in
        </label>
      )}
      <button
        className={btn}
        disabled={!v.who || !v.in || (needsOut && !v.out) || reason.length < 3 || (hire && (!v.hireName.trim() || !v.company.trim()))}
        onClick={() =>
          onSave({
            ...(job.kind === "POINT" ? { place: job.place, vehicleId: job.vehicleId } : { jobId: job.id }),
            ...(hire ? { hire: { name: v.hireName, company: v.company } } : { resourceId: v.who }),
            signInAt: fromLocal(v.in),
            signOutAt: fromLocal(v.out),
            reason,
            ...(v.out && v.endOpen ? { endOpen: true } : {}),
          })
        }
      >
        Add
      </button>
    </div>
  );
}
