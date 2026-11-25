"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronLeft, Loader2, Send, X } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { mediaIdOf } from "@/lib/media/rules";
import MediaUpload from "./MediaUpload";
import SignaturePad from "./SignaturePad";
import { card, h2, input, primary } from "./CrewSignOn";
import { BODY_PARTS, INCIDENT_TYPES, LIMITS, SAFEWORK_ANSWERS, SAFEWORK_PROMPT, TREATMENTS, isNotifiable } from "@/lib/siteDocs/rules";
import type { LinkJobDTO, LinkViewDTO } from "@/lib/siteDocs/store";

// The incident report on the supervisor's phone (Ilies, 25 Nov 2026): drop-downs for the type, treatment and body part,
// when (default now), where, who (today's crew on the job, plus others typed), what happened, what was done straight
// away, witnesses, optional photos. A dangerous incident, medical treatment, lost time or "serious injury or illness"
// shows the red SafeWork NSW box before Send and asks "Has SafeWork been called?" - nobody is contacted automatically.
// The supervisor signs, then Send. After that this phone only ever shows "Sent - INC-0004", the date and the type.

const nowLocal = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const select = input;

export default function IncidentForm({ api, view, job, onCancel, onSent }: { api: string; view: LinkViewDTO; job: LinkJobDTO; onCancel: () => void; onSent: (n: { number: string }) => void }) {
  const [type, setType] = useState("");
  const [treatment, setTreatment] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [when, setWhen] = useState(nowLocal());
  const [location, setLocation] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [others, setOthers] = useState("");
  const [what, setWhat] = useState("");
  const [action, setAction] = useState("");
  const [witnesses, setWitnesses] = useState("");
  const [serious, setSerious] = useState(false);
  const [safework, setSafework] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifiable = isNotifiable({ type, treatment, serious });

  const missing = !type ? "Pick the type." : !treatment ? "Pick the treatment (None if there was none)." : !bodyPart ? "Pick the body part (Not applicable if none)."
    : !when ? "When did it happen?" : location.trim().length < 2 ? "Where on site?" : what.trim().length < 10 ? "What happened? A few words at least."
    : action.trim().length < 2 ? "What was done straight away?" : notifiable && !safework ? "Has SafeWork been called?" : uploading ? "Wait for the photos to finish sending."
    : !sig ? "Sign it as the supervisor." : null;

  async function send() {
    if (missing) return;
    setBusy(true); setError(null);
    const body = {
      jobId: job.id, type, treatment, bodyPart, occurredAt: when, location, people, others, whatHappened: what, immediateAction: action, witnesses,
      serious, promptShown: notifiable, safeworkCalled: notifiable ? safework : null, photoIds: photos.map((p) => mediaIdOf(p)).filter(Boolean), signature: sig,
    };
    const r = await fetch(`${api}/documents/incident`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't send - no signal? Nothing was lost - try again.");
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't send - try again."));
    onSent((await r.json()).incident);
  }

  return (
    <div className="space-y-4 pb-24">
      <button onClick={onCancel} className="flex items-center gap-1 py-2 text-sm text-gray-400"><ChevronLeft size={16} /> Back - nothing is sent</button>
      <h1 className="text-xl font-semibold text-gray-100">Incident report</h1>
      <p className="text-sm text-gray-400">{job.label}. Only the owner and the directors see it once it&apos;s sent - this phone keeps just the number.</p>

      <section className={card}>
        <h2 className={h2}>1. What kind</h2>
        <div className="space-y-2">
          <select className={select} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">Type…</option>{INCIDENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select className={select} value={treatment} onChange={(e) => setTreatment(e.target.value)} aria-label="Treatment"><option value="">Treatment…</option>{TREATMENTS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select className={select} value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} aria-label="Body part"><option value="">Body part…</option>{BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <label className="flex min-h-[3.25rem] items-center gap-3 rounded-xl border border-edge bg-panel2 px-3">
            <input type="checkbox" className="h-6 w-6 accent-red-500" checked={serious} onChange={(e) => setSerious(e.target.checked)} />
            <span className="text-sm font-semibold text-gray-100">Serious injury or illness</span>
          </label>
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>2. When and where</h2>
        <input type="datetime-local" className={input} value={when} max={nowLocal()} onChange={(e) => setWhen(e.target.value)} aria-label="When" />
        <input className={`${input} mt-2`} maxLength={LIMITS.location} placeholder="Where on site - e.g. Level 3 east stairwell" value={location} onChange={(e) => setLocation(e.target.value)} />
      </section>

      <section className={card}>
        <h2 className={h2}>3. People involved</h2>
        {job.crew.length === 0 ? <p className="text-sm text-gray-400">Nobody is signed in on this job - type them below.</p> : (
          <div className="space-y-2">
            {job.crew.map((c) => {
              const on = people.includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => setPeople((xs) => (on ? xs.filter((x) => x !== c.id) : xs.length < view.limits.people ? [...xs, c.id] : xs))}
                  className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm font-semibold ${on ? "border-brand-500 bg-brand-600/25 text-white" : "border-edge bg-panel2 text-gray-300"}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand-400 bg-brand-500 text-white" : "border-gray-500"}`}>{on && <Check size={16} />}</span>
                  {c.name}{c.company ? <span className="font-normal text-gray-400"> · {c.company}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        <textarea className={`${input} mt-2 min-h-[70px]`} maxLength={LIMITS.others} placeholder="Others (name and company)" value={others} onChange={(e) => setOthers(e.target.value)} />
      </section>

      <section className={card}>
        <h2 className={h2}>4. What happened</h2>
        <textarea className={`${input} min-h-[120px]`} maxLength={LIMITS.whatHappened} placeholder="What happened" value={what} onChange={(e) => setWhat(e.target.value)} />
        <textarea className={`${input} mt-2 min-h-[90px]`} maxLength={LIMITS.immediateAction} placeholder="What was done straight away" value={action} onChange={(e) => setAction(e.target.value)} />
        <textarea className={`${input} mt-2 min-h-[70px]`} maxLength={LIMITS.witnesses} placeholder="Witnesses (optional)" value={witnesses} onChange={(e) => setWitnesses(e.target.value)} />
      </section>

      <section className={card}>
        <h2 className={h2}>5. Photos (optional)</h2>
        {view.media.on ? (
          <>
            {photos.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {photos.map((p) => {
                  const id = mediaIdOf(p);
                  return (
                    <span key={p} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {id && <img src={`${api}/documents/media/${id}`} alt="" className="h-16 w-16 rounded-lg object-cover" />}
                      <button type="button" className="absolute -right-1 -top-1 rounded-full bg-black/70 p-1 text-white" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))}><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <MediaUpload api={{ start: `${api}/documents/media/start`, parts: `${api}/documents/media/parts`, complete: `${api}/documents/media/complete` }}
              fields={{ area: "INCIDENT", jobId: job.id }} kinds={["PHOTO"]} room={{ items: view.limits.photos - photos.length, videos: 0 }} busyChange={setUploading}
              onDone={(r) => { const ref = typeof r.body.ref === "string" ? r.body.ref : null; if (ref) setPhotos((ps) => [...ps, ref]); }} />
          </>
        ) : <p className="text-sm text-gray-500">Photos can&apos;t be added right now - send it without, and tell the office you have photos.</p>}
      </section>

      {notifiable && (
        <section className="rounded-2xl border-2 border-red-500 bg-red-900/40 p-4" role="alert">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-red-100"><AlertTriangle size={22} /> SafeWork NSW</h2>
          <p className="text-base font-semibold text-red-50">{SAFEWORK_PROMPT}</p>
          <p className="mt-3 text-sm text-red-100">Has SafeWork been called?</p>
          <div className="mt-2 space-y-2">
            {SAFEWORK_ANSWERS.map((a) => (
              <button key={a.key} type="button" aria-pressed={safework === a.key} onClick={() => setSafework(a.key)}
                className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold ${safework === a.key ? "border-white bg-white/15 text-white" : "border-red-400/60 text-red-100"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${safework === a.key ? "border-white bg-white text-red-700" : "border-red-300"}`}>{safework === a.key && <Check size={16} />}</span>
                {a.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={card}>
        <h2 className={h2}>6. Supervisor sign-off</h2>
        <div className="mb-2 rounded-xl border border-edge bg-panel2 px-3 py-3 text-base text-gray-200">{view.supervisor}</div>
        <SignaturePad label="Your signature" onChange={setSig} />
      </section>

      {error && <div className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      <div className="sticky bottom-0 -mx-4 border-t border-edge bg-panel/95 px-4 pb-4 pt-3 backdrop-blur">
        <button className={primary} disabled={!!missing || busy} onClick={send}>{busy ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />} {busy ? "Sending…" : "Send the report"}</button>
        <p className={`mt-1.5 text-center text-xs ${missing ? "text-amber-300" : "text-gray-500"}`}>{missing ?? "It gets its number (INC-0001 ...) when it's sent. It can't be changed after."}</p>
      </div>
    </div>
  );
}
