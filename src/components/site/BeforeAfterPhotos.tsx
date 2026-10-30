"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import { resizePhoto } from "@/lib/imageResize";
import { BEFORE_AFTER_LIMITS, PHASE_LABEL, type Phase } from "@/lib/dailyLog/beforeAfter";
import type { BeforeAfterPhotoDTO } from "@/lib/dailyLog/types";

// Before / after site photos on the daily log (30 Oct 2026, Ilies). Each photo is sent the moment it's taken - not
// held for the log - so a Before photo is safe even if the log is never sent. Big buttons for the camera or the
// gallery (iPhone Safari and Android Chrome), a progress bar while it sends, and a photo that didn't get through on
// bad signal waits with Retry (and goes again by itself when the phone is back online). Up to 6 a set; remove hides
// one (the office keeps who and when). Never blocks the log.

type Sets = { before: BeforeAfterPhotoDTO[]; after: BeforeAfterPhotoDTO[] };
type Waiting = { key: number; dataUrl: string; state: "waiting" | "sending" | "failed"; progress: number; error: string | null };

// XMLHttpRequest rather than fetch: it reports upload progress. status 0 = no signal / timed out.
function send(url: string, body: unknown, onProgress: (p: number) => void): Promise<{ status: number; body: { photos?: Sets; error?: string } }> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("Content-Type", "application/json");
    x.timeout = 60_000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => { let b = {}; try { b = JSON.parse(x.responseText); } catch { /* not JSON */ } resolve({ status: x.status, body: b }); };
    x.onerror = x.ontimeout = x.onabort = () => resolve({ status: 0, body: {} });
    x.send(JSON.stringify(body));
  });
}

export default function BeforeAfterPhotos({ api, jobId, phase, initial, onChange, hint }: {
  api: string; jobId: string; phase: Phase; initial: BeforeAfterPhotoDTO[]; onChange?: (sets: Sets) => void; hint?: string;
}) {
  const [shown, setShown] = useState<BeforeAfterPhotoDTO[]>(initial);
  const [queue, setQueueState] = useState<Waiting[]>([]);
  // The queue lives in a ref too, so the sending loop always reads the latest one (state updates land later).
  const queueRef = useRef<Waiting[]>([]);
  const setQueue = useCallback((f: (q: Waiting[]) => Waiting[]) => { queueRef.current = f(queueRef.current); setQueueState(queueRef.current); }, []);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const pumping = useRef(false);
  const url = `${api}/log/photos`;
  const label = PHASE_LABEL[phase];
  const room = BEFORE_AFTER_LIMITS.perPhase - shown.length - queue.length;

  const apply = useCallback((sets: Sets | undefined) => {
    if (!sets) return;
    setShown(phase === "BEFORE" ? sets.before : sets.after);
    onChange?.(sets);
  }, [phase, onChange]);

  // One photo at a time, in order. A refused photo (full, day closed...) is dropped with the reason; one that didn't
  // reach the server stays as "failed" for Retry.
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const it = queueRef.current.find((w) => w.state === "waiting");
        if (!it) break;
        setQueue((q) => q.map((w) => (w.key === it.key ? { ...w, state: "sending", progress: 0 } : w)));
        // The set goes in the address so the server can check it before the photo is read (SEC-BA-002).
        const r = await send(`${url}?phase=${phase}`, { jobId, photo: it.dataUrl }, (p) => setQueue((q) => q.map((w) => (w.key === it.key ? { ...w, progress: p } : w))));
        if (r.status === 201) {
          apply(r.body.photos);
          setQueue((q) => q.filter((w) => w.key !== it.key));
        } else if (r.status === 0 || r.status >= 500 || (r.status === 429 && /^One photo at a time/.test(r.body.error ?? ""))) {
          setQueue((q) => q.map((w) => (w.key === it.key ? { ...w, state: "failed", error: r.status === 0 ? "Didn't send - no signal?" : r.body.error ?? "Didn't send" } : w)));
        } else {
          setError(r.body.error ?? "That photo wasn't saved.");
          setQueue((q) => q.filter((w) => w.key !== it.key));
        }
      }
    } finally {
      pumping.current = false;
    }
  }, [url, jobId, phase, apply, setQueue]);

  const retry = useCallback(() => { setQueue((q) => q.map((w) => (w.state === "failed" ? { ...w, state: "waiting", error: null } : w))); setTimeout(pump, 0); }, [pump, setQueue]);
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [retry]);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const take = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > take.length) setError(`Only ${BEFORE_AFTER_LIMITS.perPhase} ${label.toLowerCase()} photos - the extra ones weren't added.`);
    for (const f of take) {
      try {
        const dataUrl = await resizePhoto(f);
        setQueue((q) => [...q, { key: nextKey.current++, dataUrl, state: "waiting", progress: 0, error: null }]);
      } catch { setError("Couldn't use that photo - try another."); }
    }
    setTimeout(pump, 0);
  }

  async function remove(id: string) {
    if (!confirm("Remove this photo?")) return;
    const r = await send(url, { hide: id }, () => {});
    if (r.status === 200) apply(r.body.photos); else setError(r.body.error ?? "Couldn't remove it - check your signal.");
  }

  const big = "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3.5 text-base font-semibold disabled:opacity-40";
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-base font-semibold text-gray-100">{label} photos</span>
        <span className="text-sm text-gray-500">{shown.length} of {BEFORE_AFTER_LIMITS.perPhase}</span>
      </div>
      {hint && shown.length === 0 && queue.length === 0 && <p className="mb-2 text-sm text-amber-300">{hint}</p>}
      {(shown.length > 0 || queue.length > 0) && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {shown.map((p) => (
            <span key={p.id} className="relative">
              <img src={`${url}?id=${encodeURIComponent(p.id)}`} alt={`${label} photo ${p.atLabel}`} className="aspect-square w-full rounded-lg object-cover" />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[11px] text-white">{p.atLabel}</span>
              <button className="absolute -right-1 -top-1 rounded-full bg-black/75 p-1 text-white" aria-label="Remove photo" onClick={() => remove(p.id)}><X size={14} /></button>
            </span>
          ))}
          {queue.map((w) => (
            <span key={w.key} className="relative">
              <img src={w.dataUrl} alt="" className={`aspect-square w-full rounded-lg object-cover ${w.state === "failed" ? "opacity-40" : "opacity-70"}`} />
              {w.state === "failed" ? (
                <span className="absolute inset-x-1 bottom-1 rounded bg-red-600/90 px-1 text-center text-[11px] text-white">{w.error}</span>
              ) : (
                <span className="absolute inset-x-1 bottom-1 h-1.5 overflow-hidden rounded bg-black/50"><span className="block h-full bg-brand-500" style={{ width: `${Math.round(w.progress * 100)}%` }} /></span>
              )}
              {w.state !== "failed" && <Loader2 size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />}
            </span>
          ))}
        </div>
      )}
      {queue.some((w) => w.state === "failed") && (
        <button className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-3 text-base font-semibold text-black" onClick={retry}><RotateCw size={18} /> Retry</button>
      )}
      <div className="flex gap-2">
        <button className={`${big} bg-brand-600 text-white`} disabled={room <= 0} onClick={() => camera.current?.click()}><Camera size={20} /> Take photo</button>
        <button className={`${big} border border-edge bg-panel2 text-gray-200`} disabled={room <= 0} onClick={() => gallery.current?.click()}><ImagePlus size={20} /> Gallery</button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <p className="mt-2 text-xs text-gray-500">Each photo saves as soon as it&apos;s sent.</p>
    </div>
  );
}
