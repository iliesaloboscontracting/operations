"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ClipboardCheck, ImagePlus, Loader2, Video, X } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";
import { deviceId } from "@/lib/signinDevice";
import { answerLabel, type Answer, type ChecklistItem } from "@/lib/prestart/checklists";
import { LIMITS, PRIORITIES, PRIORITY_HINT, PRIORITY_LABEL, PRIORITY_TONE, type FaultPriority } from "@/lib/prestart/rules";
import { FAULT_MEDIA, type PhoneMediaConfig } from "@/lib/media/rules";
import { uploadMedia, UploadError, type MediaEndpoints } from "@/lib/media/client";
import MediaUpload from "./MediaUpload";

// The pre-start after signing in on a truck's QR, and the short post-check after signing out there (8 Nov 2026,
// Ilies). One screen, every item OK / Fault / N/A (question items read No / Yes). A fault opens right there: what's
// wrong, how bad (Low / High / Urgent / Do not use) and at least one photo - camera or gallery. The truck's open faults
// are at the top with "Still there", so the next driver confirms one instead of reporting it again. "Do it later"
// skips it - the sign-in is already saved either way. No money anywhere on this screen.
// Stage 1b (10 Nov 2026): a truck pre-start has five walk-around photos (camera only) - needed on the truck's first
// pre-start of the day, with the odometer photo; optional after that ("This morning's photos were taken at ... by ...").
// PS-010: when the day's photo limit is full, an Urgent / Do-not-use fault can go without a photo and the walk-around
// is let through (the server checks the limit itself).
// Large uploads (10 Nov 2026, Ilies): with the media bucket on (view.media), every photo goes at full quality straight to
// the bucket, and a fault can also have VIDEOS (up to 2 minutes, 3 a check) - with a progress bar, Pause / Resume and
// retry on a lost signal (./MediaUpload.tsx). The walk-around and hour meter stay photos, camera only. Every limit is
// the server's, as before (a full allowance still says capFull).

type KnownFault = { id: string; itemKey: string | null; itemLabel: string | null; description: string; priority: FaultPriority; priorityLabel: string; reportedOn: string; reportedBy: string };
type Walk = { required: boolean; slots: { key: string; label: string }[]; earlier: { at: string | null; by: string; limit: boolean } | null };
type View = {
  kind: "PRE" | "POST"; machine: string; title: string; checklist: { id: string; items: ChecklistItem[] }; done: boolean; openFaults: KnownFault[];
  walkaround: Walk | null; odometer: "SENT" | "MISSING" | null;
  // Stage 2 (plant QR stickers): "truck" or "machine", and every plant check's hour meter (photo + hours, last as a hint).
  noun?: "truck" | "machine"; hourMeter?: { required: boolean; last: number | null } | null;
  media?: PhoneMediaConfig | null; // large uploads on (10 Nov 2026)
};
type Photo = { id: string; preview: string | null; video?: boolean };
type Draft = { description: string; priority: FaultPriority | null; photos: Photo[]; open: boolean };
export type PrestartResult = { message: string; sent: { itemLabel: string; priority: string; markedDown: boolean }[] };

const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-lg font-semibold text-white disabled:opacity-50";
const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const ANSWER_ON: Record<Answer, string> = { OK: "border-emerald-500 bg-emerald-600 text-white", FAULT: "border-red-500 bg-red-600 text-white", NA: "border-gray-500 bg-gray-600 text-white" };
const emptyDraft = (): Draft => ({ description: "", priority: null, photos: [], open: true });

export default function PrestartCheck({ token, banner, odometerToken, onDone, onSkip }: { token: string; banner?: string; odometerToken?: string | null; onDone: (r: PrestartResult) => void; onSkip: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [still, setStill] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walk, setWalk] = useState<Record<string, Photo>>({});
  // PS-010 / PS-012: the day's allowance is full - for walk-around photos and / or fault photos (the server said so on a
  // photo; it checks again itself when the check is sent).
  const [walkFull, setWalkFull] = useState(false);
  const [faultFull, setFaultFull] = useState(false);
  // Stage 2: the hour meter on a plant check - its photo (camera only) and the hours typed.
  const [meterPhoto, setMeterPhoto] = useState<Photo | null>(null);
  const [hours, setHours] = useState("");
  const [meterFull, setMeterFull] = useState(false);
  const [odo, setOdo] = useState<"SENT" | "MISSING" | null>(null);
  // Large uploads: the bucket routes (the token in its header, never the address - PS-005) and the boxes still sending.
  const mediaApi: MediaEndpoints = { start: "/api/site/in/prestart/media/start", parts: "/api/site/in/prestart/media/parts", complete: "/api/site/in/prestart/media/complete", headers: { "x-prestart-token": token } };
  const [faultSending, setFaultSending] = useState<Record<string, boolean>>({});
  const faultBusy = Object.values(faultSending).some(Boolean);
  const busyFor = useCallback((k: string) => (b: boolean) => setFaultSending((s) => (s[k] === b ? s : { ...s, [k]: b })), []);
  const capFrom = useCallback((j: Record<string, unknown>) => {
    if (!j.capFull) return;
    if (j.cap === "WALKAROUND" || j.cap === "ALL") setWalkFull(true);
    if (j.cap === "FAULT" || j.cap === "ALL") setFaultFull(true);
    if (j.cap === "METER" || j.cap === "ALL") setMeterFull(true);
  }, []);

  useEffect(() => {
    // PS-005: the token goes in a header, never the address (the photo and the check send it in the body).
    fetch("/api/site/in/prestart", { headers: { "x-prestart-token": token }, cache: "no-store" }).then(async (res) => {
      if (!res.ok) return setDead(await serverErrorMessage(res, "The checklist didn't load - check your signal."));
      const v: View = await res.json();
      if (v.done) return setDead("That check is already in - thanks.");
      setView(v);
      setOdo(v.odometer);
    }, () => setDead("The checklist didn't load - check your signal."));
  }, [token]);

  if (dead) return (
    <div className="space-y-4">
      {banner && <Banner text={banner} />}
      <div className="rounded-xl border border-edge bg-panel p-5 text-center text-sm text-gray-300">{dead}</div>
      <button className="w-full py-2 text-sm text-gray-400" onClick={onSkip}>Close</button>
    </div>
  );
  if (!view) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;

  // A Fault answer on an item with a known fault confirmed "Still there" needs nothing more (it's already reported).
  const covered = (key: string) => view.openFaults.some((f) => f.itemKey === key && still.has(f.id));
  const draftOf = (key: string) => drafts[key] ?? emptyDraft();
  const needsDraft = (key: string) => answers[key] === "FAULT" && (!covered(key) || drafts[key]?.open);
  const loud = (p: FaultPriority | null) => p === "URGENT" || p === "DO_NOT_USE";
  const draftReady = (d: Draft) => d.description.trim().length >= LIMITS.minDescription && !!d.priority && (d.photos.length > 0 || (faultFull && loud(d.priority)));
  const unanswered = view.checklist.items.filter((i) => !answers[i.key]).length;
  const notReady = view.checklist.items.filter((i) => needsDraft(i.key) && !draftReady(draftOf(i.key)));
  const w = view.walkaround;
  const walkMissing = w && w.required && !walkFull ? w.slots.filter((s) => !walk[s.key]) : [];
  const odoMissing = !!w?.required && view.odometer !== null && odo !== "SENT"; // trucks only - plant has the hour meter
  const hm = view.hourMeter;
  const hoursOk = /^\d{1,6}(\.\d)?$/.test(hours.trim()) && Number(hours) > 0;
  const meterMissing = !!hm?.required && (!hoursOk || (!meterPhoto && !meterFull));
  const lower = hm && hoursOk && hm.last != null && Number(hours) < hm.last;
  const noun = view.noun ?? "truck";
  const canSend = unanswered === 0 && notReady.length === 0 && walkMissing.length === 0 && !odoMissing && !meterMissing && uploading === 0 && !faultBusy && !busy;

  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? emptyDraft()), ...patch } }));
  function answer(key: string, a: Answer) {
    setAnswers((x) => ({ ...x, [key]: a }));
    if (a === "FAULT" && !drafts[key]) setDrafts((d) => ({ ...d, [key]: { ...emptyDraft(), open: !covered(key) } }));
  }
  function toggleStill(f: KnownFault) {
    const next = new Set(still);
    if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
    setStill(next);
    // Confirming a known fault on an item answers that item Fault - it's still there.
    if (!still.has(f.id) && f.itemKey && view?.checklist.items.some((i) => i.key === f.itemKey) && !answers[f.itemKey]) {
      setAnswers((x) => ({ ...x, [f.itemKey!]: "FAULT" }));
      if (!drafts[f.itemKey]) setDrafts((d) => ({ ...d, [f.itemKey!]: { ...emptyDraft(), open: false } }));
    }
  }
  // One photo up: a fault's (no slot) or a walk-around slot's. A 429 with capFull = that day's allowance is full (cap:
  // WALKAROUND, FAULT, or ALL for both).
  async function upload(file: File, slot?: string): Promise<Photo> {
    if (view?.media) {
      // Full quality, straight to the bucket (a walk-around / hour-meter / fault photo) - the server checks it and makes
      // the same AssetFaultMedia row the old route did, under the same caps.
      const preview = await resizePhoto(file).catch(() => null);
      try {
        const r = await uploadMedia({ api: mediaApi, file, kind: "PHOTO", fields: { deviceId: deviceId(), ...(slot ? { slot } : {}) } });
        return { id: String(r.body.id), preview };
      } catch (e) {
        if (e instanceof UploadError) capFrom(e.body);
        throw new Error(e instanceof Error ? e.message : "The photo didn't send - try again.");
      }
    }
    const preview = await resizePhoto(file);
    const res = await fetch("/api/site/in/prestart/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, photo: preview, deviceId: deviceId(), ...(slot ? { slot } : {}) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (j.capFull) {
        if (j.cap === "WALKAROUND" || j.cap === "ALL") setWalkFull(true);
        if (j.cap === "FAULT" || j.cap === "ALL") setFaultFull(true);
        if (j.cap === "METER" || j.cap === "ALL") setMeterFull(true);
      }
      throw new Error(typeof j.error === "string" ? j.error : "The photo didn't send - try again.");
    }
    return { id: j.id, preview };
  }
  async function busyWith(fn: () => Promise<void>) {
    setError(null);
    setUploading((n) => n + 1);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setUploading((n) => n - 1); }
  }
  const addPhoto = (key: string, file: File | undefined) => file && busyWith(async () => {
    const p = await upload(file);
    setDrafts((d) => { const cur = d[key] ?? emptyDraft(); return { ...d, [key]: { ...cur, photos: [...cur.photos, p] } }; });
  });
  const addWalk = (slot: string, file: File | undefined) => file && busyWith(async () => {
    const p = await upload(file, slot);
    setWalk((x) => ({ ...x, [slot]: p }));
  });
  // The odometer photo, when it was skipped or failed before (the same route as the odometer step).
  const addMeter = (file: File | undefined) => file && busyWith(async () => { setMeterPhoto(await upload(file, "HOUR_METER")); });
  const addOdometer = (file: File | undefined) => file && odometerToken && busyWith(async () => {
    const res = await fetch("/api/site/in/odometer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: odometerToken, dataUrl: await resizePhoto(file) }) });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "The odometer photo didn't send - try again."));
    setOdo("SENT");
  });
  async function send() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const faults = view.checklist.items.filter((i) => needsDraft(i.key)).map((i) => {
        const d = draftOf(i.key);
        return { itemKey: i.key, description: d.description.trim(), priority: d.priority, mediaIds: d.photos.map((p) => p.id) };
      });
      const res = await fetch("/api/site/in/prestart", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, answers, faults, stillThere: [...still], deviceId: deviceId(), walkaround: Object.fromEntries(Object.entries(walk).map(([k, p]) => [k, p.id])),
          ...(hm ? { hourMeter: { value: hours.trim(), mediaId: meterPhoto?.id ?? null } } : {}) }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't send - check your signal and try again."));
      const r = await res.json();
      onDone({ message: r.message, sent: r.sent ?? [] });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {banner && <Banner text={banner} />}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-100"><ClipboardCheck size={22} /> {view.title}</h1>
        <p className="text-sm text-gray-400">{view.machine}{view.kind === "PRE" ? (noun === "machine" ? " - before you start." : " - before you drive.") : " - before you go."}</p>
      </div>

      {view.openFaults.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="text-sm font-semibold text-amber-200">Known faults on this {noun}</div>
          <p className="text-xs text-amber-200/80">Already reported. If it&apos;s still there, tap Still there - no need to report it again.</p>
          {view.openFaults.map((f) => (
            <div key={f.id} className="rounded-xl border border-edge bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <PriorityBadge p={f.priority} label={f.priorityLabel} />
                {f.itemLabel && <span className="text-sm font-medium text-gray-200">{f.itemLabel}</span>}
              </div>
              <p className="mt-1 text-sm text-gray-300">{f.description}</p>
              <p className="mt-0.5 text-xs text-gray-500">Reported {f.reportedOn} by {f.reportedBy}</p>
              <button
                onClick={() => toggleStill(f)}
                className={`mt-2 w-full rounded-xl border px-3 py-3 text-base font-semibold ${still.has(f.id) ? "border-amber-400 bg-amber-500 text-black" : "border-edge bg-panel2 text-gray-200"}`}
              >
                {still.has(f.id) ? "✓ Still there" : "Still there"}
              </button>
            </div>
          ))}
        </div>
      )}

      {walkFull && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          The walk-around photo limit for this truck today is reached. Send the pre-start without them - it&apos;s noted for the office.
        </div>
      )}
      {faultFull && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          The fault photo limit for this truck today is reached. You can still send an Urgent or Do-not-use fault without a photo.
        </div>
      )}

      {w && (
        <div className="space-y-2 rounded-2xl border border-edge bg-panel p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-semibold text-gray-100">Walk-around photos</div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${w.required ? "bg-red-500/15 text-red-300" : "bg-gray-700/60 text-gray-300"}`}>{w.required ? "Needed" : "Optional"}</span>
          </div>
          <p className="text-xs text-gray-400">
            {w.required
              ? `First check of the day on this ${noun} - a photo of each, with the camera.`
              : w.earlier
                ? (w.earlier.limit ? `Today's photos couldn't be added (the day's photo limit) - ${w.earlier.by}, ${w.earlier.at}. Add them if you can.` : `Today's photos were taken at ${w.earlier.at} by ${w.earlier.by}. Add more if something's changed.`)
                : "Optional."}
          </p>
          {/* PS-015 (Ilies, 10 Nov 2026): say plainly who sees them and for how long - kept forever since 10 Nov 2026. */}
          <p className="text-xs text-gray-500">These photos are kept and seen by the office.</p>
          <div className="grid grid-cols-2 gap-2">
            {w.slots.map((s) => <SlotPhoto key={s.key} label={s.label} photo={walk[s.key]} busy={uploading > 0} onPhoto={(f) => addWalk(s.key, f)} />)}
            {w.required && view.odometer !== null && (
              <div className={`rounded-xl border p-2 ${odo === "SENT" ? "border-emerald-500/50" : "border-edge"}`}>
                <div className="text-sm text-gray-200">Odometer</div>
                {odo === "SENT" ? <div className="mt-1 text-sm text-emerald-300">✓ Sent</div>
                  : odometerToken ? <CameraButton busy={uploading > 0} label="Take photo" onPhoto={addOdometer} />
                  : <div className="mt-1 text-xs text-gray-400">Sign in again to take it.</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {hm && (
        <div className="space-y-2 rounded-2xl border border-edge bg-panel p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-base font-semibold text-gray-100">Hour meter</div>
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">Needed</span>
          </div>
          <p className="text-xs text-gray-400">A photo of the hour meter, with the camera, and the hours it shows.{hm.last != null ? ` Last recorded: ${hm.last.toLocaleString("en-AU")}.` : ""}</p>
          {meterFull && <p className="text-xs text-amber-200">The hour-meter photo limit for today is reached - type the hours and send; it&apos;s noted.</p>}
          <div className="grid grid-cols-2 gap-2">
            <SlotPhoto label="Hour meter" photo={meterPhoto ?? undefined} busy={uploading > 0} onPhoto={addMeter} />
            <label className="rounded-xl border border-edge p-2 text-sm text-gray-200">
              Hours
              <input className={`${input} mt-1`} inputMode="decimal" placeholder="e.g. 1234.5" value={hours} onChange={(e) => setHours(e.target.value)} />
              {lower && <span className="mt-1 block text-xs text-amber-200">Lower than last time - check it. It&apos;s sent as typed and flagged for the office.</span>}
            </label>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {view.checklist.items.map((item) => {
          const a = answers[item.key];
          const d = draftOf(item.key);
          return (
            <div key={item.key} className={`rounded-2xl border p-3 ${a === "FAULT" ? "border-red-500/60 bg-red-500/5" : "border-edge bg-panel"}`}>
              <div className="text-base font-medium text-gray-100">{item.label}</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["OK", "FAULT", "NA"] as Answer[]).map((v) => (
                  <button key={v} onClick={() => answer(item.key, v)}
                    className={`rounded-xl border px-2 py-3 text-sm font-semibold ${a === v ? ANSWER_ON[v] : "border-edge bg-panel2 text-gray-300"}`}>
                    {answerLabel(item, v)}
                  </button>
                ))}
              </div>
              {a === "FAULT" && covered(item.key) && !d.open && (
                <div className="mt-2 text-sm text-amber-200">
                  Known fault - still there.{" "}
                  <button className="text-brand-300 underline" onClick={() => setDraft(item.key, { open: true })}>It&apos;s something new</button>
                </div>
              )}
              {needsDraft(item.key) && (
                <FaultForm draft={d} busy={uploading > 0} capFull={faultFull} onChange={(p) => setDraft(item.key, p)} onPhoto={(f) => addPhoto(item.key, f)}
                  media={view.media ? { api: mediaApi, deviceId: deviceId(), onBusy: busyFor(item.key), onCap: capFrom,
                    onAdded: (p) => setDrafts((x) => { const cur = x[item.key] ?? emptyDraft(); return { ...x, [item.key]: { ...cur, photos: [...cur.photos, p] } }; }) } : null} />
              )}
            </div>
          );
        })}
      </div>

      {error && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      <button className={`${big} bg-brand-600`} disabled={!canSend} onClick={send}>
        {busy || uploading ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} Send {view.kind === "PRE" ? "pre-start" : "post-check"}
      </button>
      {!canSend && !busy && (
        <p className="text-center text-xs text-gray-500">
          {uploading || faultBusy ? "Sending..." : meterMissing ? "The hour meter is still to do - its photo and the hours." : walkMissing.length ? `Walk-around photos still to take: ${walkMissing.map((s) => s.label).join(", ")}.` : odoMissing ? "The odometer photo is still to take." : unanswered ? `${unanswered} item${unanswered > 1 ? "s" : ""} still to answer.` : notReady.length ? `Finish the fault on "${notReady[0].label}" - what's wrong, how bad, and a photo.` : ""}
        </p>
      )}
      <button className="w-full py-2 text-sm text-gray-400" disabled={busy} onClick={onSkip}>Do it later</button>
    </div>
  );
}

// A walk-around slot: camera only (no gallery input - best effort, some phones still offer files).
function SlotPhoto({ label, photo, busy, onPhoto }: { label: string; photo?: Photo; busy: boolean; onPhoto: (f: File | undefined) => void }) {
  return (
    <div className={`rounded-xl border p-2 ${photo ? "border-emerald-500/50" : "border-edge"}`}>
      <div className="text-sm text-gray-200">{label}</div>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        photo.preview ? <img src={photo.preview} alt={label} className="mt-1 h-20 w-full rounded-lg object-cover" /> : <div className="mt-1 text-sm text-emerald-300">✓ Sent</div>
      )}
      <CameraButton busy={busy} label={photo ? "Retake" : "Take photo"} onPhoto={onPhoto} />
    </div>
  );
}
function CameraButton({ busy, label, onPhoto }: { busy: boolean; label: string; onPhoto: (f: File | undefined) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  return (
    <>
      <button disabled={busy} onClick={() => camera.current?.click()} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        <Camera size={16} /> {label}
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onPhoto(f); }} />
    </>
  );
}

type FaultMedia = { api: MediaEndpoints; deviceId: string; onBusy: (b: boolean) => void; onCap: (j: Record<string, unknown>) => void; onAdded: (p: Photo) => void };
function FaultForm({ draft, busy, capFull, onChange, onPhoto, media }: { draft: Draft; busy: boolean; capFull: boolean; onChange: (p: Partial<Draft>) => void; onPhoto: (f: File | undefined) => void; media?: FaultMedia | null }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-3 space-y-3 border-t border-edge pt-3">
      <textarea className={input} rows={2} maxLength={LIMITS.description} placeholder="What's wrong?" value={draft.description}
        onChange={(e) => onChange({ description: e.target.value })} />
      <div>
        <div className="mb-1 text-sm text-gray-400">How bad?</div>
        <div className="grid grid-cols-2 gap-2">
          {[...PRIORITIES].reverse().map((p) => (
            <button key={p} onClick={() => onChange({ priority: p })}
              className={`rounded-xl border px-2 py-2.5 text-left ${draft.priority === p ? PRIORITY_TONE[p] : "border-edge bg-panel2 text-gray-300"}`}>
              <div className="text-sm font-semibold">{PRIORITY_LABEL[p]}</div>
              <div className={`text-[11px] ${draft.priority === p ? "opacity-90" : "text-gray-500"}`}>{PRIORITY_HINT[p]}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-sm text-gray-400">{media ? "Photo or video" : "Photo"} (at least one{capFull ? " - or none for Urgent / Do not use, the limit is reached" : ""})</div>
        {draft.photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {draft.photos.map((p) => (
              <div key={p.id} className="relative">
                {p.preview
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.preview} alt="Fault photo" className="h-20 w-20 rounded-lg border border-edge object-cover" />
                  : <span className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-edge bg-panel2 text-[11px] text-gray-300">{p.video ? <><Video size={20} /> Video</> : <><ImagePlus size={20} /> Photo</>}</span>}
                <button aria-label="Remove photo" className="absolute -right-2 -top-2 rounded-full bg-gray-900 p-1 text-gray-200"
                  onClick={() => onChange({ photos: draft.photos.filter((x) => x.id !== p.id) })}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {media && (
          <MediaUpload compact api={media.api} fields={{ deviceId: media.deviceId }} kinds={["PHOTO", "VIDEO"]} busyChange={media.onBusy}
            room={{ items: LIMITS.photosPerFault - draft.photos.length, videos: FAULT_MEDIA.videosPerSignIn - draft.photos.filter((p) => p.video).length }}
            onError={(e) => media.onCap(e.body)}
            onDone={(r) => media.onAdded({ id: String(r.body.id), preview: null, video: r.kind === "VIDEO" })} />
        )}
        {!media && draft.photos.length < LIMITS.photosPerFault && (
          <div className="grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={() => camera.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">
              <Camera size={18} /> Take photo
            </button>
            <button disabled={busy} onClick={() => gallery.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-edge bg-panel2 px-3 py-3 text-sm text-gray-200 disabled:opacity-50">
              <ImagePlus size={18} /> From gallery
            </button>
          </div>
        )}
        {/* capture= sends a phone straight to the camera with no gallery option, so the gallery has its own input. */}
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onPhoto(f); }} />
        <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onPhoto(f); }} />
      </div>
      {draft.priority === "DO_NOT_USE" && (
        <div className="rounded-lg border border-red-500 bg-red-600/20 px-3 py-2 text-sm text-red-200">Do not use: park it and tell your supervisor. The office is alerted and it&apos;s marked Down.</div>
      )}
    </div>
  );
}

export function PriorityBadge({ p, label }: { p: FaultPriority; label?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[p] ?? PRIORITY_TONE.LOW}`}>{label ?? PRIORITY_LABEL[p] ?? p}</span>;
}

function Banner({ text }: { text: string }) {
  return <div className="rounded-2xl bg-emerald-500/15 px-4 py-4 text-center text-base font-semibold text-emerald-300">✓ {text}</div>;
}
