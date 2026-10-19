"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import QrCode from "@/components/QrCode";
import { serverErrorMessage } from "@/lib/apiFetch";

// The supervisor's crew sign-in screen (their own link, or a stand-in's
// one-day hand-over link). Shows a QR that changes every 30 seconds - crew
// scan it with their phone camera. Supervisors confirm poster sign-ins and
// tick in crew without a phone; they can't change a time (the office can).

type AttendanceRow = { id: string; in: string | null; out: string | null; method: string; outMethod: string | null; status: string };
type CrewRow = { resourceId: string | null; name: string; company: string | null; allocated: boolean; attendance: AttendanceRow | null };
type Job = { id: string; label: string; times: string | null; qrUrl: string; crew: CrewRow[]; toConfirm: (AttendanceRow & { name: string; company: string | null })[] };
type Data = { person: string; handover: boolean; rotateSeconds: number; jobs: Job[] };

const btn = "rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 disabled:opacity-50";

export default function SignInCrew({ api }: { api: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handTo, setHandTo] = useState("");
  const [handLink, setHandLink] = useState<{ name: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${api}/signin`);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't load - check your signal."));
    const d: Data = await res.json();
    setData(d);
    setJobId((cur) => (cur && d.jobs.some((j) => j.id === cur) ? cur : d.jobs[0]?.id ?? ""));
  }, [api]);

  // The QR changes every 30 seconds; refresh a little faster than that.
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function post(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`${api}/signin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - try again."));
      const out = await res.json();
      await load();
      return out;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="py-16 text-center text-gray-500">{error ?? <Loader2 className="mx-auto animate-spin" />}</div>;
  if (data.jobs.length === 0) {
    return (
      <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">
        You&apos;re not allocated to a job on the board today, so there&apos;s nothing to sign crew in to. Call the office if that&apos;s wrong.
      </div>
    );
  }
  const job = data.jobs.find((j) => j.id === jobId) ?? data.jobs[0];
  const signedIn = job.crew.filter((c) => c.attendance && !c.attendance.out && c.attendance.status !== "REJECTED").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-100">Sign in crew</h1>
        {data.jobs.length > 1 ? (
          <select className="mt-2 w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200" value={job.id} onChange={(e) => setJobId(e.target.value)}>
            {data.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
        ) : (
          <p className="text-sm text-gray-400">{job.label}{job.times && ` · ${job.times}`}</p>
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        <QrCode text={job.qrUrl} size={280} />
        <p className="text-center text-sm text-gray-400">Crew scan this with their phone camera to sign in or out. It changes every {data.rotateSeconds} seconds.</p>
      </div>

      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}

      {job.toConfirm.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
          <h2 className="mb-2 text-sm font-semibold text-amber-400">Signed in from the poster - confirm ({job.toConfirm.length})</h2>
          <div className="space-y-2">
            {job.toConfirm.map((a) => (
              <div key={a.id} className="rounded-xl bg-panel p-3">
                <div className="text-base text-gray-100">{a.name}{a.company && <span className="text-gray-400"> ({a.company})</span>}</div>
                <div className="mb-2 text-sm text-gray-400">In {a.in}{a.out ? ` · Out ${a.out}` : ""}{a.outMethod === "MOVED" ? " (signed in at another site)" : ""}</div>
                <div className="flex gap-2">
                  <button className={btn} disabled={!!busy} onClick={() => post(a.id, { action: "CONFIRM", attendanceId: a.id })}>Confirm</button>
                  <button className={quiet} disabled={!!busy} onClick={() => confirm(`${a.name} wasn't here?`) && post(a.id, { action: "REJECT", attendanceId: a.id })}>Wasn&apos;t here</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">Crew ({signedIn} on site)</h2>
        <div className="divide-y divide-edge/60 rounded-2xl border border-edge bg-panel">
          {job.crew.map((c, i) => {
            const a = c.attendance;
            const on = a && !a.out && a.status !== "REJECTED";
            return (
              <div key={c.resourceId ?? `x${i}`} className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base text-gray-100">
                    {c.name}
                    {c.company && <span className="text-sm text-gray-400"> ({c.company})</span>}
                    {!c.allocated && c.resourceId && <span className="ml-1 text-xs text-amber-500">not allocated</span>}
                  </div>
                  <div className="text-sm text-gray-500">
                    {!a ? "Not signed in" : a.status === "REJECTED" ? "Wasn't here" : `In ${a.in}${a.out ? ` · Out ${a.out}` : ""}${a.method === "MANUAL" ? " (ticked)" : ""}`}
                  </div>
                </div>
                {c.resourceId && (!a || a.out || a.status === "REJECTED") && (
                  <button className={quiet} disabled={!!busy} onClick={() => confirm(`Sign ${c.name} in now?`) && post(`in${c.resourceId}`, { action: "MANUAL_IN", jobId: job.id, resourceId: c.resourceId })}>
                    Tick in
                  </button>
                )}
                {on && (
                  <button className={quiet} disabled={!!busy} onClick={() => confirm(`Sign ${c.name} out now?`) && post(`out${a!.id}`, { action: "MANUAL_OUT", attendanceId: a!.id })}>
                    Tick out
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">Tick in / out is for crew without a phone - it uses the time now. Only the office can change a time.</p>
      </section>

      {!data.handover && (
        <section className="rounded-2xl border border-edge bg-panel p-3">
          <h2 className="mb-1 text-sm font-semibold text-gray-200">Hand over sign-in</h2>
          <p className="mb-2 text-sm text-gray-500">Leaving site, or someone else is running the crew? Give another lead today&apos;s sign-in for this job. Their link stops working tonight.</p>
          <div className="flex gap-2">
            <select className="min-w-0 flex-1 rounded-lg border border-edge bg-panel2 px-3 py-2 text-base text-gray-200" value={handTo} onChange={(e) => setHandTo(e.target.value)}>
              <option value="">Pick who…</option>
              {job.crew.filter((c) => c.resourceId && c.allocated && c.name !== data.person).map((c) => <option key={c.resourceId!} value={c.resourceId!}>{c.name}</option>)}
            </select>
            <button
              className={btn}
              disabled={!handTo || !!busy}
              onClick={async () => {
                const out = await post("handover", { action: "HANDOVER", jobId: job.id, resourceId: handTo });
                if (out) setHandLink({ name: out.name, url: out.url });
              }}
            >
              Hand over
            </button>
          </div>
          {handLink && (
            <div className="mt-3 rounded-xl border border-brand-500 bg-brand-600/10 p-3 text-sm">
              <div className="mb-2 text-gray-200">Send this to {handLink.name} (only them):</div>
              <div className="mb-2 break-all font-mono text-xs text-gray-300">{handLink.url}</div>
              <button
                className={`${btn} flex items-center gap-1.5`}
                onClick={async () => {
                  const text = `Lobos sign-in for today - ${job.label}: ${handLink.url}`;
                  try {
                    if (navigator.share) await navigator.share({ text });
                    else await navigator.clipboard.writeText(handLink.url);
                  } catch {}
                }}
              >
                <Share2 size={16} /> Send
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
