"use client";

import { useCallback, useEffect, useState } from "react";
import { Car, Home, Loader2, MapPin, Users } from "lucide-react";
import SiteBrand from "@/components/site/SiteBrand";
import { serverErrorMessage } from "@/lib/apiFetch";
import { deviceId, PASS_KEY, store, useQuietGps } from "@/lib/signinDevice";
import { MODE_BUTTON, NO_LINK_REFUSAL, type TravelMode } from "@/lib/travel/rules";

// Travel to and from regional jobs (2 Nov 2026, Ilies): the worker's own phone, no scan needed. The phone has to
// have signed in on site once (that gives it its travel pass). "Start travel" before leaving for a regional job -
// signing in on site ends it. After signing out of a regional job, "Travelling home", then "Arrived".
// Only regional jobs show here; local jobs work exactly as before. Times only - never a dollar figure.
// Since 24 Nov 2026 (Ilies) only people with their own SUPERVISOR or DRIVER link start travel here; crew riding along
// are told their driver's travel counts for them (the server refuses a start too).

type Leg = { id: string; direction: "OUT" | "HOME"; label: string; site: string; since: string | null; ended: string | null; open: boolean };
type Status = { name: string; open: Leg | null; outJobs: { jobId: string; label: string; leg: Leg | null }[]; home: { attendanceId: string; label: string } | null; homeLeg: Leg | null; byDriver?: boolean };
const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-5 text-lg font-semibold text-white disabled:opacity-50";

export default function TravelPage() {
  const [pass, setPass] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState("");

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/site/in/travel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pass: store<string>(PASS_KEY), deviceId: deviceId(), action, ...extra }),
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
    return res.json();
  }, []);

  const load = useCallback(() => {
    setError(null);
    call("STATUS").then((s: Status) => {
      setStatus(s);
      const startable = s.outJobs.filter((j) => !j.leg);
      if (startable.length === 1) setJobId(startable[0].jobId);
    }, (e) => setError((e as Error).message));
  }, [call]);

  useEffect(() => {
    setPass(store<string>(PASS_KEY));
    setReady(true);
  }, []);
  useEffect(() => { if (pass) load(); }, [pass, load]);

  const canStart = !!status && !status.open && (status.outJobs.some((j) => !j.leg) || !!status.home);
  const take = useQuietGps(canStart || !!status?.open);

  // Travel pay (23-24 Nov 2026): Start travel / Travelling home first asks how they're travelling - one tap on a big
  // button starts the leg. Nothing else in the flow changes.
  const [picking, setPicking] = useState<"START_OUT" | "START_HOME" | null>(null);

  async function act(action: "START_OUT" | "START_HOME" | "ARRIVED", mode?: TravelMode) {
    setBusy(true);
    setError(null);
    try {
      const r = await call(action, { jobId, gps: await take(), ...(mode ? { mode } : {}) });
      setPicking(null);
      setDone(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The two big buttons, in place of Start travel / Travelling home once tapped.
  const modePicker = (action: "START_OUT" | "START_HOME") => (
    <div className="space-y-3" data-testid="travel-mode-picker">
      <p className="text-center text-base font-semibold text-gray-100">How are you travelling?</p>
      <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => act(action, "DRIVER_OWN_VEHICLE")}>
        {busy ? <Loader2 className="animate-spin" /> : <Car />} {MODE_BUTTON.DRIVER_OWN_VEHICLE}
      </button>
      <button className={`${big} bg-sky-700`} disabled={busy} onClick={() => act(action, "PASSENGER")}>
        {busy ? <Loader2 className="animate-spin" /> : <Users />} {MODE_BUTTON.PASSENGER}
      </button>
      <p className="text-center text-xs text-gray-500">Driving the company truck? Sign in on the truck QR instead - that counts your drive.</p>
      <button className="w-full text-center text-sm text-gray-400 underline" disabled={busy} onClick={() => setPicking(null)}>Back</button>
    </div>
  );

  const startable = status?.outJobs.filter((j) => !j.leg) ?? [];
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between">
        <SiteBrand />
        <span className="text-sm text-gray-400">Regional travel</span>
      </div>
      {!ready ? null : !pass ? (
        <Box>Sign in on site once with this phone first (scan your supervisor&apos;s QR). Then travel to regional jobs works from this page.</Box>
      ) : done ? (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-emerald-500/15 px-4 py-6 text-lg font-semibold text-emerald-300">✓ {done}</div>
          <button className="text-sm text-gray-400 underline" onClick={() => { setDone(null); load(); }}>Back</button>
        </div>
      ) : !status ? (
        error ? <Box>{error}</Box> : <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-edge bg-panel p-4">
            <div className="text-sm text-gray-500">Travelling as</div>
            <div className="text-lg font-semibold text-gray-100">{status.name}</div>
          </div>
          {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}

          {status.open ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-brand-500/40 bg-brand-500/10 p-4 text-gray-100">
                <div className="font-semibold">{status.open.label} since {status.open.since}</div>
                <div className="text-sm text-gray-400">{status.open.site}</div>
              </div>
              {status.open.direction === "OUT" ? (
                <p className="text-center text-sm text-gray-400">When you get there, sign in on site as usual - that ends your travel.</p>
              ) : (
                <button className={`${big} bg-emerald-600`} disabled={busy} onClick={() => act("ARRIVED")}>
                  {busy ? <Loader2 className="animate-spin" /> : <MapPin />} Arrived
                </button>
              )}
            </div>
          ) : status.home ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">Signed out of {status.home.label}.</p>
              {picking === "START_HOME" ? modePicker("START_HOME") : (
                <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => setPicking("START_HOME")}>
                  <Home /> Travelling home
                </button>
              )}
            </div>
          ) : status.byDriver ? (
            <Box>{NO_LINK_REFUSAL} Your travel is worked out from the driver you travelled with - just sign in on the supervisor&apos;s QR when you get to site.</Box>
          ) : startable.length > 0 && picking === "START_OUT" ? (
            <div className="space-y-3">
              <p className="text-base text-gray-200">{startable.find((j) => j.jobId === jobId)?.label}</p>
              {modePicker("START_OUT")}
            </div>
          ) : startable.length > 0 ? (
            <div className="space-y-3">
              {startable.length > 1 && (
                <>
                  <h1 className="text-xl font-semibold text-gray-100">Which job are you travelling to?</h1>
                  {startable.map((j) => (
                    <button key={j.jobId} onClick={() => setJobId(j.jobId)} className={`w-full rounded-2xl border p-4 text-left text-base text-gray-100 ${jobId === j.jobId ? "border-brand-500 bg-brand-500/10" : "border-edge bg-panel"}`}>
                      {j.label}
                    </button>
                  ))}
                </>
              )}
              {startable.length === 1 && <p className="text-base text-gray-200">{startable[0].label}</p>}
              <button className={`${big} bg-brand-600`} disabled={busy || !jobId} onClick={() => setPicking("START_OUT")}>
                <Car /> Start travel
              </button>
            </div>
          ) : (
            <Box>No regional travel for you right now. Travel shows here on days you&apos;re on a regional job.</Box>
          )}

          {[...status.outJobs.filter((j) => j.leg && !j.leg.open).map((j) => j.leg!), ...(status.homeLeg && !status.homeLeg.open ? [status.homeLeg] : [])].map((l) => (
            <p key={l.id} className="text-center text-xs text-gray-500">{l.label} - {l.site}: {l.since}{l.ended ? ` to ${l.ended}` : " (not ended)"}</p>
          ))}
          <p className="text-center text-xs text-gray-500">Lobos notes where you are when you start travel and when you arrive - only at those moments.</p>
        </div>
      )}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{children}</div>;
}
