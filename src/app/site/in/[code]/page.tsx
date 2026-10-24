"use client";

import { useCallback, useEffect, useState, use } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";

// Crew sign-in: the page a worker's phone opens after scanning the
// supervisor's QR or the site poster. First time they pick their name (or
// say they're from a hire company); their phone remembers them, so after
// that it's one tap. No login - the scan is the key, and the time is the
// server's.

type Person = { id: string; name: string };
type Job = { id: string; label: string; times: string | null; crew: Person[] };
type Scan = { method: "SUPERVISOR_QR" | "POSTER" | "POINT"; ticket: string; jobs: Job[] };
type Me = { resourceId: string; name: string } | { hire: { name: string; company: string } };

const ME_KEY = "lobos-signin-me";
const DEVICE_KEY = "lobos-signin-device";
const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-5 text-lg font-semibold text-white disabled:opacity-50";

function store<T>(key: string, value?: T | null): T | null {
  try {
    if (value === null) localStorage.removeItem(key);
    else if (value !== undefined) localStorage.setItem(key, JSON.stringify(value));
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function deviceId() {
  let id = store<string>(DEVICE_KEY);
  if (!id) id = store(DEVICE_KEY, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  return id ?? "";
}

export default function CrewSignInPage({ params: paramsP }: { params: Promise<{ code: string }> }) {
  const params = use(paramsP);
  const [scan, setScan] = useState<Scan | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<{ signedIn: boolean; since: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

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
    async (action: "STATUS" | "IN" | "OUT", who: Me) => {
      const res = await fetch("/api/site/in/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: scan!.ticket, jobId, action, deviceId: deviceId(), ...who }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      return res.json();
    },
    [scan, jobId]
  );

  // Once we know the job and who they are, ask whether they're in or out.
  useEffect(() => {
    if (!scan || !jobId || !me) return;
    setStatus(null);
    send("STATUS", me).then(setStatus, (e) => setError((e as Error).message));
  }, [scan, jobId, me, send]);

  async function act(action: "IN" | "OUT") {
    setBusy(true);
    setError(null);
    try {
      const r = await send(action, me!);
      setDone(r.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
      ) : done ? (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-emerald-500/15 px-4 py-6 text-lg font-semibold text-emerald-300">✓ {done}</div>
          <p className="text-sm text-gray-500">You can close this page.</p>
        </div>
      ) : !jobId ? (
        <div className="space-y-3">
          <h1 className="text-xl font-semibold text-gray-100">Which job are you on?</h1>
          {scan.jobs.map((j) => (
            <button key={j.id} onClick={() => setJobId(j.id)} className="w-full rounded-2xl border border-edge bg-panel p-4 text-left text-base text-gray-100">
              {j.label} {j.times && <span className="text-sm text-gray-500">· {j.times}</span>}
            </button>
          ))}
        </div>
      ) : !me ? (
        <WhoAreYou job={job!} ticket={scan.ticket} onPick={(m) => setMe(store(ME_KEY, m))} />
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
          ) : (
            <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => act("IN")}>
              {busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
            </button>
          )}
          {scan.method === "POSTER" && <p className="text-center text-xs text-gray-500">Signed in from the site poster - your supervisor confirms it.</p>}
        </div>
      )}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{children}</div>;
}

// First time on this phone: pick your name from the job's crew, find it in
// the register, or say you're from a hire company / subcontractor.
function WhoAreYou({ job, ticket, onPick }: { job: Job; ticket: string; onPick: (m: Me) => void }) {
  // No list (the yard): straight to typing their name.
  const [mode, setMode] = useState<"crew" | "search" | "hire">(job.crew.length ? "crew" : "search");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [hire, setHire] = useState({ name: "", company: "" });

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
          <input className={input} placeholder="Company you're from" value={hire.company} onChange={(e) => setHire({ ...hire, company: e.target.value })} />
          <button
            className={`${big} bg-brand-600`}
            disabled={hire.name.trim().length < 2 || hire.company.trim().length < 2}
            onClick={() => onPick({ hire: { name: hire.name.replace(/\s+/g, " ").trim(), company: hire.company.replace(/\s+/g, " ").trim() } })}
          >
            Continue
          </button>
          <button className="w-full py-2 text-sm text-gray-400" onClick={() => setMode(job.crew.length ? "crew" : "search")}>← Back</button>
        </>
      )}
    </div>
  );
}
