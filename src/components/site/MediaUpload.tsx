"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Pause, Play, RotateCw, Video, X } from "lucide-react";
import { forget, remembered, resumeMedia, uploadMedia, UploadError, type MediaEndpoints, type Remembered, type UploadResult } from "@/lib/media/client";
import { dataNote, MB, type MediaKind } from "@/lib/media/rules";

// The phone's large-upload buttons and queue (Ilies, 10 Nov 2026) - shared by the daily log (the day's photos, delays,
// before / after) and pre-start faults. Camera (photo / video) and gallery as the area allows; each file goes straight
// to the bucket at full quality (lib/media/client.ts) with a progress bar, Pause / Resume, retry by itself on a lost
// signal, and - for the daily log (`tag`) - "Resume" after the page is closed and opened again. A video says how big it
// is before it goes ("about N MB" - mobile data). One at a time, in order. No money anywhere.

type Item = {
  key: number; file?: Blob; name: string; kind: MediaKind; size: number; preview: string | null; mediaId: string | null;
  state: "waiting" | "sending" | "paused" | "failed"; progress: number; error: string | null; resumeOnly?: Remembered;
};
const kindOf = (f: File): MediaKind => ((f.type || "").startsWith("video/") || /\.(mp4|mov|webm)$/i.test(f.name) ? "VIDEO" : "PHOTO");

export default function MediaUpload({ api, fields, kinds, gallery = true, room, tag, onDone, onError, compact = false, busyChange, fallback }: {
  api: MediaEndpoints; fields: Record<string, unknown>; kinds: readonly MediaKind[]; gallery?: boolean;
  room: { items: number; videos: number }; // how many more this place takes (photos + videos, and of them videos)
  tag?: string; // remember uploads under this tag so they can be resumed after the page is opened again
  onDone: (r: UploadResult) => void; onError?: (e: UploadError) => void; compact?: boolean;
  busyChange?: (busy: boolean) => void; // something is still uploading (the screen may hold its Send)
  // PS-044: when the bucket refuses a PHOTO with fallback (the company's day is full), send it the old way instead.
  fallback?: (file: File) => Promise<UploadResult>;
}) {
  const [items, setItemsState] = useState<Item[]>([]);
  const ref = useRef<Item[]>([]);
  const setItems = useCallback((f: (q: Item[]) => Item[]) => { ref.current = f(ref.current); setItemsState(ref.current); }, []);
  const ctrl = useRef<Map<number, AbortController>>(new Map());
  const pumping = useRef(false);
  const nextKey = useRef(1);
  const [error, setError] = useState<string | null>(null);
  const photoCam = useRef<HTMLInputElement>(null), videoCam = useRef<HTMLInputElement>(null), pick = useRef<HTMLInputElement>(null);
  const patch = useCallback((key: number, p: Partial<Item>) => setItems((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x))), [setItems]);
  const live = items.filter((x) => x.state !== "failed");
  const roomItems = room.items - live.length;
  const roomVideos = room.videos - live.filter((x) => x.kind === "VIDEO").length;

  useEffect(() => { busyChange?.(items.some((x) => x.state === "waiting" || x.state === "sending")); }, [items, busyChange]);

  // Uploads that didn't finish before the page was closed (daily log only).
  useEffect(() => {
    if (!tag) return;
    remembered(tag).then((rs) => {
      if (!rs.length) return;
      setItems((q) => [...q, ...rs.filter((r) => !q.some((x) => x.mediaId === r.mediaId)).map((r): Item => ({
        key: nextKey.current++, file: r.file, name: r.name, kind: r.kind, size: r.size, preview: null, mediaId: r.mediaId, state: "paused", progress: 0,
        error: "Didn't finish - tap Resume.", resumeOnly: r,
      }))]);
    }).catch(() => undefined);
  }, [tag, setItems]);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const it = ref.current.find((x) => x.state === "waiting");
        if (!it) break;
        const c = new AbortController();
        ctrl.current.set(it.key, c);
        patch(it.key, { state: "sending", error: null });
        const onProgress = (p: number) => patch(it.key, { progress: p });
        try {
          const r = it.mediaId && it.file
            ? await resumeMedia({ api, mediaId: it.mediaId, kind: it.kind, file: it.file }, onProgress, c.signal)
            : await uploadMedia({ api, file: it.file!, kind: it.kind, fields, onProgress, signal: c.signal, tag, onStarted: (id) => patch(it.key, { mediaId: id }) });
          setItems((q) => q.filter((x) => x.key !== it.key));
          if (it.preview) URL.revokeObjectURL(it.preview);
          onDone(r);
        } catch (e) {
          const u = e instanceof UploadError ? e : new UploadError("That didn't send.", 0, {}, true);
          if (u.body.fallback && fallback && it.kind === "PHOTO" && it.file) {
            try {
              const r = await fallback(it.file as File);
              setItems((q) => q.filter((x) => x.key !== it.key));
              onDone(r);
              continue;
            } catch (f) { u.message = f instanceof Error ? f.message : u.message; }
          }
          if (c.signal.aborted) patch(it.key, { state: "paused", error: null });
          else if (u.retryable) patch(it.key, { state: "failed", error: u.status === 0 ? "Didn't send - no signal? Tap Retry." : u.message });
          else {
            setItems((q) => q.filter((x) => x.key !== it.key));
            if (it.mediaId) await forget(it.mediaId);
            setError(u.message);
            onError?.(u);
          }
        } finally {
          ctrl.current.delete(it.key);
        }
      }
    } finally {
      pumping.current = false;
    }
  }, [api, fields, tag, onDone, onError, patch, setItems, fallback]);

  useEffect(() => {
    const again = () => { setItems((q) => q.map((x) => (x.state === "failed" ? { ...x, state: "waiting", error: null } : x))); setTimeout(pump, 0); };
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [pump, setItems]);

  function add(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    let items = roomItems, videos = roomVideos;
    const skipped: string[] = [];
    const fresh: Item[] = [];
    for (const f of Array.from(files)) {
      const kind = kindOf(f);
      if (!kinds.includes(kind)) { skipped.push(kind === "VIDEO" ? "videos aren't taken here" : "that file isn't a photo"); continue; }
      if (items <= 0 || (kind === "VIDEO" && videos <= 0)) { skipped.push("no room for more"); continue; }
      items--; if (kind === "VIDEO") videos--;
      fresh.push({ key: nextKey.current++, file: f, name: f.name, kind, size: f.size, preview: kind === "PHOTO" ? URL.createObjectURL(f) : null, mediaId: null, state: "waiting", progress: 0, error: null });
    }
    if (skipped.length) setError(`Some weren't added - ${[...new Set(skipped)].join(", ")}.`);
    setItems((q) => [...q, ...fresh]);
    setTimeout(pump, 0);
  }
  const pause = (key: number) => ctrl.current.get(key)?.abort();
  const resume = (key: number) => { patch(key, { state: "waiting", error: null }); setTimeout(pump, 0); };
  const drop = async (it: Item) => {
    if (it.state === "sending") ctrl.current.get(it.key)?.abort();
    setItems((q) => q.filter((x) => x.key !== it.key));
    if (it.mediaId) await forget(it.mediaId);
  };

  const btn = compact
    ? "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold disabled:opacity-40"
    : "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3.5 text-base font-semibold disabled:opacity-40";
  const canPhoto = kinds.includes("PHOTO") && roomItems > 0;
  const canVideo = kinds.includes("VIDEO") && roomItems > 0 && roomVideos > 0;
  const accept = [kinds.includes("PHOTO") ? "image/*" : "", kinds.includes("VIDEO") ? "video/*" : ""].filter(Boolean).join(",");
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className={`flex items-center gap-2 rounded-lg border p-1.5 ${it.state === "failed" ? "border-red-500/50" : "border-edge"} bg-panel2`}>
              {it.preview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={it.preview} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-black/40 text-gray-300">{it.kind === "VIDEO" ? <Video size={20} /> : <ImagePlus size={20} />}</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-gray-300">{it.kind === "VIDEO" ? "Video" : "Photo"} · {it.size >= MB ? `${Math.round(it.size / MB)} MB` : `${Math.max(1, Math.round(it.size / 1024))} KB`}</div>
                {it.state === "failed" || it.error
                  ? <div className={`text-[11px] ${it.state === "failed" ? "text-red-300" : "text-amber-300"}`}>{it.error}</div>
                  : <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/50"><div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>}
                {it.kind === "VIDEO" && it.state !== "failed" && !it.error && <div className="text-[11px] text-gray-500">{dataNote(it.size)}</div>}
              </div>
              {it.state === "sending" && <button aria-label="Pause" className="rounded-lg bg-black/40 p-2 text-gray-200" onClick={() => pause(it.key)}><Pause size={16} /></button>}
              {it.state === "paused" && <button aria-label="Resume" className="flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-2 text-xs font-semibold text-white" onClick={() => resume(it.key)}><Play size={14} /> Resume</button>}
              {it.state === "failed" && <button aria-label="Retry" className="flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-2 text-xs font-semibold text-black" onClick={() => resume(it.key)}><RotateCw size={14} /> Retry</button>}
              {it.state === "waiting" && <Loader2 size={16} className="animate-spin text-gray-400" />}
              {it.state !== "sending" && <button aria-label="Remove" className="rounded-full bg-black/60 p-1 text-white" onClick={() => drop(it)}><X size={12} /></button>}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {kinds.includes("PHOTO") && <button type="button" className={`${btn} bg-brand-600 text-white`} disabled={!canPhoto} onClick={() => photoCam.current?.click()}><Camera size={compact ? 16 : 20} /> Take photo</button>}
        {kinds.includes("VIDEO") && <button type="button" className={`${btn} bg-brand-700 text-white`} disabled={!canVideo} onClick={() => videoCam.current?.click()}><Video size={compact ? 16 : 20} /> Record video</button>}
        {gallery && <button type="button" className={`${btn} border border-edge bg-panel text-gray-200`} disabled={!canPhoto && !canVideo} onClick={() => pick.current?.click()}><ImagePlus size={compact ? 16 : 20} /> Gallery</button>}
      </div>
      <input ref={photoCam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={videoCam} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {gallery && <input ref={pick} type="file" accept={accept} multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />}
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
      {kinds.includes("VIDEO") && <p className="mt-1 text-[11px] text-gray-500">Videos up to 2 minutes. Full-quality photos and videos keep sending if the signal drops - Pause any time.</p>}
    </div>
  );
}
