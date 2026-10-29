"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { resizePhoto } from "@/lib/imageResize";
import { serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { CODES, BY_CODE } from "@/lib/activityCodes";
import { DELAY_CODES, DELAY_LABEL, SPLIT_TOLERANCE, type DelayCode } from "@/lib/dailyLog/rules";
import type { LinkLogDTO, LogJobDTO, ProgressFormDTO } from "@/lib/dailyLog/types";
import VoiceNote from "./VoiceNote";

// The daily site log on a pilot supervisor's link (Task K, 25 Oct 2026):
// about 60 seconds at the end of the day. 1) the crew and signed hours (from
// sign-ins - read-only), 2) split those hours across what they worked on,
// 3) anything that held them up, then a note and Submit. Tip dockets come in as
// receipts from whoever has them (Receipts, 26 Oct 2026) - the log shows how
// many were sent for the job. Once
// a week, the same screen asks for % complete. Re-opening a logged day saves a
// new version - the office keeps the earlier ones. No money anywhere here.
// Voice (29 Oct 2026): a "Talk through your day" button at the top (./VoiceNote.tsx) when voice is on - the text and
// any hold-ups it heard are suggestions the supervisor taps to use; Send is unchanged.

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const secondary = "flex w-full items-center justify-center gap-2 rounded-xl border border-edge bg-panel px-4 py-3 text-base font-medium text-gray-200";
const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm ${on ? "border-brand-500 bg-brand-600/30 text-brand-200" : "border-edge bg-panel2 text-gray-300"}`;
const q = (n: number) => Math.round(n * 4) / 4;
const h = (n: number) => `${q(n)} h`; // 8 h, 8.5 h, 8.25 h
const dayLabel = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });

export default function DailyLog({ api, onDone }: { api: string; onDone: (message: string) => void }) {
  const [data, setData] = useState<LinkLogDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [progressFor, setProgressFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${api}/log`);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't load the daily log - check your signal."));
    const d: LinkLogDTO = await res.json();
    setData(d);
    if (d.jobs.length === 1 && !d.jobs[0].latest) setPicked(d.jobs[0].jobId);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-red-300">{error}</p>;
  if (!data) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;

  const job = data.jobs.find((j) => j.jobId === picked);
  if (job) return <LogSteps api={api} job={job} voice={!!data.voice} onBack={() => setPicked(null)} onSaved={(m) => onDone(m)} />;
  const form = data.progress.find((p) => p.projectId === progressFor);
  if (form) return <ProgressStep api={api} form={form} onBack={() => setProgressFor(null)} onSaved={(m) => onDone(m)} />;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-gray-100">Daily log</h2>
      <p className="mb-4 text-sm text-gray-500">About a minute: who worked, what they did and any hold-ups.</p>
      {data.jobs.length === 0 && <p className="mb-4 rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">You&apos;re not on a job to log today.</p>}
      <div className="space-y-3">
        {data.jobs.map((j) => (
          <button key={j.jobId} onClick={() => setPicked(j.jobId)} disabled={j.closed}
            className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-panel p-4 text-left disabled:opacity-60">
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-gray-100">{j.label}</span>
              <span className="block text-sm text-gray-500">{dayLabel(j.date)} · {j.crew.count} signed in · {h(j.crew.hours)}</span>
            </span>
            {j.closed ? <span className="text-xs text-gray-500">Day closed</span>
              : j.latest ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-sm text-emerald-300">Logged {j.latest.atLabel} ✓</span>
              : <span className="rounded-full bg-amber-500 px-2 py-0.5 text-sm font-semibold text-black">Not done</span>}
          </button>
        ))}
      </div>
      {data.progress.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-base font-semibold text-gray-100">Progress this week</h3>
          <div className="space-y-3">
            {data.progress.map((p) => (
              <button key={p.projectId} onClick={() => setProgressFor(p.projectId)} className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-panel p-4 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-gray-100">{p.projectName}</span>
                  <span className="block text-sm text-gray-500">{p.lines.length} {p.basis === "BUDGET" ? "packages" : "codes"} · % complete</span>
                </span>
                {p.savedAt ? <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-sm text-emerald-300">Saved ✓</span>
                  : p.due ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-sm font-semibold text-black">Due</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- the log itself ----------

type Row = { code: string; hours: number };
type PlantRow = { resourceId: string; code: string; hours: number };
type Delay = { delayCode: DelayCode; hoursLost: string; affects: string; note: string; photos: string[] };
type Docket = { code: string; wasteClass: string; quantity: string; unit: string; docketNo: string; photo: string | null };

function LogSteps({ api, job, voice, onBack, onSaved }: { api: string; job: LogJobDTO; voice: boolean; onBack: () => void; onSaved: (m: string) => void }) {
  const started = useRef(Date.now());
  const prev = job.latest;
  const [step, setStep] = useState(0);
  const [crewOk, setCrewOk] = useState(prev ? prev.crewOk : true);
  const [crewNote, setCrewNote] = useState(prev?.crewNote ?? "");
  const [handCrew, setHandCrew] = useState(prev && !prev.crewOk ? String(prev.crewCount) : "");
  const [handHours, setHandHours] = useState(prev && !prev.crewOk ? String(prev.labourHours) : "");
  const [rows, setRows] = useState<Row[]>(prev ? prev.hours.filter((x) => x.kind === "LABOUR").map((x) => ({ code: x.code, hours: x.hours })) : []);
  const [plant, setPlant] = useState<PlantRow[]>(job.plant.map((p) => {
    const before = prev?.hours.find((x) => x.resourceId === p.resourceId);
    return { resourceId: p.resourceId, code: before?.code ?? "", hours: before?.hours ?? p.defaultHours ?? 0 };
  }));
  const [delays, setDelays] = useState<Delay[]>(prev ? prev.delays.map((d) => ({ delayCode: d.delayCode as DelayCode, hoursLost: d.hoursLost == null ? "" : String(d.hoursLost), affects: d.affects, note: d.note ?? "", photos: d.photos })) : []);
  const [noDelays, setNoDelays] = useState(prev ? prev.noDelays : false);
  // Dockets from an older log (before receipts) are kept as they were when it's corrected.
  const dockets: Docket[] = prev ? prev.dockets.map((d) => ({ code: d.code, wasteClass: d.wasteClass, quantity: String(d.quantity), unit: d.unit, docketNo: d.docketNo ?? "", photo: d.photo })) : [];
  const noDockets = dockets.length === 0;
  const [note, setNote] = useState(prev?.note ?? "");
  const [photos, setPhotos] = useState<string[]>(prev?.photos ?? []);
  const [voiceIds, setVoiceIds] = useState<string[]>([]); // the recordings whose text was used (the server keeps the transcripts)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signed = job.crew.hours;
  const target = crewOk || !handHours.trim() ? signed : Number(handHours) || 0;
  const placed = q(rows.reduce((s, r) => s + r.hours, 0));
  const left = q(target - placed);
  const fits = Math.abs(left) <= SPLIT_TOLERANCE && placed > 0;
  // A machine with no code yet goes on the biggest labour code.
  const biggest = [...rows].sort((a, b) => b.hours - a.hours)[0]?.code ?? "";

  const add = (code: string) => { if (!rows.some((r) => r.code === code)) setRows([...rows, { code, hours: Math.max(0, left) }]); };
  const set = (code: string, hours: number) => setRows(rows.map((r) => (r.code === code ? { ...r, hours: Math.max(0, q(hours)) } : r)));
  const evenly = () => { if (!rows.length) return; const each = q(target / rows.length); setRows(rows.map((r, i) => ({ ...r, hours: i === rows.length - 1 ? q(target - each * (rows.length - 1)) : each }))); };

  async function submit() {
    setBusy(true); setError(null);
    const body = {
      jobId: job.jobId, crewOk, crewNote, handCrew: crewOk ? undefined : Number(handCrew), handHours: crewOk ? undefined : handHours,
      hours: rows.filter((r) => r.hours > 0), plant: plant.map((p) => ({ ...p, code: p.code || biggest })),
      noDelays, delays: noDelays ? [] : delays, noDockets, dockets: noDockets ? [] : dockets,
      note, photos, voiceIds, durationSec: Math.round((Date.now() - started.current) / 1000),
    };
    const res = await fetch(`${api}/log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setError(res ? await serverErrorMessage(res, "Couldn't send - try again.") : "Couldn't send - check your signal and try again.");
    const { log } = await res.json();
    onSaved(`Daily log saved for ${job.label}${log.revision > 1 ? ` (version ${log.revision})` : ""}`);
  }

  const steps = ["Who and how long", "What did the crew do?", "Anything hold you up?", "", "Done?"];
  const docketsText = job.docketsSent ? `${job.docketsSent} tip docket${job.docketsSent === 1 ? "" : "s"} sent today` : "no tip dockets sent yet";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-100">{steps[step]}</h2>
        <span className="text-xs text-gray-500">{step < 3 ? `Step ${step + 1} of 3` : "Review"}</span>
      </div>
      <p className="mb-4 text-sm text-gray-500">{job.label} · {dayLabel(job.date)}{prev ? ` · correcting the ${prev.atLabel} log (saves version ${prev.revision + 1})` : ""}</p>
      {voice && (
        <VoiceNote
          api={api} jobId={job.jobId}
          onUseNote={(text, id) => { setNote(text); setVoiceIds((v) => (v.includes(id) ? v : [...v, id])); }}
          onAddDelay={(d) => { setNoDelays(false); setDelays((xs) => [...xs, { delayCode: d.delayCode, hoursLost: d.hoursLost == null ? "" : String(d.hoursLost), affects: "CREW", note: d.note, photos: [] }]); }}
        />
      )}

      {step === 0 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-edge bg-panel p-4">
            <div className="flex items-baseline justify-between"><span className="text-sm text-gray-400">Crew today (signed in)</span><span className="text-lg font-semibold text-gray-100">{job.crew.count} · {h(signed)}</span></div>
            <div className="mt-1 text-sm text-gray-500">Staff {job.crew.staff} ({h(job.crew.staffHours)}), labour hire {job.crew.hire} ({h(job.crew.hireHours)})</div>
            {job.crew.people.filter((p) => p.stillOn).length > 0 && (
              <div className="mt-2 text-sm text-amber-300">Still signed in: {job.crew.people.filter((p) => p.stillOn).map((p) => `${p.name} (since ${p.in})`).join(", ")} - counted up to now</div>
            )}
            {job.plant.length > 0 && <div className="mt-2 text-sm text-gray-500">Plant on the board: {job.plant.map((p) => p.name).join(", ")}</div>}
            {job.crew.people.length > 0 && (
              <details className="mt-2 text-sm text-gray-400"><summary>Everyone ({job.crew.people.length})</summary>
                <ul className="mt-1 space-y-0.5">{job.crew.people.map((p, i) => <li key={i}>{p.name}{p.company ? ` (${p.company})` : ""} · {p.in}-{p.out ?? "now"} · {h(p.hours)}</li>)}</ul>
              </details>
            )}
          </div>
          {crewOk ? (
            <>
              {signed > 0 ? <button className={primary} onClick={() => setStep(1)}>Looks right →</button>
                : <p className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">Nobody signed in on this job. Tap below and enter the crew hours by hand.</p>}
              <button className={secondary} onClick={() => setCrewOk(false)}>Something&apos;s wrong</button>
            </>
          ) : (
            <div className="space-y-3 rounded-xl border border-amber-500/40 bg-panel p-4">
              <label className="block"><span className="mb-1 block text-sm text-gray-300">What&apos;s wrong? (goes to the office)</span>
                <textarea className={input} rows={2} value={crewNote} onChange={(e) => setCrewNote(e.target.value)} placeholder="e.g. Sam forgot to sign in, worked 7-3:30" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-sm text-gray-300">Crew</span><input className={input} inputMode="numeric" value={handCrew} onChange={(e) => setHandCrew(e.target.value)} placeholder={String(job.crew.count || "")} /></label>
                <label className="block"><span className="mb-1 block text-sm text-gray-300">Total hours</span><input className={input} inputMode="decimal" value={handHours} onChange={(e) => setHandHours(e.target.value)} placeholder={signed ? String(signed) : ""} /></label>
              </div>
              <p className="text-xs text-gray-500">{signed > 0 ? "Leave crew and hours blank to keep the signed-in hours." : "Needed - nobody signed in."}</p>
              <button className={primary} disabled={!crewNote.trim() || (signed <= 0 && !(Number(handHours) > 0 && Number(handCrew) > 0))}
                onClick={() => { if (!handHours.trim()) { setHandCrew(""); } setStep(1); }}>Next →</button>
              <button className="w-full text-sm text-gray-400" onClick={() => { setCrewOk(true); setHandCrew(""); setHandHours(""); }}>Cancel - the list is right</button>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.code} className="flex items-center gap-2 rounded-xl border border-edge bg-panel p-2">
                <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-gray-100">{r.code}</div><div className="truncate text-xs text-gray-500">{BY_CODE[r.code]?.name}</div></div>
                <button className="rounded-lg bg-panel2 p-2" aria-label="Less" onClick={() => set(r.code, r.hours - 0.5)}><Minus size={16} /></button>
                <input className="w-16 rounded-lg border border-edge bg-panel2 px-2 py-2 text-center text-base text-gray-100" inputMode="decimal" value={r.hours} onChange={(e) => set(r.code, Number(e.target.value) || 0)} />
                <button className="rounded-lg bg-panel2 p-2" aria-label="More" onClick={() => set(r.code, r.hours + 0.5)}><Plus size={16} /></button>
                <button className="p-1 text-gray-500" aria-label="Remove" onClick={() => setRows(rows.filter((x) => x.code !== r.code))}><X size={16} /></button>
              </div>
            ))}
          </div>
          <div className={`rounded-xl px-4 py-2 text-sm ${fits ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
            {fits ? `All ${h(target)} placed ✓` : left > 0 ? `Left to place: ${h(left)} of ${h(target)}` : `${h(-left)} too many (crew ${h(target)})`}
          </div>
          <CodePicker suggested={job.suggested} taken={rows.map((r) => r.code)} onPick={add} />
          {rows.length > 1 && <button className="text-sm text-brand-300 underline" onClick={evenly}>Split evenly</button>}
          {plant.length > 0 && (
            <div className="rounded-xl border border-edge bg-panel p-3">
              <div className="mb-2 text-sm font-semibold text-gray-100">Plant</div>
              {plant.map((p, i) => {
                const m = job.plant.find((x) => x.resourceId === p.resourceId)!;
                return (
                  <div key={p.resourceId} className="mb-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{m.name}</span>
                    <select className="rounded-lg border border-edge bg-panel2 px-2 py-2 text-sm text-gray-200" value={p.code || biggest}
                      onChange={(e) => setPlant(plant.map((x, k) => (k === i ? { ...x, code: e.target.value } : x)))}>
                      {[...new Set([...rows.map((r) => r.code), p.code].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className="w-16 rounded-lg border border-edge bg-panel2 px-2 py-2 text-center text-sm text-gray-100" inputMode="decimal" value={p.hours}
                      onChange={(e) => setPlant(plant.map((x, k) => (k === i ? { ...x, hours: Number(e.target.value) || 0 } : x)))} />
                    <span className="text-xs text-gray-500">h</span>
                  </div>
                );
              })}
              <p className="text-xs text-gray-500">0 h = didn&apos;t work today.</p>
            </div>
          )}
          <button className={primary} disabled={!fits} onClick={() => setStep(2)}>Next →</button>
          <button className="w-full text-sm text-gray-400" onClick={() => setStep(0)}>← Back</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className={chip(noDelays && delays.length === 0)} onClick={() => { setNoDelays(true); setDelays([]); setStep(4); }}>No</button>
            {DELAY_CODES.map((c) => (
              <button key={c} className={chip(false)} onClick={() => { setNoDelays(false); setDelays([...delays, { delayCode: c, hoursLost: "", affects: "CREW", note: "", photos: [] }]); }}>{DELAY_LABEL[c]}</button>
            ))}
          </div>
          {delays.map((d, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-edge bg-panel p-3">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-100">{DELAY_LABEL[d.delayCode]}</span>
                <button className="p-1 text-gray-500" aria-label="Remove" onClick={() => setDelays(delays.filter((_, k) => k !== i))}><X size={16} /></button></div>
              <div className="grid grid-cols-2 gap-2">
                <input className={input} inputMode="decimal" placeholder="Hours lost" value={d.hoursLost} onChange={(e) => setDelays(delays.map((x, k) => (k === i ? { ...x, hoursLost: e.target.value } : x)))} />
                <select className={input} value={d.affects} onChange={(e) => setDelays(delays.map((x, k) => (k === i ? { ...x, affects: e.target.value } : x)))}>
                  <option value="CREW">Crew</option><option value="PLANT">Plant</option><option value="BOTH">Crew and plant</option>
                </select>
              </div>
              <input className={input} placeholder={d.delayCode === "OTHER" ? "What held you up? (needed)" : "Note (optional)"} value={d.note} onChange={(e) => setDelays(delays.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
              <Photos photos={d.photos} max={4} onChange={(ps) => setDelays(delays.map((x, k) => (k === i ? { ...x, photos: ps } : x)))} />
            </div>
          ))}
          {delays.length > 0 && <button className={primary} onClick={() => { setNoDelays(false); setStep(4); }}>Next →</button>}
          <button className="w-full text-sm text-gray-400" onClick={() => setStep(1)}>← Back</button>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-edge bg-panel p-3 text-sm text-gray-300">
            <div>{crewOk ? `${job.crew.count} crew · ${h(signed)}` : `Crew by hand${handHours ? `: ${handCrew} · ${h(Number(handHours))}` : ""}`}</div>
            <div className="text-gray-400">{rows.map((r) => `${r.code} ${h(r.hours)}`).join(" · ")}</div>
            <div className="text-gray-400">{noDelays || !delays.length ? "No delays" : delays.map((d) => DELAY_LABEL[d.delayCode]).join(", ")} · {docketsText}{dockets.length ? ` (${dockets.length} on the earlier log)` : ""}</div>
          </div>
          <label className="block"><span className="mb-1 block text-sm text-gray-300">Note for the office (optional)</span>
            <textarea className={input} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <Photos photos={photos} max={4} label="Add photos of the day" onChange={setPhotos} />
          {error && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p>}
          <button className={primary} disabled={busy} onClick={submit}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Submit</button>
          <button className="w-full text-sm text-gray-400" onClick={() => setStep(2)}>← Back</button>
        </div>
      )}
      {step === 0 && <button className="mt-4 w-full text-sm text-gray-400" onClick={onBack}>← All jobs</button>}
    </div>
  );
}

function CodePicker({ suggested, taken, onPick }: { suggested: LogJobDTO["suggested"]; taken: string[]; onPick: (code: string) => void }) {
  const [search, setSearch] = useState<string | null>(null);
  const found = useMemo(() => {
    const t = (search ?? "").trim().toLowerCase();
    return t ? CODES.filter((c) => c.code.toLowerCase().includes(t) || c.name.toLowerCase().includes(t)).slice(0, 12) : [];
  }, [search]);
  const free = suggested.filter((s) => !taken.includes(s.code));
  return (
    <div>
      {free.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{free.map((s) => <button key={s.code} className={chip(false)} onClick={() => onPick(s.code)}>{s.code} {s.name.split(" (")[0].slice(0, 28)}</button>)}</div>}
      {search == null ? (
        <button className="text-sm text-brand-300 underline" onClick={() => setSearch("")}>+ another code</button>
      ) : (
        <div className="rounded-xl border border-edge bg-panel p-2">
          <div className="flex items-center gap-2"><Search size={16} className="text-gray-500" />
            <input autoFocus className="w-full bg-transparent py-2 text-base text-gray-200 outline-none" placeholder="e.g. ceiling, STR-02, slab" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="p-1 text-gray-500" aria-label="Close" onClick={() => setSearch(null)}><X size={16} /></button></div>
          {found.filter((c) => !taken.includes(c.code)).map((c) => (
            <button key={c.code} className="block w-full rounded-lg px-2 py-2 text-left text-sm text-gray-200 hover:bg-panel2" onClick={() => { onPick(c.code); setSearch(null); }}>
              <span className="font-semibold">{c.code}</span> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Photos({ photos, max, label = "Add a photo (optional)", onChange }: { photos: string[]; max: number; label?: string; onChange: (p: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    try { onChange([...photos, await resizePhoto(f)].slice(0, max)); setError(null); } catch { setError("Couldn't use that photo - try another."); }
  }
  return (
    <div>
      {photos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <span key={i} className="relative">
              {p.startsWith("data:") ? <img src={p} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-panel2 text-xs text-gray-400">kept</span>}
              <button className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-white" aria-label="Remove photo" onClick={() => onChange(photos.filter((_, k) => k !== i))}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {photos.length < max && (
        <button className="flex items-center gap-2 text-sm text-gray-300 underline" onClick={() => ref.current?.click()}><Camera size={16} /> {label}</button>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

// ---------- weekly % complete ----------

function ProgressStep({ api, form, onBack, onSaved }: { api: string; form: ProgressFormDTO; onBack: () => void; onSaved: (m: string) => void }) {
  const [vals, setVals] = useState(form.lines.map((l) => ({ ...l, pct: l.thisWeek ?? l.last ?? 0, reason: "" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = vals.some((v) => v.last != null && v.pct < v.last && !v.reason.trim());
  async function save() {
    setBusy(true); setError(null);
    const res = await fetch(`${api}/progress`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: form.projectId, lines: vals.map((v) => ({ packageId: v.packageId, code: v.code, pct: v.pct, reason: v.reason || undefined })) }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setError(res ? await serverErrorMessage(res, "Couldn't save - try again.") : "Couldn't save - check your signal and try again.");
    onSaved(`Progress saved for ${form.projectName}`);
  }
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-100">Progress this week</h2>
      <p className="text-sm text-gray-500">{form.projectName} · how complete is each {form.basis === "BUDGET" ? "package" : "part of the job"}?{form.budgetUnavailable ? " (the job's packages can't be loaded right now - codes shown instead)" : ""}</p>
      {vals.map((v, i) => (
        <div key={`${v.packageId}-${v.code}`} className="rounded-xl border border-edge bg-panel p-3">
          <div className="flex items-baseline justify-between gap-2"><span className="text-sm text-gray-200">{v.label}</span><span className="text-lg font-semibold text-gray-100">{v.pct}%</span></div>
          <input type="range" min={0} max={100} step={5} value={v.pct} className="mt-2 w-full" onChange={(e) => setVals(vals.map((x, k) => (k === i ? { ...x, pct: Number(e.target.value) } : x)))} />
          {v.last != null && <div className="text-xs text-gray-500">Last week {v.last}%</div>}
          {v.last != null && v.pct < v.last && (
            <input className={`${input} mt-2`} placeholder="Why lower? (e.g. rework, scope change)" value={v.reason} onChange={(e) => setVals(vals.map((x, k) => (k === i ? { ...x, reason: e.target.value } : x)))} />
          )}
        </div>
      ))}
      {error && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p>}
      <button className={primary} disabled={busy || needsReason} onClick={save}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Save progress</button>
      <button className="w-full text-sm text-gray-400" onClick={onBack}>← Back</button>
    </div>
  );
}
