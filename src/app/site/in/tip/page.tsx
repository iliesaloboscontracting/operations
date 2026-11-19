"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Truck } from "lucide-react";
import SiteBrand from "@/components/site/SiteBrand";
import { serverErrorMessage } from "@/lib/apiFetch";
import { deviceId, PASS_KEY, store } from "@/lib/signinDevice";

// Regional tip run (19 Nov 2026, Ilies: shift rollover): the worker's own phone, no scan. After signing out of a
// regional shift (within 12 hours) the supervisor or driver going back to tip the truck taps "Start tip run", then
// "Tipped – finished" - no second sign-in. The hours count to that shift's day. Then a reminder to photograph the tip
// docket on their link (the existing Receipts). Times and hours only - never a dollar figure. No location.

type Run = { id: string; site: string; countsTo: string; since: string | null; ended: string | null; hours: number | null; open: boolean };
type Status = { name: string; enabled: boolean; open: Run | null; shifts: { attendanceId: string; label: string; signedOut: string | null }[]; recent: Run[]; signedIn: boolean; reminder: string };
const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-5 text-lg font-semibold text-white disabled:opacity-50";

export default function TipRunPage() {
  const [pass, setPass] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; reminder?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shiftId, setShiftId] = useState("");

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/site/in/tip", {
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
      if (s.shifts.length >= 1) setShiftId(s.shifts[0].attendanceId);
    }, (e) => setError((e as Error).message));
  }, [call]);

  useEffect(() => {
    setPass(store<string>(PASS_KEY));
    setReady(true);
  }, []);
  useEffect(() => { if (pass) load(); }, [pass, load]);

  async function act(action: "START" | "FINISH") {
    setBusy(true);
    setError(null);
    try {
      const r = await call(action, action === "START" ? { attendanceId: shiftId } : {});
      if (action === "START") load();
      else setDone({ message: r.message, reminder: r.reminder });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between">
        <SiteBrand />
        <span className="text-sm text-gray-400">Tip run</span>
      </div>
      {!ready ? null : !pass ? (
        <Box>Sign in on site once with this phone first (scan your supervisor&apos;s QR). Then tip runs after a regional shift work from this page.</Box>
      ) : done ? (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-emerald-500/15 px-4 py-6 text-lg font-semibold text-emerald-300">✓ {done.message}</div>
          {done.reminder && <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" data-testid="docket-reminder">{done.reminder}</div>}
          <button className="text-sm text-gray-400 underline" onClick={() => { setDone(null); load(); }}>Back</button>
        </div>
      ) : !status ? (
        error ? <Box>{error}</Box> : <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-edge bg-panel p-4">
            <div className="text-sm text-gray-500">Tip run for</div>
            <div className="text-lg font-semibold text-gray-100">{status.name}</div>
          </div>
          {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}

          {status.open ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-violet-500/40 bg-violet-500/10 p-4 text-gray-100">
                <div className="font-semibold">Tip run since {status.open.since}</div>
                <div className="text-sm text-gray-400">{status.open.site} - counts to {status.open.countsTo}</div>
              </div>
              <button className={`${big} bg-emerald-600`} disabled={busy} onClick={() => act("FINISH")}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Tipped – finished
              </button>
            </div>
          ) : !status.enabled ? (
            <Box>Tip runs are switched off. Sign in on the shift&apos;s QR instead, or ask the office.</Box>
          ) : status.signedIn ? (
            <Box>You&apos;re signed in right now - sign out first, then start the tip run.</Box>
          ) : status.shifts.length > 0 ? (
            <div className="space-y-3">
              {status.shifts.length > 1 ? (
                <>
                  <h1 className="text-xl font-semibold text-gray-100">Which shift is this tip run for?</h1>
                  {status.shifts.map((s) => (
                    <button key={s.attendanceId} onClick={() => setShiftId(s.attendanceId)} className={`w-full rounded-2xl border p-4 text-left text-base text-gray-100 ${shiftId === s.attendanceId ? "border-violet-500 bg-violet-500/10" : "border-edge bg-panel"}`}>
                      {s.label}{s.signedOut && <span className="block text-sm text-gray-400">Signed out {s.signedOut}</span>}
                    </button>
                  ))}
                </>
              ) : (
                <p className="text-base text-gray-200">{status.shifts[0].label}{status.shifts[0].signedOut && <span className="block text-sm text-gray-400">Signed out {status.shifts[0].signedOut}</span>}</p>
              )}
              <button className={`${big} bg-violet-600`} disabled={busy || !shiftId} onClick={() => act("START")}>
                {busy ? <Loader2 className="animate-spin" /> : <Truck />} Start tip run
              </button>
              <p className="text-center text-xs text-gray-500">No second sign-in - the hours count to that shift.</p>
            </div>
          ) : (
            <Box>No tip run to start. It shows here for 12 hours after you sign out of a regional shift.</Box>
          )}

          {status.recent.map((r) => (
            <p key={r.id} className="text-center text-xs text-gray-500">Tip run - {r.site}: {r.since}{r.ended ? ` to ${r.ended}` : ""}{r.hours != null ? ` (${r.hours}h, counts to ${r.countsTo})` : ""}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{children}</div>;
}
