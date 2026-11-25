"use client";

import { useState } from "react";
import { Check, ChevronLeft, Loader2, Send, UserPlus } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import SignaturePad from "./SignaturePad";
import { CrewPicker, SignOnPanel, card, h2, input, primary, secondary } from "./CrewSignOn";
import { LIMITS, PRESTART_TOPICS } from "@/lib/siteDocs/rules";
import type { LinkJobDTO, LinkRecordDTO, LinkViewDTO } from "@/lib/siteDocs/store";

// The pre-start meeting (daily) and the toolbox talk (weekly) on the supervisor's phone (Ilies, 25 Nov 2026): what was
// covered, then each crew member taps their name (today's sign-ins on the job), reads it, ticks "I understand" and
// signs; then the supervisor signs; then Send. Locked once sent - a late arrival signs on afterwards (LateSignOn).

type Kind = "PRESTART" | "TOOLBOX";
type Signed = { attendanceId: string; name: string; signature: string };

export function MeetingForm({ api, view, job, kind, onCancel, onSent }: { api: string; view: LinkViewDTO; job: LinkJobDTO; kind: Kind; onCancel: () => void; onSent: (r: LinkRecordDTO) => void }) {
  const [ticks, setTicks] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<"OFFICE" | "OWN">(view.topic ? "OFFICE" : "OWN");
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [sitePoints, setSitePoints] = useState("");
  const [signed, setSigned] = useState<Signed[]>([]);
  const [signing, setSigning] = useState<{ id: string; name: string } | null>(null);
  const [supSig, setSupSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toolbox = kind === "TOOLBOX";
  const done = new Set(signed.map((s) => s.attendanceId));
  const n = job.prestarts.length;

  const missing = !toolbox
    ? (!Object.keys(ticks).length ? "Tick what was covered." : ticks.OTHER !== undefined && ticks.OTHER.trim().length < 2 ? "Other: say what it was." : null)
    : (source === "OWN" && title.trim().length < 3 ? "What's the topic?" : points.trim().length < 3 ? "Write the points you went through." : null)
    ?? null;
  const blocker = missing ?? (!supSig ? "Sign it yourself as the supervisor." : null);

  // What each crew member reads before they tick and sign.
  const summary = toolbox ? (
    <div className={card}>
      <p className="text-sm text-gray-400">Toolbox talk</p>
      <p className="text-base font-semibold text-gray-100">{source === "OFFICE" && view.topic ? view.topic.title : title || "-"}</p>
      {source === "OFFICE" && view.topic?.points.length ? <ul className="mt-1 list-disc pl-5 text-sm text-gray-300">{view.topic.points.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
      {points && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{points}</p>}
      {sitePoints && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300"><span className="text-gray-500">On this site: </span>{sitePoints}</p>}
    </div>
  ) : (
    <div className={card}>
      <p className="mb-1 text-sm text-gray-400">Pre-start - what was covered</p>
      <ul className="space-y-1 text-sm text-gray-200">
        {PRESTART_TOPICS.filter((t) => ticks[t.key] !== undefined).map((t) => <li key={t.key}><span className="font-semibold">{t.label}</span>{ticks[t.key] ? ` - ${ticks[t.key]}` : ""}</li>)}
      </ul>
      {notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{notes}</p>}
    </div>
  );

  if (signing) {
    return (
      <SignOnPanel who={signing.name} tickText={toolbox ? "I was at this toolbox talk and I understand it." : "I was at this pre-start and I understand it."}
        onCancel={() => setSigning(null)}
        onSave={(png) => { setSigned((xs) => [...xs, { attendanceId: signing.id, name: signing.name, signature: png }]); setSigning(null); window.scrollTo(0, 0); }}>
        {summary}
      </SignOnPanel>
    );
  }

  async function send() {
    if (blocker) return;
    setBusy(true); setError(null);
    const body = {
      kind, jobId: job.id, notes,
      ...(toolbox ? { source, topicId: source === "OFFICE" ? view.topic?.id : null, title, points, sitePoints } : { topics: Object.entries(ticks).map(([key, v]) => ({ key, notes: v })) }),
      crew: signed.map((s) => ({ attendanceId: s.attendanceId, understood: true, signature: s.signature })), supervisorSignature: supSig,
    };
    const r = await fetch(`${api}/documents/records`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't send - no signal? Nothing was lost - try again.");
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't send - try again."));
    onSent((await r.json()).record as LinkRecordDTO);
  }

  return (
    <div className="space-y-4 pb-24">
      <button onClick={onCancel} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back - nothing is sent</button>
      <h1 className="text-xl font-semibold text-gray-100">{toolbox ? "Toolbox talk" : n ? `Pre-start ${n + 1}` : "Pre-start meeting"}</h1>
      <p className="text-sm text-gray-400">{job.label}</p>

      {/* Once someone has signed, what they signed for is locked on this phone (take them off to change it). */}
      <fieldset disabled={signed.length > 0} className="space-y-4 disabled:opacity-80">
      {signed.length > 0 && <p className="text-xs text-amber-300">Locked - {signed.length} signed for this. Take them off below to change it.</p>}
      {toolbox ? (
        <section className={card}>
          <h2 className={h2}>1. The topic</h2>
          {view.topic && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {(["OFFICE", "OWN"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSource(s)} aria-pressed={source === s}
                  className={`min-h-[3.25rem] rounded-xl border px-3 py-2 text-sm font-semibold ${source === s ? "border-brand-500 bg-brand-600/25 text-white" : "border-edge bg-panel2 text-gray-300"}`}>
                  {s === "OFFICE" ? "Topic of the week" : "My own topic"}
                </button>
              ))}
            </div>
          )}
          {source === "OFFICE" && view.topic ? (
            <div className="rounded-xl border border-edge/70 bg-panel2/40 p-3">
              <p className="font-semibold text-gray-100">{view.topic.title}</p>
              {view.topic.points.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-gray-300">{view.topic.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
              {view.topic.hasPdf && <a className="mt-2 inline-block text-sm text-brand-300 underline" href={`${api}/documents/topic/${view.topic.id}`} target="_blank" rel="noreferrer">Open the topic PDF</a>}
            </div>
          ) : (
            <input className={input} maxLength={LIMITS.title} placeholder="Topic - e.g. Working at heights" value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
          <label className="mt-3 block"><span className="mb-1 block text-sm text-gray-300">Points discussed</span>
            <textarea className={`${input} min-h-[96px]`} maxLength={LIMITS.note} value={points} onChange={(e) => setPoints(e.target.value)} /></label>
          <label className="mt-3 block"><span className="mb-1 block text-sm text-gray-300">Site-specific points (optional)</span>
            <textarea className={`${input} min-h-[80px]`} maxLength={LIMITS.note} value={sitePoints} onChange={(e) => setSitePoints(e.target.value)} /></label>
        </section>
      ) : (
        <section className={card}>
          <h2 className={h2}>1. What was covered</h2>
          <div className="space-y-2">
            {PRESTART_TOPICS.map((t) => {
              const on = ticks[t.key] !== undefined;
              return (
                <div key={t.key} className={`rounded-xl border ${on ? "border-brand-500 bg-brand-600/15" : "border-edge bg-panel2"}`}>
                  <button type="button" aria-pressed={on} onClick={() => setTicks((x) => { const y = { ...x }; if (on) delete y[t.key]; else y[t.key] = ""; return y; })}
                    className="flex min-h-[3.25rem] w-full items-center gap-3 px-3 py-2 text-left text-sm font-semibold text-gray-100">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand-400 bg-brand-500 text-white" : "border-gray-500"}`}>{on && <Check size={16} />}</span>
                    {t.label}
                  </button>
                  {on && <div className="px-3 pb-3"><input className={input} maxLength={LIMITS.topicNote} placeholder={t.key === "OTHER" ? "Say what it was" : "Notes (optional)"} value={ticks[t.key]} onChange={(e) => setTicks((x) => ({ ...x, [t.key]: e.target.value }))} /></div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={card}>
        <h2 className={h2}>2. General notes (optional)</h2>
        <textarea className={`${input} min-h-[80px]`} maxLength={LIMITS.note} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>
      </fieldset>

      <section className={card}>
        <h2 className={h2}>3. Crew sign on</h2>
        <p className="mb-2 text-sm text-gray-400">Each person taps their name, reads it, ticks and signs. Only people signed in on this job today are listed.</p>
        {missing ? <p className="text-sm text-amber-300">{missing} Then the crew can sign.</p> : (
          <CrewPicker crew={job.crew} done={done} onPick={(c) => { if (signed.length >= view.limits.crewPerSend) return setError(`Send it with ${view.limits.crewPerSend}, then the rest sign on after.`); setSigning({ id: c.id, name: c.name }); window.scrollTo(0, 0); }} />
        )}
        {signed.length > 0 && <p className="mt-2 text-sm text-emerald-300">{signed.length} signed: {signed.map((s) => s.name).join(", ")}</p>}
        {signed.length > 0 && <button type="button" className="mt-2 text-xs text-gray-400 underline" onClick={() => setSigned((xs) => xs.slice(0, -1))}>Take off the last one ({signed[signed.length - 1].name})</button>}
      </section>

      <section className={card}>
        <h2 className={h2}>4. Supervisor sign-off</h2>
        <div className="mb-2 rounded-xl border border-edge bg-panel2 px-3 py-3 text-base text-gray-200">{view.supervisor}</div>
        <SignaturePad label="Your signature" onChange={setSupSig} />
      </section>

      {error && <div className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      <div className="sticky bottom-0 -mx-4 border-t border-edge bg-panel/95 px-4 pb-4 pt-3 backdrop-blur">
        <button className={primary} disabled={!!blocker || busy} onClick={send}>{busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />} {busy ? "Sending…" : "Send to the office"}</button>
        <p className={`mt-1.5 text-center text-xs ${blocker ? "text-amber-300" : "text-gray-500"}`}>{blocker ?? (signed.length ? "It's locked once sent - anyone late signs on after." : "No crew signed yet - they can sign on after it's sent.")}</p>
      </div>
    </div>
  );
}

// A sent pre-start / toolbox talk: who signed, and "Late arrival signs on" for anyone on today's crew who hasn't.
export function SentRecord({ api, job, rec, onBack, onChanged }: { api: string; job: LinkJobDTO; rec: LinkRecordDTO; onBack: () => void; onChanged: (r: LinkRecordDTO) => void }) {
  const [signing, setSigning] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Who's already on it (the server matches by person, not by the sign-in row).
  const onIt = new Set(rec.signedCrew);
  if (signing) {
    return (
      <SignOnPanel who={signing.name} tickText={`I've been told what was covered at this ${rec.kind === "TOOLBOX" ? "toolbox talk" : "pre-start"} and I understand it.`} busy={busy} error={error}
        onCancel={() => { setSigning(null); setError(null); }}
        onSave={async (png) => {
          setBusy(true); setError(null);
          const r = await fetch(`${api}/documents/records/${rec.id}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attendanceId: signing.id, understood: true, signature: png }) }).catch(() => null);
          setBusy(false);
          if (!r) return setError("Couldn't save - no signal? Try again.");
          if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save - try again."));
          onChanged((await r.json()).record as LinkRecordDTO);
          setFlash(`${signing.name} signed on.`);
          setSigning(null);
        }} />
    );
  }
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back</button>
      <h1 className="text-xl font-semibold text-gray-100">{rec.label}{rec.title ? ` - ${rec.title}` : ""}</h1>
      <p className="text-sm text-gray-400">Sent {new Date(rec.sentAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", hour: "numeric", minute: "2-digit" })} · locked</p>
      {flash && <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm text-emerald-300">✓ {flash}</div>}
      <section className={card}>
        <h2 className={h2}>Signed</h2>
        <ul className="space-y-1 text-sm text-gray-200">{rec.signed.map((s, i) => <li key={i}>✓ {s.name}{s.late ? <span className="text-amber-300"> (late sign-on)</span> : null}</li>)}</ul>
      </section>
      <section className={card}>
        <h2 className={`${h2} flex items-center gap-2`}><UserPlus size={18} /> Late arrival signs on</h2>
        <CrewPicker crew={job.crew} done={onIt} onPick={(c) => setSigning({ id: c.id, name: c.name })} empty="Nobody else is signed in on this job." />
      </section>
      <button className={secondary} onClick={onBack}><ChevronLeft size={18} /> Back</button>
    </div>
  );
}
