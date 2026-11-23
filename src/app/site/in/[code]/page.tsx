"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import PrestartCheck, { type PrestartResult } from "@/components/site/PrestartCheck";
import CrewMessages from "@/components/site/CrewMessages";
import { Camera, Car, Home, Loader2, LogIn, LogOut, Truck } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";
import { deviceId, ME_KEY, PASS_KEY, store, useQuietGps } from "@/lib/signinDevice";
import { looksLikeLobos } from "@/lib/staffMatch";
import { OTHER_COMPANY } from "@/lib/labourHire/rules";
import { requiredTimeoutMessage } from "@/lib/prestart/rules";

// Crew sign-in: the page a worker's phone opens after scanning the
// supervisor's QR or the site poster. First time they pick their name (or
// say they're from a hire company); their phone remembers them, so after
// that it's one tap. No login - the scan is the key, and the time is the
// server's.

type Person = { id: string; name: string };
// signInClosed: a site poster outside its sign-in window (11 Nov 2026) - the words to show; signing out still works.
type Job = { id: string; label: string; times: string | null; crew: Person[]; signInClosed?: string; notYet?: string };
// Just off a night shift (19 Nov 2026, lib/shiftRollover.ts): the question the server asks before a new sign-in.
type ShiftAsk = { shift: string; countsTo: string; signedOut: string; sameOffered: boolean; newOffered: boolean; newShift: string; sameNote: string | null; tipRun: boolean };
class AskError extends Error { constructor(public ask: ShiftAsk, message: string) { super(message); } }
// hireCompanies (13 Nov 2026): the labour hire companies a hire worker picks from.
type Scan = { method: "SUPERVISOR_QR" | "POSTER" | "POINT"; ticket: string; jobs: Job[]; hireCompanies?: string[] };
type Me = { resourceId: string; name: string } | { hire: { name: string; company: string } };

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-5 text-lg font-semibold text-white disabled:opacity-50";

export default function CrewSignInPage({ params: paramsP }: { params: Promise<{ code: string }> }) {
  const params = use(paramsP);
  const [scan, setScan] = useState<Scan | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<{ signedIn: boolean; since: string | null; signInClosed?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Signed in on a truck: the odometer photo comes next (Receipts R1).
  const [odometer, setOdometer] = useState<string | null>(null);
  // Stage 1b (10 Nov 2026): the day's first pre-start for this truck needs the odometer (no "Can't now") and the
  // walk-around photos. The token stays for the pre-start screen, which can take a missing odometer photo too.
  const [odoRequired, setOdoRequired] = useState(false);
  const [odoToken, setOdoToken] = useState<string | null>(null);
  // ...and the pre-start after it (sign-in), or the post-check (sign-out) - 8 Nov 2026. Skippable ("Do it later") -
  // except, since Ilies on 23 Nov 2026, the truck's first pre-start of the day (prestartRequired): no skip, and reopening
  // the QR on this phone comes straight back to it (the STATUS reply hands the token back while it's still needed).
  const [prestart, setPrestart] = useState<string | null>(null);
  const [prestartRequired, setPrestartRequired] = useState(false);
  const [checkSent, setCheckSent] = useState<PrestartResult["sent"]>([]);
  // Regional travel (2 Nov 2026): after a sign-in / sign-out the phone may be offered the travel page or "Travelling home".
  const [travel, setTravel] = useState<{ link: boolean; home: boolean; tip: boolean }>({ link: false, home: false, tip: false });
  // The same-shift question (19 Nov 2026), when the server asked it.
  const [ask, setAsk] = useState<ShiftAsk | null>(null);
  // Message at sign-in (23 Nov 2026): the token a saved sign-in hands back; the office's notes for this person are
  // fetched with it on the final screen - after the odometer and any pre-start, so they never get in the way.
  const [msgToken, setMsgToken] = useState<string | null>(null);
  // Accounts stage 2 (Ilies: GPS "with sign in", "do not change the way the current sign in works"): the
  // phone's position is asked for once, quietly, while the Sign in button shows, and sent with the sign-in
  // only. Never tracked; a refusal or no fix never holds the sign-in up.
  const gps = useRef<{ status: string; lat?: number; lng?: number; accuracy?: number } | null>(null);
  const gpsAsked = useRef(false);

  useEffect(() => {
    setMe(store<Me>(ME_KEY));
    fetch(`/api/site/in/${encodeURIComponent(params.code)}`).then(async (res) => {
      if (!res.ok) return setDead(await serverErrorMessage(res, "That code isn't working - scan it again."));
      const s: Scan = await res.json();
      setScan(s);
      if (s.jobs.length === 1) setJobId(s.jobs[0].id);
    });
  }, [params.code]);

  const send = useCallback(
    async (action: "STATUS" | "IN" | "OUT", who: Me, extra: Record<string, unknown> = {}) => {
      const res = await fetch("/api/site/in/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: scan!.ticket, jobId, action, deviceId: deviceId(), ...who, ...extra }),
      });
      if (res.status === 409) {
        const j = await res.clone().json().catch(() => null);
        if (j?.ask) throw new AskError(j.ask, j.error ?? "");
      }
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      return res.json();
    },
    [scan, jobId]
  );

  // Once we know the job and who they are, ask whether they're in or out.
  useEffect(() => {
    if (!scan || !jobId || !me) return;
    setStatus(null);
    send("STATUS", me).then((s) => {
      setStatus(s);
      // Reopened with the truck's first pre-start still to send (23 Nov 2026): straight back into it - the odometer
      // first if it isn't in yet. The sign-in time was saved at the scan.
      if (typeof s.prestart === "string" && s.prestartRequired === true) {
        setDone(`Signed in since ${s.since ?? "earlier"} - the pre-start is still to send.`);
        setOdoRequired(s.walkaroundRequired === true);
        setOdoToken(typeof s.odometer === "string" ? s.odometer : null);
        setOdometer(typeof s.odometer === "string" && !s.odometerSent ? s.odometer : null);
        setPrestart(s.prestart);
        setPrestartRequired(true);
      }
    }, (e) => setError((e as Error).message));
  }, [scan, jobId, me, send]);

  // Ask for the position once the Sign in button is showing (the browser asks permission the first time).
  useEffect(() => {
    if (!status || status.signedIn || gpsAsked.current) return;
    gpsAsked.current = true;
    if (!("geolocation" in navigator)) { gps.current = { status: "UNAVAILABLE" }; return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { gps.current = { status: "OK", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; },
      (e) => { gps.current = { status: e.code === 1 ? "DENIED" : e.code === 3 ? "TIMEOUT" : "UNAVAILABLE" }; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120_000 },
    );
  }, [status]);

  // Returns the error's words, or null when it went.
  async function act(action: "IN" | "OUT", shiftAnswer?: "SAME" | "NEW"): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      // Signing in: wait at most 1.5 s for the position, then go without it.
      if (action === "IN") for (let i = 0; i < 15 && !gps.current; i++) await new Promise((r) => setTimeout(r, 100));
      const r = await send(action, me!, action === "IN" ? { gps: gps.current ?? { status: "TIMEOUT" }, ...(shiftAnswer ? { shiftAnswer } : {}) } : {});
      setAsk(null);
      setDone(r.message);
      // Each reply says what comes next - a sign-out from the pre-start screen (23 Nov 2026) clears the pre-start's steps.
      setOdometer(typeof r.odometer === "string" ? r.odometer : null);
      if (typeof r.odometer === "string") setOdoToken(r.odometer);
      setOdoRequired(r.walkaroundRequired === true);
      setPrestartRequired(r.prestartRequired === true);
      setPrestart(typeof r.prestart === "string" ? r.prestart : typeof r.postcheck === "string" ? r.postcheck : null);
      if (typeof r.travelPass === "string") store(PASS_KEY, r.travelPass);
      setTravel({ link: !!r.travelLink, home: !!r.travelHome, tip: !!r.tipRun });
      if (typeof r.messages === "string") setMsgToken(r.messages); // a sign-in only; kept through a later sign-out
      return null;
    } catch (e) {
      if (e instanceof AskError) { setAsk(e.ask); return e.message; }
      setError((e as Error).message);
      return (e as Error).message;
    } finally {
      setBusy(false);
    }
  }
  // Sign-out is never blocked (Ilies, 23 Nov 2026): the required pre-start screen offers it - the pre-start stays "not
  // done" for the office. The post-check comes next, as with any truck sign-out.
  async function signOutInstead() {
    if (!window.confirm("Sign out now? Your pre-start stays not done.")) return;
    const err = await act("OUT");
    if (err) window.alert(err);
  }

  const job = scan?.jobs.find((j) => j.id === jobId);
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-10 pt-5">
      <div className="mb-5 flex items-center justify-between">
        <SiteBrand />
        <span className="text-sm text-gray-400">Site sign-in</span>
      </div>

      {dead ? (
        <Box>{dead}</Box>
      ) : !scan ? (
        <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : done && odometer ? (
        <Odometer token={odometer} signedIn={done} required={odoRequired && !!prestart} noSkip={prestartRequired} busyOut={busy} onDone={(m) => { setOdometer(null); setDone(`${done} ${m}`); }}
          onSkipAll={(m) => { setOdometer(null); setPrestart(null); setDone(`${done} ${m}`); }} onSignOut={signOutInstead} />
      ) : done && prestart ? (
        <PrestartCheck token={prestart} banner={done} odometerToken={odoToken}
          onDone={(r) => { setPrestart(null); setPrestartRequired(false); setCheckSent(r.sent); setDone(`${done} ${r.message}`); }}
          onSkip={() => { setPrestart(null); setPrestartRequired(false); }} onSignOut={prestartRequired ? signOutInstead : undefined} />
      ) : done ? (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-emerald-500/15 px-4 py-6 text-lg font-semibold text-emerald-300">✓ {done}</div>
          {/* Message at sign-in (23 Nov 2026): only now - the sign-in is saved and any pre-start is behind them. */}
          {msgToken && <CrewMessages source={{ token: msgToken }} />}
          {checkSent.length > 0 && (
            <div className="rounded-xl border border-edge bg-panel p-3 text-left text-sm text-gray-300">
              <div className="mb-1 font-semibold text-gray-100">Sent to the office:</div>
              {checkSent.map((f, i) => <div key={i}>• {f.itemLabel} - {f.priority}{f.markedDown ? " (marked Down)" : ""}</div>)}
            </div>
          )}
          {travel.tip && <TipRunLink />}
          {travel.home ? <TravellingHome /> : <p className="text-sm text-gray-500">You can close this page.</p>}
          {travel.link && !travel.home && <TravelLink />}
        </div>
      ) : !jobId ? (
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-gray-100">Which job are you on?</h1>
          {scan.jobs.map((j) => (
            <button key={j.id} onClick={() => setJobId(j.id)} className="w-full rounded-2xl border border-edge bg-panel p-4 text-left text-base text-gray-100">
              {j.label} {j.times && <span className="text-sm text-gray-500">· {j.times}</span>}
              {j.signInClosed && <span className="mt-1 block text-sm text-amber-300">Sign-in closed now - signing out still works.</span>}
              {!j.signInClosed && j.notYet && <span className="mt-1 block text-sm text-amber-300">{j.notYet}</span>}
            </button>
          ))}
        </div>
      ) : !me ? (
        <>
          {job?.signInClosed && <Closed text={job.signInClosed} out />}
          <WhoAreYou job={job!} ticket={scan.ticket} companies={scan.hireCompanies ?? []} onPick={(m) => setMe(store(ME_KEY, m))} />
        </>
      ) : (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-100">{job?.label}</h1>
            {job?.times && <p className="text-sm text-gray-500">{job.times}</p>}
          </div>
          <div className="rounded-2xl border border-edge bg-panel p-4">
            <div className="text-sm text-gray-500">Signing in as</div>
            <div className="text-lg font-semibold text-gray-100">
              {"hire" in me ? `${me.hire.name} (${me.hire.company})` : me.name}
            </div>
            <button className="mt-1 text-sm text-gray-400 underline" onClick={() => { setMe(store<Me>(ME_KEY, null)); setStatus(null); }}>
              Not you?
            </button>
          </div>
          {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
          {!status ? (
            <div className="py-6 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
          ) : status.signedIn ? (
            <>
              <p className="text-center text-sm text-gray-400">Signed in since {status.since}</p>
              <button className={`${big} bg-amber-600`} disabled={busy} onClick={() => act("OUT")}>
                {busy ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
              </button>
            </>
          ) : ask ? (
            <SameShift ask={ask} busy={busy} onAnswer={(a) => act("IN", a)} onCancel={() => setAsk(null)} />
          ) : status.signInClosed || job?.signInClosed ? (
            <Closed text={(status.signInClosed || job?.signInClosed)!} />
          ) : (
            <>
              <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => act("IN")}>
                {busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
              </button>
              <p className="text-center text-xs text-gray-500">Lobos notes where you are when you sign in - only at that moment.</p>
            </>
          )}
          {scan.method === "POSTER" && <p className="text-center text-xs text-gray-500">Signed in from the site poster - your supervisor confirms it.</p>}
        </div>
      )}
    </div>
  );
}

// Just off a night shift (19 Nov 2026): "Back on the same shift" or "This is a new shift" - never signed in silently.
function SameShift({ ask, busy, onAnswer, onCancel }: { ask: ShiftAsk; busy: boolean; onAnswer: (a: "SAME" | "NEW") => void; onCancel: () => void }) {
  return (
    <div className="space-y-3" data-testid="shift-ask">
      <p className="rounded-xl border border-edge bg-panel px-4 py-3 text-sm text-gray-200">You signed out of {ask.shift} at {ask.signedOut}.</p>
      {ask.sameOffered && (
        <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => onAnswer("SAME")}>
          {busy ? <Loader2 className="animate-spin" /> : <LogIn />} Back on the same shift (counts to {ask.countsTo})
        </button>
      )}
      {ask.newOffered && (
        <button className={`${big} bg-panel2 text-gray-100`} disabled={busy} onClick={() => onAnswer("NEW")}>
          This is a new shift
        </button>
      )}
      {ask.newOffered && <p className="text-center text-xs text-gray-500">New shift: {ask.newShift}</p>}
      {ask.sameNote && <p className="text-center text-xs text-gray-500">{ask.sameNote}</p>}
      {ask.tipRun && <TipRunLink note="Going back to tip the truck? Use Start tip run instead - no sign-in needed." />}
      <button className="w-full py-2 text-sm text-gray-400" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// Regional tip run (19 Nov 2026): the tip run page - the driver going back to tip the truck after a regional shift.
function TipRunLink({ note = "Going back to tip the truck? Start tip run (no sign-in needed)" }: { note?: string }) {
  return (
    <a href="/site/in/tip" className="flex items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-200" data-testid="tip-run-link">
      <Truck size={16} /> {note}
    </a>
  );
}

// Regional travel (2 Nov 2026): the travel page - saved to the home screen, it starts travel with no scan.
function TravelLink() {
  return (
    <a href="/site/in/travel" className="flex items-center justify-center gap-2 rounded-xl border border-edge bg-panel px-4 py-3 text-sm text-brand-300">
      <Car size={16} /> Travelling to a regional job? Open the travel page (save it to your home screen)
    </a>
  );
}

// Signed out of a regional job: one tap starts the trip home (one quiet GPS point, at most 1.5 s).
function TravellingHome() {
  const take = useQuietGps(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/site/in/travel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pass: store<string>(PASS_KEY), deviceId: deviceId(), action: "START_HOME", gps: await take() }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      setMsg((await res.json()).message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (msg) return <div className="space-y-2"><div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">✓ {msg}</div><TravelLinkArrived /></div>;
  return (
    <div className="space-y-2">
      <button className={`${big} bg-brand-600`} disabled={busy} onClick={go}>{busy ? <Loader2 className="animate-spin" /> : <Home />} Travelling home</button>
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <p className="text-xs text-gray-500">Not going home now? You can close this page.</p>
    </div>
  );
}
function TravelLinkArrived() {
  return <a href="/site/in/travel" className="block text-sm text-brand-300 underline">Tap Arrived on the travel page when you get home</a>;
}

// After signing in on a truck's QR: a photo of the odometer, or "Can't now". Stage 1b: on the day's first pre-start
// for the truck it's required - no "Can't now". Ilies, 23 Nov 2026 (noSkip): no "Do it later" either - the driver can't
// skip the truck's first pre-start of the day; "Sign out" stays (never blocked), and a full photo limit (429) lets them
// go on without the photo (the server counts it).
function Odometer({ token, signedIn, required, noSkip, busyOut, onDone, onSkipAll, onSignOut }: {
  token: string; signedIn: string; required: boolean; noSkip: boolean; busyOut: boolean;
  onDone: (message: string) => void; onSkipAll: (message: string) => void; onSignOut: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false); // the truck's odometer photos for today are used up
  async function send(body: Record<string, unknown>, all = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/site/in/odometer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
      if (res.status === 429) setFull(true);
      // PT-005: the token ran out on the required screen - scanning the truck QR again resumes it.
      const timedOut = requiredTimeoutMessage(noSkip, res.status);
      if (timedOut) throw new Error(timedOut);
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      const m = (await res.json()).message;
      if (all) onSkipAll(m); else onDone(m);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-emerald-500/15 px-4 py-4 text-center text-base font-semibold text-emerald-300">✓ {signedIn}</div>
      <h1 className="text-xl font-semibold text-gray-100">Odometer photo</h1>
      <p className="text-sm text-gray-400">A photo of the odometer, so the office can track the truck&apos;s km.{required ? " First check of the day on this truck - it's needed, with the walk-around photos." : ""}</p>
      <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => file.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Camera />} Take the photo
      </button>
      <input ref={file} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send({ dataUrl: await resizePhoto(f) }); }} />
      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {noSkip ? (
        <div className="space-y-1 text-center" data-testid="odometer-required">
          {full && <button className={`${big} bg-panel2 text-gray-100`} disabled={busy} onClick={() => send({ skip: true })}>Go on without it (photo limit reached)</button>}
          <p className="text-xs text-gray-400">Next: the pre-start - it has to be sent before you drive. Your sign-in time is already saved.</p>
          <button className="w-full py-2 text-sm text-gray-400" disabled={busy || busyOut} onClick={onSignOut}>Not driving after all? Sign out</button>
        </div>
      ) : required
        ? <button className="w-full py-2 text-sm text-gray-400" disabled={busy} onClick={() => send({ skip: true }, true)}>Do it later (skip the pre-start)</button>
        : <button className="w-full py-2 text-sm text-gray-400" disabled={busy} onClick={() => send({ skip: true })}>Can&apos;t now</button>}
    </div>
  );
}

// The site poster outside its sign-in window (11 Nov 2026): no Sign in button. Signing out is never blocked.
function Closed({ text, out = false }: { text: string; out?: boolean }) {
  return (
    <div className="mb-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      {text}
      {out && <span className="mt-1 block text-amber-300/80">Signing out still works - pick your name.</span>}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{children}</div>;
}

// First time on this phone: pick your name from the job's crew, find it in
// the register, or say you're from a hire company / subcontractor.
// Hire: the company is picked from the list (13 Nov 2026, Ilies: "lets only put a list for when the guys are asked..
// Advanced labour hire shows only.. with the potential to add more"); "Other" types it - nobody is stopped from signing in.
function WhoAreYou({ job, ticket, companies, onPick }: { job: Job; ticket: string; companies: string[]; onPick: (m: Me) => void }) {
  // No list (the yard): straight to typing their name.
  const [mode, setMode] = useState<"crew" | "search" | "hire">(job.crew.length ? "crew" : "search");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [hire, setHire] = useState({ name: "", company: "" });
  // The company picked from the list; OTHER_COMPANY = typed in the box. No list (an old server) = the box straight away.
  const [picked, setPicked] = useState<string | null>(null);
  const other = picked === OTHER_COMPANY || companies.length === 0;
  const company = other ? hire.company : picked ?? "";
  // Fix 4 (2 Nov 2026): Lobos staff must pick their own name - a "hire" sign-in never reaches the staff timesheet.
  const [staffNote, setStaffNote] = useState(false);

  useEffect(() => {
    if (mode !== "search" || q.trim().length < 3) return setFound([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/site/in/search?ticket=${encodeURIComponent(ticket)}&q=${encodeURIComponent(q.trim())}`);
      if (res.ok) setFound(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [mode, q, ticket]);

  const person = (p: Person) => (
    <button key={p.id} onClick={() => onPick({ resourceId: p.id, name: p.name })} className="w-full rounded-xl border border-edge bg-panel px-4 py-3 text-left text-base text-gray-100">
      {p.name}
    </button>
  );

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold text-gray-100">Who are you?</h1>
      <p className="text-sm text-gray-500">{job.label} - only the first time on this phone.</p>
      {mode === "crew" && (
        <>
          {job.crew.map(person)}
          <button className="w-full py-2 text-sm text-brand-300" onClick={() => setMode("search")}>I&apos;m not on this list</button>
          <button className="w-full py-2 text-sm text-brand-300" onClick={() => setMode("hire")}>I&apos;m from a hire company / subcontractor</button>
        </>
      )}
      {mode === "search" && (
        <>
          {staffNote && <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">You&apos;re Lobos staff - pick your name. (Hire is only for workers from another company.)</div>}
          <input className={input} autoFocus placeholder="Type your name" value={q} onChange={(e) => setQ(e.target.value)} />
          {found.map(person)}
          {q.trim().length >= 3 && found.length === 0 && <p className="text-sm text-gray-500">No match. If you&apos;re from a hire company, use the option below.</p>}
          <button className="w-full py-2 text-sm text-brand-300" onClick={() => setMode("hire")}>I&apos;m from a hire company / subcontractor</button>
          {job.crew.length > 0 && <button className="w-full py-2 text-sm text-gray-400" onClick={() => setMode("crew")}>← Back to the list</button>}
        </>
      )}
      {mode === "hire" && (
        <>
          <input className={input} placeholder="Your full name" value={hire.name} onChange={(e) => setHire({ ...hire, name: e.target.value })} />
          {companies.length > 0 && (
            <div className="space-y-2">
              <p className="text-left text-sm text-gray-400">Company you&apos;re from</p>
              {[...companies, OTHER_COMPANY].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={picked === c}
                  onClick={() => setPicked(c)}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-base ${picked === c ? "border-brand-400 bg-brand-600/20 text-gray-100" : "border-edge bg-panel text-gray-200"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {other && (
            <input className={input} autoFocus={companies.length > 0} placeholder={companies.length ? "Type your company's name" : "Company you're from"} value={hire.company} onChange={(e) => setHire({ ...hire, company: e.target.value })} />
          )}
          <button
            className={`${big} bg-brand-600`}
            disabled={hire.name.trim().length < 2 || company.trim().length < 2}
            onClick={() => {
              if (looksLikeLobos(company)) { setStaffNote(true); setQ(hire.name.trim()); setMode("search"); return; }
              onPick({ hire: { name: hire.name.replace(/\s+/g, " ").trim(), company: company.replace(/\s+/g, " ").trim() } });
            }}
          >
            Continue
          </button>
          <button className="w-full py-2 text-sm text-gray-400" onClick={() => setMode(job.crew.length ? "crew" : "search")}>← Back</button>
        </>
      )}
    </div>
  );
}
