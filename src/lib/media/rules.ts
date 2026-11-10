// Large uploads (Ilies, 10 Nov 2026, option A) - the plain rules: what may be uploaded where, how big, how it's split,
// the object key, the caps and the upload's states. No server or browser imports (the phone's uploader and the
// server's protocol both read this file); `npm test` (media.test.ts).
//
// The phone asks Operations to start (kind, type, size); Operations checks the link and the caps, records a
// MediaObject (PENDING) and hands back short-lived signed addresses for the private bucket. The phone sends the file
// straight there - one PUT up to 15 MB, otherwise 8 MB parts that can be resumed after a dropped signal - then says
// it's done. Operations checks the object itself (its size and first bytes, a video's length where it can read it):
// READY is shown, REJECTED is kept and never shown. Nothing is ever deleted (Ilies, 10 Nov 2026).

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export const KINDS = ["PHOTO", "VIDEO"] as const;
export type MediaKind = (typeof KINDS)[number];
export const AREAS = ["DAILY_LOG", "DELAY", "BEFORE_AFTER", "FAULT", "WALKAROUND", "HOUR_METER"] as const;
export type MediaArea = (typeof AREAS)[number];
export type MediaState = "PENDING" | "READY" | "REJECTED";

export const MEDIA_LIMITS = {
  photoMaxBytes: 25 * MB, // a full-quality phone photo - no more shrinking to 1600 px
  videoMaxBytes: 400 * MB, // 2 minutes of 1080p (4K is bigger - the phone is told to film in 1080p)
  videoMaxSec: 120, // what we tell people
  videoRefuseOverSec: 125, // what the phone refuses (a little slack for rounding)
  singlePutMax: 15 * MB, // up to this: one PUT; above: multipart
  partBytes: 8 * MB, // multipart part size (S3's minimum is 5 MB for all but the last)
  partBatch: 10, // signed part addresses handed out at a time (renewed as the phone goes)
  putTtlSec: 15 * 60, // a signed upload address lives 15 minutes (renewable)
  getTtlSec: 5 * 60, // a signed read address lives 5 minutes
  // Per link / sign-in / plant session, per Sydney day (every area together).
  perSourceDay: { items: 80, videos: 10, bytes: 4 * GB },
  companyDayBytes: 20 * GB, // every upload in the company, one Sydney day - the Admins are told once when it's reached
  pendingFreshMin: 30, // a PENDING upload this recent still holds its place in a set
  staleMultipartHours: 24, // an unfinished multipart upload older than this is aborted (only with MEDIA_ABORT_STALE=on - off by default)
} as const;

// What each area takes. Videos only where Ilies approved them (the site log, before / after, delays, faults); the
// walk-around and the hour meter stay photos, camera only.
export const AREA_RULES: Record<MediaArea, { kinds: readonly MediaKind[]; gallery: boolean }> = {
  DAILY_LOG: { kinds: KINDS, gallery: true },
  DELAY: { kinds: KINDS, gallery: true },
  BEFORE_AFTER: { kinds: KINDS, gallery: true },
  FAULT: { kinds: KINDS, gallery: true },
  WALKAROUND: { kinds: ["PHOTO"], gallery: false },
  HOUR_METER: { kinds: ["PHOTO"], gallery: false },
};

// How many of each the daily log screens take through the bucket (the old way stays 4 / 4 / 6).
export const LOG_MEDIA = {
  logPhotos: 12, logVideos: 3, // the day's photos on the log
  delayPhotos: 6, delayVideos: 2, // each delay
  setItems: 10, setVideos: 3, // each before / after set (photos + videos shown)
  setRows: 30, // every item a set has ever had, removed ones too
} as const;
export const FAULT_MEDIA = { videosPerSignIn: 3 } as const; // fault videos per sign-in / plant session

// The types each kind takes, with the extension the object key gets. HEIC is an iPhone photo.
export const MIME_EXT: Record<MediaKind, Record<string, string>> = {
  PHOTO: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" },
  VIDEO: { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" },
};
export const isKind = (x: unknown): x is MediaKind => x === "PHOTO" || x === "VIDEO";
export const isArea = (x: unknown): x is MediaArea => (AREAS as readonly unknown[]).includes(x);
export const extFor = (kind: MediaKind, mime: string): string | null => MIME_EXT[kind][mime] ?? null;
export const maxBytesFor = (kind: MediaKind) => (kind === "VIDEO" ? MEDIA_LIMITS.videoMaxBytes : MEDIA_LIMITS.photoMaxBytes);
// The phone's file type, cleaned: lower case, no parameters ("video/mp4; codecs=..." -> "video/mp4").
export const cleanMime = (x: unknown) => (typeof x === "string" ? x.split(";")[0].trim().toLowerCase() : "");

// ---------- the start request ----------

export type StartAsk = { kind: MediaKind; mime: string; ext: string; size: number; sha256: string | null; durationSec: number | null };
export type Refusal = { error: string; status: number };

export const TOO_LONG = `Videos can be up to ${MEDIA_LIMITS.videoMaxSec / 60} minutes - trim it or film a shorter one.`;
export const tooBig = (kind: MediaKind) =>
  kind === "VIDEO" ? `That video is too big (${MEDIA_LIMITS.videoMaxBytes / MB} MB at most) - film it in 1080p, not 4K.` : `That photo is too big (${MEDIA_LIMITS.photoMaxBytes / MB} MB at most).`;

// The phone's start request, checked for the area: the kind it takes, a type that kind takes, a size within its cap,
// a video no longer than 2 minutes (the phone reads its length before it starts - refused over 125 s).
export function parseStart(area: MediaArea, b: Record<string, unknown>): StartAsk | Refusal {
  if (!isKind(b.kind)) return { error: "Photo or video?", status: 400 };
  const kind = b.kind;
  if (!AREA_RULES[area].kinds.includes(kind)) return { error: "Only photos here.", status: 400 };
  const mime = cleanMime(b.mime);
  const ext = extFor(kind, mime);
  if (!ext) return { error: kind === "VIDEO" ? "That video type can't be sent - use the phone's camera app (MP4 or MOV)." : "That photo type can't be sent (JPEG, PNG, WebP or HEIC).", status: 415 };
  const size = typeof b.size === "number" && Number.isInteger(b.size) ? b.size : NaN;
  if (!(size > 0)) return { error: "That file is empty.", status: 400 };
  if (size > maxBytesFor(kind)) return { error: tooBig(kind), status: 413 };
  const sha256 = typeof b.sha256 === "string" && /^[0-9a-f]{64}$/.test(b.sha256) ? b.sha256 : null;
  let durationSec: number | null = null;
  if (kind === "VIDEO") {
    const d = typeof b.durationSec === "number" && Number.isFinite(b.durationSec) ? b.durationSec : NaN;
    if (!(d > 0)) return { error: "Couldn't read how long that video is - try again, or film it again.", status: 400 };
    if (!videoLengthOk(d)) return { error: TOO_LONG, status: 413 };
    durationSec = Math.round(d * 10) / 10;
  }
  return { kind, mime, ext, size, sha256, durationSec };
}
export const videoLengthOk = (sec: number) => Number.isFinite(sec) && sec > 0 && sec <= MEDIA_LIMITS.videoRefuseOverSec;

// ---------- splitting the file ----------

// One PUT up to 15 MB; otherwise 8 MB parts (the last one smaller). S3 allows 10,000 parts - 400 MB is 50.
export function planUpload(size: number): { multipart: boolean; partCount: number; partBytes: number } {
  if (size <= MEDIA_LIMITS.singlePutMax) return { multipart: false, partCount: 1, partBytes: size };
  return { multipart: true, partCount: Math.ceil(size / MEDIA_LIMITS.partBytes), partBytes: MEDIA_LIMITS.partBytes };
}
// The byte range of part n (1-based) - the phone slices the file with it.
export function partRange(size: number, n: number): { start: number; end: number } {
  const start = (n - 1) * MEDIA_LIMITS.partBytes;
  return { start, end: Math.min(size, start + MEDIA_LIMITS.partBytes) };
}
// The next parts to hand out addresses for: the first `batch` part numbers not done yet.
export function nextPartNumbers(partCount: number, done: number[], batch: number = MEDIA_LIMITS.partBatch): number[] {
  const have = new Set(done);
  const out: number[] = [];
  for (let n = 1; n <= partCount && out.length < batch; n++) if (!have.has(n)) out.push(n);
  return out;
}
// Every part there, in order, each but the last a full part and the last the rest: what Complete will be sent with.
export function partsComplete(size: number, partCount: number, parts: { n: number; size: number }[]): boolean {
  if (parts.length !== partCount) return false;
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  return sorted.every((p, i) => p.n === i + 1 && p.size === partRange(size, p.n).end - partRange(size, p.n).start);
}

// ---------- the object key ----------

// <area>/<yyyy>/<mm>/<random>.<ext> - made on the server only (the phone never chooses one). Sydney's month.
export function objectKey(area: MediaArea, ext: string, now: Date, random: string): string {
  if (!/^[a-f0-9]{32}$/.test(random)) throw new Error("bad key random");
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error("bad key extension");
  const [yyyy, mm] = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit" }).format(now).split("-");
  return `${area.toLowerCase().replace(/_/g, "-")}/${yyyy}/${mm}/${random}.${ext}`;
}
export const KEY_PATTERN = /^[a-z-]+\/\d{4}\/\d{2}\/[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

// ---------- the caps ----------

export type SourceDay = { items: number; videos: number; bytes: number };
// Over the link's / sign-in's day, or the company's day, with this upload added?
export function capRefusal(kind: MediaKind, size: number, source: SourceDay, companyBytes: number): (Refusal & { ceiling?: true }) | null {
  const L = MEDIA_LIMITS;
  if (companyBytes + size > L.companyDayBytes) return { error: "Today's upload limit for the company is reached - the office knows. Try again tomorrow, or call the office.", status: 429, ceiling: true };
  if (source.items + 1 > L.perSourceDay.items) return { error: "That's the most this link can send in a day - call the office.", status: 429 };
  if (kind === "VIDEO" && source.videos + 1 > L.perSourceDay.videos) return { error: "That's the most videos this link can send in a day - call the office.", status: 429 };
  if (source.bytes + size > L.perSourceDay.bytes) return { error: "That's the most this link can send in a day - call the office.", status: 429 };
  return null;
}
// The 24 h abort of unfinished multipart uploads (protocol.ts abortStaleMultipart) - OFF unless MEDIA_ABORT_STALE=on.
export const abortStaleOn = (env: Record<string, string | undefined> = process.env) => (env.MEDIA_ABORT_STALE ?? "").trim().toLowerCase() === "on";
export const ceilingReached = (companyBytes: number) => companyBytes >= MEDIA_LIMITS.companyDayBytes;
export const ceilingNotice = () => ({
  title: "Upload limit reached for today",
  body: `Site photos and videos have reached ${MEDIA_LIMITS.companyDayBytes / GB} GB today - new uploads are refused until midnight. Urgent / Do-not-use faults can still go without a photo.`,
});

// ---------- the upload's states ----------

// PENDING -> READY (the checks passed and the area took it) or REJECTED (a check failed, or the area was full by the
// time it finished). READY and REJECTED are final: a second "done" gives the same answer and changes nothing.
export type MediaEvent = "VERIFIED" | "FAILED";
export function nextState(state: MediaState, event: MediaEvent): MediaState {
  if (state !== "PENDING") return state;
  return event === "VERIFIED" ? "READY" : "REJECTED";
}
export const isFinal = (s: string) => s === "READY" || s === "REJECTED";

// The phone's mobile-data note before a video goes: "about N MB".
export function dataNote(bytes: number): string {
  const mb = bytes / MB;
  return `This video is about ${mb < 10 ? Math.max(1, Math.round(mb * 10) / 10) : Math.round(mb)} MB - best sent on Wi-Fi if you're on mobile data.`;
}

// For the phone: the bucket is on, and the limits it should know before it starts.
export function phoneConfig(kinds: readonly MediaKind[]) {
  return {
    on: true as const, kinds,
    photoMaxBytes: MEDIA_LIMITS.photoMaxBytes, videoMaxBytes: MEDIA_LIMITS.videoMaxBytes, videoMaxSec: MEDIA_LIMITS.videoMaxSec, videoRefuseOverSec: MEDIA_LIMITS.videoRefuseOverSec,
  };
}
export type PhoneMediaConfig = ReturnType<typeof phoneConfig>;

// "media:<id>" - how a bucket upload is named wherever a stored photo file name used to go (DailyLog photoIds,
// SiteLogPhoto / AssetFaultMedia fileName). savePhoto names ("<digits>-<hex>.jpg") and data URLs never look like this.
export const MEDIA_REF = "media:";
export const mediaRef = (id: string) => `${MEDIA_REF}${id}`;
export function mediaIdOf(name: unknown): string | null {
  if (typeof name !== "string" || !name.startsWith(MEDIA_REF)) return null;
  const id = name.slice(MEDIA_REF.length);
  return /^[a-z0-9]{10,40}$/.test(id) ? id : null;
}

// A download's file name: "site-video-2026-11-10.mp4" - never the object key, never a person's name.
export function downloadName(kind: MediaKind, ext: string, at: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(at);
  return `site-${kind === "VIDEO" ? "video" : "photo"}-${day}.${/^[a-z0-9]{2,5}$/.test(ext) ? ext : "bin"}`;
}
