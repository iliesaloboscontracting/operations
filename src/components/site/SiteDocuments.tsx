"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Check, ChevronLeft, ClipboardCheck, FileText, HardHat, Image as ImageIcon, Loader2, Megaphone, Truck } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { CrewPicker, SignOnPanel, card, h2, primary, secondary } from "./CrewSignOn";
import { MeetingForm, SentRecord } from "./MeetingForm";
import IncidentForm from "./IncidentForm";
import { typeLabel } from "@/lib/siteDocs/rules";
import type { LinkJobDTO, LinkRecordDTO, LinkViewDTO } from "@/lib/siteDocs/store";

// Site documents on the supervisor's link (Ilies approved 25 Nov 2026): plans & drawings (read only), the SWMS with crew
// sign-on, the daily pre-start meeting, the weekly toolbox talk, the incident report, and today's truck & plant
// pre-starts on the job. Crew never open anything themselves - they sign on this phone. Mobile-first: one column, big
// tap targets, plain words. No prices anywhere.

type Mode = "home" | "plans" | "swms" | "prestart" | "toolbox" | "record" | "incident" | "checks";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

function Tile({ icon, title, text, onClick, tone }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; tone?: "ok" | "due" | "red" }) {
  const ring = tone === "red" ? "border-red-500/60" : tone === "due" ? "border-amber-500/60" : "border-edge";
  const txt = tone === "ok" ? "text-emerald-300" : tone === "due" ? "text-amber-300" : "text-gray-400";
  return (
    <button onClick={onClick} className={`flex min-h-[4.5rem] w-full items-center gap-4 rounded-2xl border ${ring} bg-panel px-4 py-3 text-left active:bg-panel2`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300">{icon}</span>
      <span className="min-w-0"><span className="block text-base font-semibold text-gray-100">{title}</span><span className={`block text-sm ${txt}`}>{text}</span></span>
    </button>
  );
}

export default function SiteDocumentsScreen({ api, onHome }: { api: string; onHome: () => void }) {
  const [view, setView] = useState<LinkViewDTO | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("home");
  const [rec, setRec] = useState<LinkRecordDTO | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`${api}/documents`).catch(() => null);
    if (!r || !r.ok) return setDead(r ? await serverErrorMessage(r, "Site documents aren't available on this link.") : "No signal - try again.");
    const v = (await r.json()) as LinkViewDTO;
    setView(v);
    setJobId((j) => (v.jobs.some((x) => x.id === j) ? j : v.jobs[0]?.id ?? ""));
  }, [api]);
  useEffect(() => { load(); }, [load]);
  const go = (m: Mode) => { setFlash(null); setMode(m); window.scrollTo(0, 0); };

  if (dead) return <div className={`${card} text-center text-sm text-gray-300`}>{dead}</div>;
  if (!view) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;
  const job = view.jobs.find((j) => j.id === jobId) ?? null;

  if (job && mode === "plans") return <Plans api={api} job={job} onBack={() => go("home")} />;
  if (job && mode === "swms") return <Swms api={api} job={job} onBack={() => go("home")} onChanged={load} />;
  if (job && mode === "checks") return <Checks api={api} job={job} onBack={() => go("home")} />;
  if (job && (mode === "prestart" || mode === "toolbox")) {
    return <MeetingForm api={api} view={view} job={job} kind={mode === "toolbox" ? "TOOLBOX" : "PRESTART"} onCancel={() => go("home")}
      onSent={(r) => { setRec(r); setMode("record"); setFlash(`${r.label} sent - the office has it.`); window.scrollTo(0, 0); load(); }} />;
  }
  if (job && mode === "record" && rec) {
    return (
      <div className="space-y-3">
        {flash && <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
        <SentRecord api={api} job={job} rec={rec} onBack={() => { go("home"); load(); }} onChanged={(r) => { setRec(r); load(); }} />
      </div>
    );
  }
  if (job && mode === "incident") {
    return <IncidentForm api={api} view={view} job={job} onCancel={() => go("home")} onSent={(n) => { setMode("home"); setFlash(`Sent - ${n.number}. The owner has been told.`); window.scrollTo(0, 0); load(); }} />;
  }

  const prestartText = job ? (job.prestarts.length ? `Done today ✓ (${job.prestarts.length}) - tap to add late arrivals or do another` : "Not done today") : "";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Site documents</h1>
      {flash && <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
      {view.jobs.length === 0 ? (
        <div className={`${card} text-sm text-gray-300`}>You&apos;re not on a job today, so there&apos;s nothing here. If that&apos;s wrong, call the office.</div>
      ) : (
        <>
          {view.jobs.length > 1 && (
            <select className="w-full rounded-xl border border-edge bg-panel2 px-3 py-3 text-base text-gray-200" value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Job">
              {view.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
          )}
          {job && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">{job.label}{job.jobNo ? ` · ${job.jobNo}` : ""} · {job.crew.length} signed in</p>
              <Tile icon={<ImageIcon size={22} />} title="Plans & drawings" text={job.plans.length ? `${job.plans.length} from the office` : "None from the office yet"} onClick={() => go("plans")} />
              <Tile icon={<FileText size={22} />} title="SWMS" tone={job.swms ? (job.crew.some((c) => !c.swmsSigned) || !job.swms.supervisorSigned ? "due" : "ok") : undefined}
                text={!job.swms ? (job.hasProject ? "No SWMS from the office yet" : "This job has no project") : job.crew.some((c) => !c.swmsSigned) ? `${job.crew.filter((c) => !c.swmsSigned).length} on site today haven't signed v${job.swms.version}` : `Everyone on site has signed v${job.swms.version} ✓`}
                onClick={() => go("swms")} />
              <Tile icon={<ClipboardCheck size={22} />} title="Pre-start meeting" tone={job.prestarts.length ? "ok" : "due"} text={prestartText}
                onClick={() => { if (job.prestarts.length) { setRec(job.prestarts[job.prestarts.length - 1]); go("record"); } else go("prestart"); }} />
              {job.prestarts.length > 0 && <button className="-mt-1 w-full text-right text-sm text-brand-300" onClick={() => go("prestart")}>+ Pre-start {job.prestarts.length + 1}</button>}
              <Tile icon={<Megaphone size={22} />} title="Toolbox talk" tone={job.toolboxDone ? "ok" : "due"}
                text={job.toolboxDone ? "Toolbox talk done this week ✓" : view.topic ? `Due this week - topic: ${view.topic.title}` : "Due this week"}
                onClick={() => { if (job.toolboxes.length) { setRec(job.toolboxes[job.toolboxes.length - 1]); go("record"); } else go("toolbox"); }} />
              {job.toolboxDone && <button className="-mt-1 w-full text-right text-sm text-brand-300" onClick={() => go("toolbox")}>+ Another toolbox talk</button>}
              <Tile icon={<AlertTriangle size={22} />} title="Incident report" tone="red" text="Injury, near miss, hazard, damage - straight to the owner" onClick={() => go("incident")} />
              <Tile icon={<Truck size={22} />} title="Truck & plant pre-starts" text="Today's checks on this job's trucks and machines" onClick={() => go("checks")} />
            </div>
          )}
          {view.incidents.length > 0 && (
            <section className={card}>
              <h2 className={h2}>Incident reports sent from this link</h2>
              <ul className="space-y-1 text-sm text-gray-300">{view.incidents.map((i) => <li key={i.number}>Sent - {i.number} · {day(i.day)} · {typeLabel(i.type)}</li>)}</ul>
            </section>
          )}
        </>
      )}
      <button className={secondary} onClick={onHome}><ChevronLeft size={18} /> Back to the site page</button>
    </div>
  );
}

function Plans({ api, job, onBack }: { api: string; job: LinkJobDTO; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back</button>
      <h1 className="text-xl font-semibold text-gray-100">Plans & drawings</h1>
      <p className="text-sm text-gray-400">{job.projectName} - from the office, read only.</p>
      {job.plans.length === 0 ? <div className={`${card} text-sm text-gray-400`}>None yet - ask the office to add them.</div> : (
        <div className="space-y-2">
          {job.plans.map((p) => (
            <a key={p.id} href={`${api}/documents/files/${p.id}`} target="_blank" rel="noreferrer" className="flex min-h-[3.5rem] items-center gap-3 rounded-xl border border-edge bg-panel px-4 py-3 active:bg-panel2">
              {p.kind === "pdf" ? <FileText size={20} className="shrink-0 text-brand-300" /> : <ImageIcon size={20} className="shrink-0 text-brand-300" />}
              <span className="text-base text-gray-100">{p.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Swms({ api, job, onBack, onChanged }: { api: string; job: LinkJobDTO; onBack: () => void; onChanged: () => void }) {
  const [signing, setSigning] = useState<{ id: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const sw = job.swms;
  const open = sw ? `${api}/documents/files/${sw.id}` : "";
  if (sw && signing) {
    return (
      <SignOnPanel who={signing.name} tickText="I've read and understand this SWMS." busy={busy} error={error} onCancel={() => { setSigning(null); setError(null); }}
        onSave={async (png) => {
          setBusy(true); setError(null);
          const body = { jobId: job.id, fileId: sw.id, ...(signing.id ? { attendanceId: signing.id } : { supervisor: true }), understood: true, signature: png };
          const r = await fetch(`${api}/documents/swms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
          setBusy(false);
          if (!r) return setError("Couldn't save - no signal? Try again.");
          if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save - try again."));
          setFlash(`${signing.name} signed v${sw.version}.`);
          setSigning(null);
          onChanged();
        }}>
        <div className={card}>
          <p className="text-sm text-gray-400">SWMS v{sw.version}</p>
          <p className="text-base font-semibold text-gray-100">{sw.title}</p>
          <a href={open} target="_blank" rel="noreferrer" className={`${secondary} mt-3`}><BookOpen size={18} /> Read the SWMS</a>
        </div>
      </SignOnPanel>
    );
  }
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back</button>
      <h1 className="text-xl font-semibold text-gray-100">SWMS</h1>
      {!sw ? <div className={`${card} text-sm text-gray-400`}>{job.hasProject ? "The office hasn't added a SWMS for this job yet." : "This job has no project, so it has no SWMS."}</div> : (
        <>
          {flash && <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
          <div className={card}>
            <p className="text-sm text-gray-400">Current version - v{sw.version}</p>
            <p className="text-base font-semibold text-gray-100">{sw.title}</p>
            <a href={open} target="_blank" rel="noreferrer" className={`${primary} mt-3`}><BookOpen size={18} /> Open the SWMS</a>
            <p className="mt-2 text-xs text-gray-500">Read only. A new version from the office needs everyone to sign again.</p>
          </div>
          <section className={card}>
            <h2 className={`${h2} flex items-center gap-2`}><HardHat size={18} /> Crew sign on</h2>
            <p className="mb-2 text-sm text-gray-400">Each person taps their name, reads the SWMS, ticks and signs. Only people signed in on this job today are listed.</p>
            <CrewPicker crew={job.crew} done={new Set(job.crew.filter((c) => c.swmsSigned).map((c) => c.id))} onPick={(c) => { setFlash(null); setSigning({ id: c.id, name: c.name }); window.scrollTo(0, 0); }} />
          </section>
          <section className={card}>
            <h2 className={h2}>Supervisor</h2>
            {sw.supervisorSigned ? <p className="flex items-center gap-2 text-sm text-emerald-300"><Check size={18} /> You&apos;ve signed v{sw.version}</p>
              : <button className={primary} onClick={() => { setFlash(null); setSigning({ id: null, name: "You (supervisor)" }); window.scrollTo(0, 0); }}>Sign as the supervisor</button>}
          </section>
        </>
      )}
    </div>
  );
}

type Machine = { machine: string; truck: boolean; pre: { by: string; at: string | null; faults: number } | null; post: { by: string; at: string | null; faults: number } | null };
function Checks({ api, job, onBack }: { api: string; job: LinkJobDTO; onBack: () => void }) {
  const [rows, setRows] = useState<Machine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${api}/documents/checks?jobId=${encodeURIComponent(job.id)}`).then(async (r) => (r.ok ? setRows((await r.json()).machines) : setError(await serverErrorMessage(r, "Couldn't load the checks.")))).catch(() => setError("No signal - try again."));
  }, [api, job.id]);
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back</button>
      <h1 className="text-xl font-semibold text-gray-100">Truck & plant pre-starts</h1>
      <p className="text-sm text-gray-400">The trucks and Lobos machines on this job today, from their QR pre-starts. Read only.</p>
      {error && <div className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {!rows ? <div className="py-8 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div> : rows.length === 0 ? <div className={`${card} text-sm text-gray-400`}>No trucks or Lobos machines are booked on this job today.</div> : (
        <div className="space-y-2">
          {rows.map((m, i) => (
            <div key={i} className={`${card} ${m.pre ? "" : "border-amber-500/50"}`}>
              <p className="font-semibold text-gray-100">{m.machine}</p>
              <p className={`text-sm ${m.pre ? (m.pre.faults ? "text-amber-300" : "text-emerald-300") : "text-amber-300"}`}>
                {m.pre ? `Pre-start ✓ ${m.pre.by}${m.pre.at ? ` at ${m.pre.at}` : ""}${m.pre.faults ? ` · ${m.pre.faults} fault${m.pre.faults === 1 ? "" : "s"}` : ""}` : "No pre-start yet"}
              </p>
              {m.post && <p className="text-sm text-gray-400">Post-check ✓ {m.post.by}{m.post.at ? ` at ${m.post.at}` : ""}{m.post.faults ? ` · ${m.post.faults} fault${m.post.faults === 1 ? "" : "s"}` : ""}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
