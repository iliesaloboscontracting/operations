"use client";

import { useEffect, useState, use } from "react";
import SiteBrand from "@/components/site/SiteBrand";
import PrestartCheck, { type PrestartResult } from "@/components/site/PrestartCheck";
import { ClipboardCheck, Loader2, Moon, Sun } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { deviceId, ME_KEY, store } from "@/lib/signinDevice";
import { looksLikeLobos } from "@/lib/staffMatch";

// A machine's pre-start QR sticker (stage 2, Ilies 10 Nov 2026) - Lobos-owned plant. NOT a sign-in: crew still sign
// in on site as normal. Scan, pick your name (the phone remembers it, as sign-in does), then Start of shift
// (pre-start) or End of shift (post-check), then the same check screen as the trucks: the checklist, faults with
// photos, the walk-around on the machine's first pre-start of the day, and the hour meter (photo + hours) every time.

type Person = { id: string; name: string };
type Scan = { ticket: string; machine: string; crew: Person[] };
type Me = { resourceId: string; name: string } | { hire: { name: string; company: string } };

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-5 text-lg font-semibold text-white disabled:opacity-50";

export default function PlantPrestartPage({ params: paramsP }: { params: Promise<{ code: string }> }) {
  const params = use(paramsP);
  const [scan, setScan] = useState<Scan | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PrestartResult | "skipped" | null>(null);

  useEffect(() => {
    setMe(store<Me>(ME_KEY));
    fetch(`/api/site/plant/${encodeURIComponent(params.code)}`).then(async (res) => {
      if (!res.ok) return setDead(await serverErrorMessage(res, "That QR isn't working - scan it again."));
      setScan(await res.json());
    }, () => setDead("That QR isn't working - check your signal and scan it again."));
  }, [params.code]);

  async function start(kind: "PRE" | "POST") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/site/plant/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: scan!.ticket, kind, deviceId: deviceId(), ...me }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't start - check your signal and try again."));
      setToken((await res.json()).token);
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
        <span className="text-sm text-gray-400">Plant pre-start</span>
      </div>
      {dead ? (
        <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{dead}</div>
      ) : !scan ? (
        <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : done ? (
        <div className="space-y-4 text-center">
          <div className="rounded-2xl bg-emerald-500/15 px-4 py-6 text-lg font-semibold text-emerald-300">
            {done === "skipped" ? "No problem - do it next time." : `✓ ${done.message}`}
          </div>
          {done !== "skipped" && done.sent.length > 0 && (
            <div className="rounded-xl border border-edge bg-panel p-3 text-left text-sm text-gray-300">
              <div className="mb-1 font-semibold text-gray-100">Sent to the office:</div>
              {done.sent.map((f, i) => <div key={i}>• {f.itemLabel} - {f.priority}{f.markedDown ? " (marked Down)" : ""}</div>)}
            </div>
          )}
          <p className="text-sm text-gray-500">You can close this page. This isn&apos;t a sign-in - sign in on site as usual.</p>
        </div>
      ) : token ? (
        <PrestartCheck token={token} banner={scan.machine} onDone={(r) => setDone(r)} onSkip={() => setDone("skipped")} />
      ) : !me ? (
        <WhoAreYou scan={scan} onPick={(m) => setMe(store(ME_KEY, m))} />
      ) : (
        <div className="space-y-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-100"><ClipboardCheck size={22} /> {scan.machine}</h1>
            <p className="text-sm text-gray-500">Pre-start check - not a sign-in. Sign in on site as usual.</p>
          </div>
          <div className="rounded-2xl border border-edge bg-panel p-4">
            <div className="text-sm text-gray-500">Checking as</div>
            <div className="text-lg font-semibold text-gray-100">{"hire" in me ? `${me.hire.name} (${me.hire.company})` : me.name}</div>
            <button className="mt-1 text-sm text-gray-400 underline" onClick={() => setMe(store<Me>(ME_KEY, null))}>Not you?</button>
          </div>
          {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
          <button className={`${big} bg-brand-600`} disabled={busy} onClick={() => start("PRE")}>
            {busy ? <Loader2 className="animate-spin" /> : <Sun />} Start of shift – pre-start
          </button>
          <button className={`${big} bg-amber-600`} disabled={busy} onClick={() => start("POST")}>
            {busy ? <Loader2 className="animate-spin" /> : <Moon />} End of shift – post-check
          </button>
        </div>
      )}
    </div>
  );
}

// First time on this phone: pick your name (operators first), find it, or say you're from a hire company.
function WhoAreYou({ scan, onPick }: { scan: Scan; onPick: (m: Me) => void }) {
  const [mode, setMode] = useState<"crew" | "search" | "hire">(scan.crew.length ? "crew" : "search");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [hire, setHire] = useState({ name: "", company: "" });
  const [staffNote, setStaffNote] = useState(false);

  useEffect(() => {
    if (mode !== "search" || q.trim().length < 3) return setFound([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/site/plant/search?ticket=${encodeURIComponent(scan.ticket)}&q=${encodeURIComponent(q.trim())}`);
      if (res.ok) setFound(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [mode, q, scan.ticket]);

  const person = (p: Person) => (
    <button key={p.id} onClick={() => onPick({ resourceId: p.id, name: p.name })} className="w-full rounded-xl border border-edge bg-panel px-4 py-3 text-left text-base text-gray-100">
      {p.name}
    </button>
  );
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold text-gray-100">Who are you?</h1>
      <p className="text-sm text-gray-500">{scan.machine} - only the first time on this phone.</p>
      {mode === "crew" && (
        <>
          {scan.crew.map(person)}
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
          {scan.crew.length > 0 && <button className="w-full py-2 text-sm text-gray-400" onClick={() => setMode("crew")}>← Back to the list</button>}
        </>
      )}
      {mode === "hire" && (
        <>
          <input className={input} placeholder="Your full name" value={hire.name} onChange={(e) => setHire({ ...hire, name: e.target.value })} />
          <input className={input} placeholder="Company you're from" value={hire.company} onChange={(e) => setHire({ ...hire, company: e.target.value })} />
          <button className={`${big} bg-brand-600`} disabled={hire.name.trim().length < 2 || hire.company.trim().length < 2}
            onClick={() => {
              if (looksLikeLobos(hire.company)) { setStaffNote(true); setQ(hire.name.trim()); setMode("search"); return; }
              onPick({ hire: { name: hire.name.replace(/\s+/g, " ").trim(), company: hire.company.replace(/\s+/g, " ").trim() } });
            }}>
            Continue
          </button>
          <button className="w-full py-2 text-sm text-gray-400" onClick={() => setMode(scan.crew.length ? "crew" : "search")}>← Back</button>
        </>
      )}
    </div>
  );
}
