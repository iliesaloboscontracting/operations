// Large uploads (10 Nov 2026) - the storage behind them, behind one interface:
//   - the real bucket (S3 API, Lightsail object storage lobos-ops-media, ap-southeast-2) - ./s3.ts. Outbound
//     connection #8: the only host is <bucket>.s3.ap-southeast-2.amazonaws.com (allowlist in ./s3.ts).
//   - a local fake (a folder + a tiny HTTP stub on 127.0.0.1) - ./fake.ts - for `next dev` and the release check, so
//     the whole flow is tested with no keys and no outside call.
// OFF (the old upload paths only, exactly as before) unless the bucket's four MEDIA_* settings are all there - or
// MEDIA_STORE=fake with MEDIA_FAKE_DIR. MEDIA_UPLOADS=off turns it off either way (the kill switch).
// The keys are read here and passed to the S3 client only - never logged, never sent to a browser.

export type UploadPartRef = { n: number; etag: string; size: number };
export type HeadResult = { size: number; contentType: string | null; versionId: string | null };

export interface MediaStore {
  readonly name: "s3" | "fake";
  // A signed PUT for the whole object (one part), Content-Type and Content-Length pinned (PS-043).
  presignPut(key: string, mime: string, bytes: number, ttlSec: number): Promise<string>;
  createMultipart(key: string, mime: string): Promise<string>; // -> uploadId
  presignPart(key: string, uploadId: string, n: number, bytes: number, ttlSec: number): Promise<string>; // the part's exact length signed (PS-043)
  listParts(key: string, uploadId: string): Promise<UploadPartRef[]>; // throws NoSuchUpload as MediaStoreError code NO_UPLOAD
  completeMultipart(key: string, uploadId: string, parts: UploadPartRef[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  head(key: string): Promise<HeadResult | null>; // null = not there
  getRange(key: string, versionId: string | null, start: number, endInclusive: number): Promise<Uint8Array>;
  // A signed GET of that version, with the type and (download) the file name to save it as.
  presignGet(key: string, versionId: string | null, ttlSec: number, o: { mime: string; download?: string | null }): Promise<string>;
  // PS-043's daily usage watch: every version of every object, and the unfinished multipart uploads (with their parts' size).
  listVersions(): Promise<{ key: string; versionId: string | null; size: number }[]>;
  listUploads(): Promise<{ key: string; uploadId: string; bytes: number }[]>;
}

// A failed store call - with no address, key or secret in the message (they're never logged).
export class MediaStoreError extends Error {
  constructor(public op: string, public code: string) { super(`media store ${op} failed (${code})`); }
}

export type MediaStatus = { on: true; store: "s3" | "fake" } | { on: false; reason: "KILL_SWITCH" | "NOT_SET_UP" | "BAD_SETTINGS" };

export const MEDIA_REGION = "ap-southeast-2"; // Sydney - the bucket's region; anything else is refused
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/; // no dots (they break the bucket's TLS name)

// o.read: for showing what's already uploaded - the kill switch stops new uploads only, never the reading of old ones.
export function mediaStatus(env: Record<string, string | undefined> = process.env, o: { read?: boolean } = {}): MediaStatus {
  if (!o.read && (env.MEDIA_UPLOADS ?? "").trim().toLowerCase() === "off") return { on: false, reason: "KILL_SWITCH" };
  if (env.MEDIA_STORE === "fake") return env.MEDIA_FAKE_DIR ? { on: true, store: "fake" } : { on: false, reason: "BAD_SETTINGS" };
  const set = [env.MEDIA_BUCKET, env.MEDIA_REGION, env.MEDIA_ACCESS_KEY_ID, env.MEDIA_SECRET_ACCESS_KEY].filter((v) => !!v && v.trim()).length;
  if (set === 0) return { on: false, reason: "NOT_SET_UP" };
  if (set < 4 || !BUCKET_NAME.test(env.MEDIA_BUCKET!.trim()) || env.MEDIA_REGION!.trim() !== MEDIA_REGION) return { on: false, reason: "BAD_SETTINGS" };
  return { on: true, store: "s3" };
}
export const mediaOn = () => mediaStatus().on;

// The store, made once per process (globalThis, so every route bundle shares it). null when OFF.
const g = globalThis as unknown as { __mediaStore?: { sig: string; store: MediaStore } };
export async function getMediaStore(o: { read?: boolean } = {}): Promise<MediaStore | null> {
  const st = mediaStatus(process.env, o);
  if (!st.on) return null;
  const sig = st.store === "fake" ? `fake|${process.env.MEDIA_FAKE_DIR}` : `s3|${process.env.MEDIA_BUCKET}`;
  if (g.__mediaStore?.sig === sig) return g.__mediaStore.store;
  const store: MediaStore = st.store === "fake"
    ? new (await import("./fake")).FakeMediaStore(process.env.MEDIA_FAKE_DIR!)
    : await (await import("./s3")).makeS3Store({
      bucket: process.env.MEDIA_BUCKET!.trim(), accessKeyId: process.env.MEDIA_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.MEDIA_SECRET_ACCESS_KEY!.trim(),
    });
  g.__mediaStore = { sig, store };
  return store;
}
