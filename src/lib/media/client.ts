// Large uploads (10 Nov 2026) - the phone's side of the upload protocol (browser only; no server code, no SDK).
// Ask Operations to start -> send the file straight to the bucket with the signed addresses (one PUT, or 8 MB parts) ->
// say it's done. Each part is retried by itself (3 tries, then it waits for the signal to come back); a part's address
// that has run out is renewed from /parts; "Pause" stops the transfer and "Resume" asks the server which parts the
// bucket already has and carries on from there. A daily-log upload is also remembered on the phone (IndexedDB - the
// file and where it was going) so it can be resumed after the page is closed and opened again. Every use of storage
// is wrapped in try/catch: with no storage it just can't resume after a reload.
import { MEDIA_LIMITS, partRange, type MediaKind } from "./rules";

export type MediaEndpoints = { start: string; parts: string; complete: string; headers?: Record<string, string> };
export type UploadResult = { mediaId: string; kind: MediaKind; body: Record<string, unknown> };
export class UploadError extends Error {
  constructor(public message: string, public status: number, public body: Record<string, unknown> = {}, public retryable = false) { super(message); }
}
type Batch = { mediaId: string; multipart: boolean; put?: { url: string; contentType: string }; urls?: { n: number; url: string }[]; done?: { n: number; etag: string }[]; uploaded?: boolean };

// ---------- small helpers ----------

async function post(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(headers ?? {}) }, body: JSON.stringify(body), cache: "no-store" });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new UploadError("Paused", 0, {}, true)); }, { once: true });
});
// Waits for the phone to be back online (or a short while, in case the browser never says so).
const backOnline = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (typeof navigator === "undefined" || navigator.onLine) return resolve();
  const done = () => { window.removeEventListener("online", done); clearTimeout(t); resolve(); };
  const t = setTimeout(done, 30_000);
  window.addEventListener("online", done);
  signal?.addEventListener("abort", () => { window.removeEventListener("online", done); clearTimeout(t); reject(new UploadError("Paused", 0, {}, true)); }, { once: true });
});

// One PUT with upload progress (XMLHttpRequest - fetch can't report it). -> the ETag, or a status (0 = no signal).
function putBlob(url: string, blob: Blob, contentType: string | null, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<{ status: number; etag: string | null }> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    if (contentType) x.setRequestHeader("Content-Type", contentType);
    x.timeout = 10 * 60_000;
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => resolve({ status: x.status, etag: x.getResponseHeader("ETag") });
    x.onerror = x.ontimeout = x.onabort = () => resolve({ status: 0, etag: null });
    signal?.addEventListener("abort", () => x.abort(), { once: true });
    x.send(blob);
  });
}

// A video's length in seconds, read on the phone before anything is sent (refused over 125 s).
export function videoDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      const end = (d: number | null) => { URL.revokeObjectURL(url); v.removeAttribute("src"); resolve(d); };
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => end(Number.isFinite(v.duration) ? v.duration : null);
      v.onerror = () => end(null);
      setTimeout(() => end(null), 15_000);
      v.src = url;
    } catch { resolve(null); }
  });
}
// The file's SHA-256 (photos only - a 400 MB video isn't read into memory for it). null where the browser can't.
async function sha256Of(file: Blob): Promise<string | null> {
  try {
    if (file.size > MEDIA_LIMITS.photoMaxBytes || !globalThis.crypto?.subtle) return null;
    const d = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
// The type to declare: the browser's, or from the extension (some phones give a video no type).
export function mimeOf(file: File): string {
  const t = (file.type || "").toLowerCase();
  if (t) return t;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext] ?? "";
}

// ---------- remembered uploads (resume after the page is opened again) ----------

export type Remembered = { mediaId: string; api: MediaEndpoints; kind: MediaKind; name: string; size: number; tag: string; at: number; file: Blob };
const DB = "lobos-media-uploads";
function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("up", { keyPath: "mediaId" }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = f(d.transaction("up", mode).objectStore("up"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
export const remember = (r: Remembered) => tx("readwrite", (s) => s.put(r)).catch(() => null);
export const forget = (mediaId: string) => tx("readwrite", (s) => s.delete(mediaId)).catch(() => null);
// The uploads still to finish whose tag starts with `prefix` (e.g. "<link api>|<job>|BEFORE_AFTER|AFTER"). Older than a
// day: their addresses and the server's record have moved on - left for the server, not offered.
export async function remembered(prefix: string): Promise<Remembered[]> {
  const all = ((await tx("readonly", (s) => s.getAll()).catch(() => null)) ?? []) as Remembered[];
  return all.filter((r) => r.tag.startsWith(prefix) && Date.now() - r.at < 24 * 3600_000).sort((a, b) => a.at - b.at);
}

// ---------- the upload ----------

export type UploadOpts = {
  api: MediaEndpoints; file: File | Blob; kind: MediaKind; fields?: Record<string, unknown>;
  onProgress?: (fraction: number) => void; signal?: AbortSignal;
  tag?: string; // remember it under this tag (resume after reopening) - daily-log uploads only
  onStarted?: (mediaId: string) => void; // the server made the record - Pause / Resume can carry on from it
};

export async function uploadMedia(o: UploadOpts): Promise<UploadResult> {
  const file = o.file as File;
  const mime = mimeOf(file);
  const durationSec = o.kind === "VIDEO" ? await videoDuration(file) : null;
  if (o.kind === "VIDEO") {
    if (durationSec == null) throw new UploadError("Couldn't read how long that video is - try another, or film it again.", 400);
    if (durationSec > MEDIA_LIMITS.videoRefuseOverSec) throw new UploadError(`Videos can be up to ${MEDIA_LIMITS.videoMaxSec / 60} minutes - trim it or film a shorter one.`, 413);
  }
  const sha256 = o.kind === "PHOTO" ? await sha256Of(file) : null;
  const s = await post(o.api.start, { ...(o.fields ?? {}), kind: o.kind, mime, size: file.size, sha256, durationSec }, o.api.headers);
  if (s.status !== 201) throw new UploadError(typeof s.body.error === "string" ? s.body.error : s.status === 0 ? "Didn't start - no signal?" : "Couldn't start the upload.", s.status, s.body, s.status === 0 || s.status >= 500);
  const first = s.body as unknown as Batch;
  o.onStarted?.(first.mediaId);
  if (o.tag) await remember({ mediaId: first.mediaId, api: o.api, kind: o.kind, name: (file as File).name ?? "", size: file.size, tag: o.tag, at: Date.now(), file });
  return carryOn(o.api, first.mediaId, o.kind, file, first, o.onProgress, o.signal);
}

// Carry on with an upload already started: from a fresh /parts answer (resume), or the start's.
export async function resumeMedia(r: Pick<Remembered, "api" | "mediaId" | "kind" | "file">, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<UploadResult> {
  return carryOn(r.api, r.mediaId, r.kind, r.file, null, onProgress, signal);
}

async function carryOn(api: MediaEndpoints, mediaId: string, kind: MediaKind, file: Blob, first: Batch | null, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<UploadResult> {
  const total = file.size;
  const sent = new Map<number, number>(); // part -> bytes sent (for the bar)
  const report = () => onProgress?.(Math.min(0.99, [...sent.values()].reduce((a, b) => a + b, 0) / total));
  const renew = async (): Promise<Batch> => {
    for (let i = 0; ; i++) {
      if (signal?.aborted) throw new UploadError("Paused", 0, {}, true);
      const r = await post(api.parts, { mediaId }, api.headers);
      if (r.status === 200) return r.body as unknown as Batch;
      if (r.status === 409 && r.body.state === "READY") return { mediaId, multipart: false, uploaded: true };
      if (r.status !== 0 && r.status < 500) throw new UploadError(typeof r.body.error === "string" ? r.body.error : "That upload can't carry on - start it again.", r.status, r.body);
      if (i >= 2) await backOnline(signal);
      await sleep(Math.min(15_000, 1000 * 2 ** i), signal);
    }
  };
  let batch = first ?? (await renew());
  let refused = 0; // a fresh address refused again and again = not an expiry - stop
  const expiredAgain = () => { if (++refused > 3) throw new UploadError("The store refused the upload - try again later.", 403); };
  for (let round = 0; round < 500; round++) {
    if (signal?.aborted) throw new UploadError("Paused", 0, {}, true);
    if (!batch.multipart) {
      if (!batch.uploaded && batch.put) {
        const r = await putWithRetry(batch.put.url, file, batch.put.contentType, (n) => { sent.set(1, n); report(); }, signal);
        if (r === "EXPIRED") { expiredAgain(); batch = await renew(); continue; }
      }
    } else {
      for (const d of batch.done ?? []) sent.set(d.n, partRange(total, d.n).end - partRange(total, d.n).start);
      report();
      let expired = false;
      for (const { n, url } of batch.urls ?? []) {
        const { start, end } = partRange(total, n);
        const r = await putWithRetry(url, file.slice(start, end), null, (b) => { sent.set(n, b); report(); }, signal);
        if (r === "EXPIRED") { expiredAgain(); expired = true; break; }
      }
      if (expired || (batch.urls?.length ?? 0) > 0) { batch = await renew(); if (batch.multipart && (batch.urls?.length ?? 0) > 0) continue; }
    }
    // Everything sent - ask the server to check it.
    const c = await post(api.complete, { mediaId }, api.headers);
    if (c.status === 200) { onProgress?.(1); await forget(mediaId); return { mediaId, kind, body: c.body }; }
    if (c.status === 409 && c.body.missing) { batch = await renew(); continue; }
    if (c.status === 409 && c.body.busy) { await sleep(2000, signal); continue; }
    if (c.status === 0 || c.status >= 500) { await backOnline(signal); await sleep(2000, signal); continue; }
    if (c.status === 422) await forget(mediaId); // refused for good - kept on the server, never shown
    throw new UploadError(typeof c.body.error === "string" ? c.body.error : "That wasn't saved.", c.status, c.body);
  }
  throw new UploadError("That upload didn't finish - try again.", 0, {}, true);
}

// One PUT, retried by itself: 3 quick tries, then it waits for the signal. 403 = the address ran out -> renew.
async function putWithRetry(url: string, blob: Blob, contentType: string | null, onBytes: (n: number) => void, signal?: AbortSignal): Promise<"OK" | "EXPIRED"> {
  for (let i = 0; ; i++) {
    if (signal?.aborted) throw new UploadError("Paused", 0, {}, true);
    const r = await putBlob(url, blob, contentType, onBytes, signal);
    if (r.status >= 200 && r.status < 300) { onBytes(blob.size); return "OK"; }
    if (signal?.aborted) throw new UploadError("Paused", 0, {}, true);
    if (r.status === 403) return "EXPIRED";
    onBytes(0);
    if (i >= 2) await backOnline(signal);
    await sleep(Math.min(20_000, 1000 * 2 ** i), signal);
  }
}
