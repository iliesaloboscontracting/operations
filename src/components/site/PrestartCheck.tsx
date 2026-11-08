"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ClipboardCheck, ImagePlus, Loader2, X } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";
import { deviceId } from "@/lib/signinDevice";
import { answerLabel, type Answer, type ChecklistItem } from "@/lib/prestart/checklists";
import { LIMITS, PRIORITIES, PRIORITY_HINT, PRIORITY_LABEL, PRIORITY_TONE, type FaultPriority } from "@/lib/prestart/rules";

// The pre-start after signing in on a truck's QR, and the short post-check after signing out there (8 Nov 2026,
// Ilies). One screen, every item OK / Fault / N/A (question items read No / Yes). A fault opens right there: what's
// wrong, how bad (Low / High / Urgent / Do not use) and at least one photo - camera or gallery. The truck's open faults
// are at the top with "Still there", so the next driver confirms one instead of reporting it again. "Do it later"
// skips it - the sign-in is already saved either way. No money anywhere on this screen.

type KnownFault = { id: string; itemKey: string | null; itemLabel: string | null; description: string; priority: FaultPriority; priorityLabel: string; reportedOn: string; reportedBy: string };
type View = { kind: "PRE" | "POST"; machine: string; title: string; checklist: { id: string; items: ChecklistItem[] }; done: boolean; openFaults: KnownFault[] };
type Photo = { id: string; preview: string };
type Draft = { description: string; priority: FaultPriority | null; photos: Photo[]; open: boolean };
export type PrestartResult = { message: string; sent: { itemLabel: string; priority: string; markedDown: boolean }[] };

const big = "flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-lg font-semibold text-white disabled:opacity-50";
const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const ANSWER_ON: Record<Answer, string> = { OK: "border-emerald-500 bg-emerald-600 text-white", FAULT: "border-red-500 bg-red-600 text-white", NA: "border-gray-500 bg-gray-600 text-white" };
const emptyDraft = (): Draft => ({ description: "", priority: null, photos: [], open: true });

export default function PrestartCheck({ token, banner, onDone, onSkip }: { token: string; banner?: string; onDone: (r: PrestartResult) => void; onSkip: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [still, setStill] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/site/in/prestart?token=${encodeURIComponent(token)}`).then(async (res) => {
      if (!res.ok) return setDead(await serverErrorMessage(res, "The checklist didn't load - check your signal."));
      const v: View = await res.json();
      if (v.done) return setDead("That check is already in - thanks.");
      setView(v);
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
  const draftReady = (d: Draft) => d.description.trim().length >= LIMITS.minDescription && !!d.priority && d.photos.length > 0;
  const unanswered = view.checklist.items.filter((i) => !answers[i.key]).length;
  const notReady = view.checklist.items.filter((i) => needsDraft(i.key) && !draftReady(draftOf(i.key)));
  const canSend = unanswered === 0 && notReady.length === 0 && uploading === 0 && !busy;

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
  async function addPhoto(key: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading((n) => n + 1);
    try {
      const preview = await resizePhoto(file);
      const res = await fetch("/api/site/in/prestart/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, photo: preview, deviceId: deviceId() }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "The photo didn't send - try again."));
      const { id } = await res.json();
      setDrafts((d) => { const cur = d[key] ?? emptyDraft(); return { ...d, [key]: { ...cur, photos: [...cur.photos, { id, preview }] } }; });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading((n) => n - 1);
    }
  }
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
        body: JSON.stringify({ token, answers, faults, stillThere: [...still], deviceId: deviceId() }),
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
        <p className="text-sm text-gray-400">{view.machine}{view.kind === "PRE" ? " - before you drive." : " - before you go."}</p>
      </div>

      {view.openFaults.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="text-sm font-semibold text-amber-200">Known faults on this truck</div>
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
                <FaultForm draft={d} busy={uploading > 0} onChange={(p) => setDraft(item.key, p)} onPhoto={(f) => addPhoto(item.key, f)} />
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
          {uploading ? "Sending the photo..." : unanswered ? `${unanswered} item${unanswered > 1 ? "s" : ""} still to answer.` : notReady.length ? `Finish the fault on "${notReady[0].label}" - what's wrong, how bad, and a photo.` : ""}
        </p>
      )}
      <button className="w-full py-2 text-sm text-gray-400" disabled={busy} onClick={onSkip}>Do it later</button>
    </div>
  );
}

function FaultForm({ draft, busy, onChange, onPhoto }: { draft: Draft; busy: boolean; onChange: (p: Partial<Draft>) => void; onPhoto: (f: File | undefined) => void }) {
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
        <div className="mb-1 text-sm text-gray-400">Photo (at least one)</div>
        {draft.photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {draft.photos.map((p) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="Fault photo" className="h-20 w-20 rounded-lg border border-edge object-cover" />
                <button aria-label="Remove photo" className="absolute -right-2 -top-2 rounded-full bg-gray-900 p-1 text-gray-200"
                  onClick={() => onChange({ photos: draft.photos.filter((x) => x.id !== p.id) })}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {draft.photos.length < LIMITS.photosPerFault && (
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
