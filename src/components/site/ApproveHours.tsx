"use client";

// "Approve today's hours" on a supervisor's link (Accounts stage 2): after the crew sign out, the
// supervisor checks each person's in / out / hours for the day and approves it - flagging anyone who
// isn't right with a note for the office. A separate step: the sign-in flow doesn't change. Names and
// hours only, never money. Victoria sees what was approved (and anything changed since) on Accounts.
import { useCallback, useEffect, useState } from "react";
import { Check, Flag, Loader2 } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { DayHoursDTO } from "@/lib/payroll/store";

const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const sydneyDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });

// Fix 2b (2 Nov 2026): before approving today, anyone still signed in - sign them all out now, or one at the time
// they left (earlier today). Never a time in the future; the office still changes anything else.
function StillSignedIn({ api, crew, onChanged }: { api: string; crew: DayHoursDTO["jobs"][number]["crew"]; onChanged: () => void }) {
  const [times, setTimes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch(`${api}/signin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't sign out.") : "Couldn't send - check your signal.");
    onChanged();
  }
  return (
    <div className="mt-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3">
      <p className="text-sm font-semibold text-amber-200">{crew.length} {crew.length === 1 ? "person is" : "people are"} still signed in</p>
      <ul className="mt-2 space-y-2">
        {crew.map((c) => (
          <li key={c.attendanceId} className="flex flex-wrap items-center gap-2 text-sm text-gray-200">
            <span className="min-w-0 flex-1">{c.name} <span className="text-gray-500">in {c.in}</span></span>
            <input type="time" aria-label={`Time ${c.name} left`} className="rounded-lg border border-edge bg-panel2 px-2 py-1 text-sm text-gray-200" value={times[c.attendanceId] ?? ""} onChange={(e) => setTimes({ ...times, [c.attendanceId]: e.target.value })} />
            <button disabled={busy || !times[c.attendanceId]} onClick={() => send({ action: "MANUAL_OUT_AT", attendanceId: c.attendanceId, time: times[c.attendanceId] })} className="rounded-lg border border-edge px-2.5 py-1 text-xs text-gray-200 disabled:opacity-40">Out at that time</button>
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={() => send({ action: "MANUAL_OUT_MANY", attendanceIds: crew.map((c) => c.attendanceId) })} className={`${primary} mt-3 bg-amber-600`}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : null} Sign {crew.length === 1 ? "them" : "all"} out now
      </button>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}

export default function ApproveHours({ api, onDone }: { api: string; onDone: (message: string) => void }) {
  const [date, setDate] = useState(sydneyDay());
  const [data, setData] = useState<DayHoursDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isToday = date === sydneyDay();

  const load = useCallback(async () => {
    setData(null);
    const res = await fetch(`${api}/hours?date=${date}`).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load.") : "Couldn't load - check your signal.");
    setError(null);
    const d: DayHoursDTO = await res.json();
    setData(d);
    setFlags(Object.assign({}, ...d.jobs.map((j) => j.flags)));
  }, [api, date]);
  useEffect(() => { load(); }, [load]);

  async function approve(jobId: string) {
    setBusy(jobId); setError(null);
    const job = data!.jobs.find((j) => j.jobId === jobId)!;
    const mine = Object.fromEntries(job.crew.filter((c) => flags[c.attendanceId]?.trim()).map((c) => [c.attendanceId, flags[c.attendanceId].trim()]));
    const res = await fetch(`${api}/hours`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, date, flags: mine }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't approve.") : "Couldn't send - check your signal.");
    onDone((await res.json()).message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Approve hours</h1>
      <div className="flex gap-2">
        {[0, -1].map((o) => (
          <button key={o} onClick={() => setDate(sydneyDay(o))} className={`rounded-full border px-3 py-1.5 text-sm ${date === sydneyDay(o) ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge text-gray-300"}`}>{o === 0 ? "Today" : "Yesterday"}</button>
        ))}
      </div>
      <p className="text-sm text-gray-400">{dayLabel(date)} - check each person&apos;s hours and approve. Flag anyone who isn&apos;t right; the office sorts it out.</p>
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!data ? <div className="py-10 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
        : data.jobs.length === 0 ? <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">No sign-ins on your jobs that day.</p>
        : data.jobs.map((j) => {
          const open = j.crew.filter((c) => !c.out).length, toConfirm = j.crew.filter((c) => c.toConfirm).length;
          return (
            <div key={j.jobId} className="rounded-2xl border border-edge bg-panel p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold text-gray-100">{j.label}</span>
                {j.approved && <span className={`text-xs ${j.approved.changed ? "text-amber-300" : "text-emerald-300"}`}>{j.approved.changed ? "Changed since you approved" : "Approved ✓"}</span>}
              </div>
              <ul className="divide-y divide-edge/60">
                {j.crew.map((c) => (
                  <li key={c.attendanceId} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-gray-200">{c.name}{c.company && <span className="text-gray-500"> ({c.company})</span>}</span>
                      <span className="text-sm tabular-nums text-gray-300">{c.in} - {c.out ?? <span className="text-amber-300">not out</span>}{c.hours != null && <b className="ml-2 text-gray-100">{c.hours} h</b>}</span>
                    </div>
                    {c.toConfirm && <div className="text-xs text-amber-300">Poster sign-in - confirm it on Sign in crew first</div>}
                    {c.notOnBoard && <div className="text-xs text-amber-300">Not on the board - confirm they worked (or tap Not right?)</div>}
                    {c.overlap && <div className="text-xs text-gray-400">Also signed in somewhere else at the same time - counted once</div>}
                    {editing === c.attendanceId || flags[c.attendanceId] ? (
                      <input className="mt-1 w-full rounded-lg border border-amber-500/50 bg-panel2 px-3 py-2 text-sm text-gray-200" placeholder="What's not right? e.g. left at 1pm" autoFocus={editing === c.attendanceId}
                        value={flags[c.attendanceId] ?? ""} onChange={(e) => setFlags({ ...flags, [c.attendanceId]: e.target.value })} />
                    ) : (
                      <button className="mt-1 flex items-center gap-1 text-xs text-gray-500" onClick={() => setEditing(c.attendanceId)}><Flag size={12} /> Not right?</button>
                    )}
                  </li>
                ))}
              </ul>
              {/* Today: sign them out / confirm first. A past day can't be fixed here, so it's sent flagged to the office. */}
              {open > 0 && isToday && <StillSignedIn api={api} crew={j.crew.filter((c) => !c.out)} onChanged={load} />}
              {open > 0 && !isToday && <p className="mt-2 text-sm text-amber-300">{open} not signed out - you can still approve; the office will set their time.</p>}
              {toConfirm > 0 && <p className="mt-1 text-sm text-amber-300">{toConfirm} poster sign-in{toConfirm === 1 ? "" : "s"} not confirmed{isToday ? " - confirm on Sign in crew first." : " - you can still approve; the office will check."}</p>}
              <button className={`${primary} mt-3`} disabled={(isToday && (open > 0 || toConfirm > 0)) || busy === j.jobId} onClick={() => approve(j.jobId)}>
                {busy === j.jobId ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} {j.approved ? "Approve again" : "Approve the day"}
              </button>
            </div>
          );
        })}
    </div>
  );
}
