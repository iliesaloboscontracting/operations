// Large uploads (10 Nov 2026) - the one upload protocol every area uses, server side:
//   start    -> the caller (a supervisor link, a truck sign-in, a plant session) and the area's own rules are checked,
//               the caps counted, a MediaObject made (PENDING) with a key made here, and signed addresses handed back:
//               one PUT (up to 15 MB) or a multipart upload's first batch of 8 MB part addresses (15 minutes each).
//   parts    -> resume / renew: which parts the bucket already has (ListParts, asked by the server) and addresses for the
//               next missing ones. For a one-PUT upload: whether it's there, else a fresh address.
//   complete -> the multipart is completed from the bucket's own part list, then the object is CHECKED: its size (HEAD,
//               exactly what was declared and within the cap), its first bytes (a photo / video of the declared type)
//               and an MP4 / MOV's length where its header can be read. A failed check = REJECTED (kept, never shown).
//               Then the area takes it (a before / after photo, a fault photo...) - or refuses it (full by now) =
//               REJECTED too. READY is final; a second complete gives the same answer.
// Each route (lib/dailyLog/media.ts, lib/prestart/media.ts) brings a Party: who's asking, what they own, the area's
// start checks and what READY makes. Nothing is ever deleted (Ilies, 10 Nov 2026) - PENDING uploads that are never
// finished stay PENDING. Never logs a key, an address or a secret.
import { randomBytes } from "crypto";
import { prisma } from "../prisma";
import { fromSydneyLocal } from "../shiftTimes";
import { todaySydney } from "../today";
import { pushToAdmins } from "../push";
import type { MediaObject } from "@prisma/client";
import {
  MEDIA_LIMITS, PENDING_FULL, TOO_LONG, abortStaleOn, capRefusal, ceilingNotice, ceilingReached, countedBytes, dayTotals, isFinal, maxBytesFor, nextPartNumbers, objectKey, parseStart,
  partRange, partsComplete, planUpload,
  type MediaArea, type MediaKind, type Refusal, type StartAsk,
} from "./rules";
import { matchesClaim, mp4DurationSec } from "./magic";
import { getMediaStore, MediaStoreError, type MediaStore } from "./store";

export type { MediaObject };
export type Source = { siteLinkId?: string | null; attendanceId?: string | null; sessionId?: string | null; deviceId?: string | null; takenBy: string };
// The row fields an area sets at the start (who / what it's for).
export type OwnerFields = Partial<Pick<MediaObject, "jobId" | "phase" | "slot" | "checkKind" | "resourceId" | "faultId">>;
export type Attached = { linkedId?: string | null; reply: Record<string, unknown> };
export type AreaRefusal = { refuse: Refusal & Record<string, unknown>; reason: string };
export type Party = {
  source: Source;
  owns(row: MediaObject): boolean;
  // The area's own checks for a new upload (the job, the set, the check...). -> the area and the row's owner fields.
  prepare(body: Record<string, unknown>, kind: MediaKind | null): Promise<{ area: MediaArea; fields: OwnerFields; extra?: (ask: StartAsk) => Promise<Refusal | null> } | (Refusal & Record<string, unknown>)>;
  // The object passed its checks: make the area's own record (or refuse - full by now).
  attach(row: MediaObject): Promise<Attached | AreaRefusal>;
  // A READY upload asked about again: the same reply as when it was attached.
  replyFor(row: MediaObject): Promise<Record<string, unknown>>;
};
export type Reply = { status: number; body: Record<string, unknown> };
const fail = (r: Refusal & Record<string, unknown>): Reply => { const { status, ...body } = r; return { status, body }; };
const OFF: Reply = { status: 404, body: { error: "Large uploads aren't switched on - use the photo button." } };

const sydneyMidnight = () => fromSydneyLocal(`${todaySydney()}T00:00`) ?? new Date(Date.now() - 24 * 3600_000);
const sourceWhere = (s: Source) =>
  s.siteLinkId ? { siteLinkId: s.siteLinkId } : s.attendanceId ? { attendanceId: s.attendanceId } : s.sessionId ? { sessionId: s.sessionId } : { id: "-none-" };

// One start at a time on this server: the row is made and the caps counted together, so a burst can't all slip under.
// PS-046: the queue and the "being completed" set live on globalThis - every route bundle (the link's, the pre-start's)
// shares the same ones.
const shared = globalThis as unknown as { __mediaChain?: Promise<unknown>; __mediaCompleting?: Set<string> };
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = (shared.__mediaChain ?? Promise.resolve()).then(f, f);
  shared.__mediaChain = run.catch(() => undefined);
  return run;
}
// One complete per upload at a time (a phone retrying while the first is still being checked).
const completing = (shared.__mediaCompleting ??= new Set<string>());

// PS-044 (11 Nov 2026): the caps count what the bucket really received (storedBytes, once checked) and only FRESH
// PENDING declarations (under 30 minutes) - starts that never send anything can't use up a day (rules.ts dayTotals).
// Added up here, not with Prisma's _sum: a day's total passes 2 GB, beyond a 32-bit Int's range.
const COUNTED = { state: true, bytes: true, storedBytes: true, createdAt: true, abortedAt: true, kind: true } as const;
async function dayCounts(s: Source) {
  const now = new Date();
  const [mine, company] = await Promise.all([
    prisma.mediaObject.findMany({ where: { ...sourceWhere(s), createdAt: { gte: sydneyMidnight() } }, select: COUNTED }),
    companyBytesToday(now),
  ]);
  return { source: dayTotals(mine, now), company };
}
export async function companyBytesToday(now = new Date()): Promise<number> {
  const rows = await prisma.mediaObject.findMany({ where: { createdAt: { gte: sydneyMidnight() } }, select: COUNTED });
  return rows.reduce((a, r) => a + countedBytes(r, now), 0);
}
// Is today's company-wide ceiling reached? (PS-044: it never waives a pre-start photo - the phone falls back to the
// old shrunk-photo route instead.)
export async function mediaCeilingFull(): Promise<boolean> {
  return ceilingReached(await companyBytesToday());
}

// ONE push to the Admins a Sydney day per kind of notice (PhotoCapNotice's unique key records it, as the pre-start
// photo caps do - PS-012): MEDIA_DAY (the company's ceiling), MEDIA_NO_VERSION (PS-045), MEDIA_USAGE (PS-043). Never fails
// an upload. -> true when this call sent it.
export async function noticeOnce(cap: string, msg: { title: string; body: string }, url = "/day-review"): Promise<boolean> {
  const day = todaySydney();
  const key = { resourceId: "*media", cap, day };
  if (await prisma.photoCapNotice.findUnique({ where: { resourceId_cap_day: key }, select: { id: true } })) return false;
  try { await prisma.photoCapNotice.create({ data: key }); } catch (e) { if ((e as { code?: string }).code === "P2002") return false; throw e; }
  await pushToAdmins({ ...msg, url, tag: `media-${cap.toLowerCase()}` }, "normal").catch((e) => console.error("media notice push", e instanceof Error ? e.message : "failed"));
  return true;
}
export const noticeCeiling = () => noticeOnce("MEDIA_DAY", ceilingNotice());

// The addresses for the parts still to send (a batch), and which are done.
async function partsReply(store: MediaStore, row: MediaObject) {
  const done = await store.listParts(row.objectKey, row.uploadId!);
  const next = nextPartNumbers(row.partCount, done.map((p) => p.n));
  // PS-043: only the planned part numbers (1..partCount), each with its exact length signed.
  const urls = await Promise.all(next.map(async (n) => { const r = partRange(row.bytes, n); return { n, url: await store.presignPart(row.objectKey, row.uploadId!, n, r.end - r.start, MEDIA_LIMITS.putTtlSec) }; }));
  if (done.length !== row.partsDone) await prisma.mediaObject.update({ where: { id: row.id }, data: { partsDone: done.length } });
  return { done: done.map((p) => ({ n: p.n, etag: p.etag })), urls };
}
const expiresAt = (ttlSec: number = MEDIA_LIMITS.putTtlSec) => new Date(Date.now() + ttlSec * 1000).toISOString();
// PS-043: one PUT - the declared type and exactly the declared size signed, 5 minutes.
const singlePut = async (store: MediaStore, row: Pick<MediaObject, "objectKey" | "mime" | "bytes">) =>
  ({ put: { url: await store.presignPut(row.objectKey, row.mime, row.bytes, MEDIA_LIMITS.singlePutTtlSec), contentType: row.mime }, expiresAt: expiresAt(MEDIA_LIMITS.singlePutTtlSec) });

// ---------- start ----------

export async function startUpload(party: Party, body: Record<string, unknown>): Promise<Reply> {
  const store = await getMediaStore();
  if (!store) return OFF;
  const prep = await party.prepare(body, body.kind === "PHOTO" || body.kind === "VIDEO" ? body.kind : null);
  if ("error" in prep) return fail(prep);
  const ask = parseStart(prep.area, body);
  if ("error" in ask) return fail(ask);
  const more = prep.extra ? await prep.extra(ask) : null;
  if (more) return fail(more);
  const plan = planUpload(ask.size);
  const now = new Date();
  // The row and the caps together, one start at a time.
  const made = await serial(async (): Promise<MediaObject | (Refusal & { ceiling?: true })> => {
    const c = await dayCounts(party.source);
    if (c.source.pending >= MEDIA_LIMITS.pendingPerSource) return { error: PENDING_FULL, status: 429 }; // PS-044
    const refused = capRefusal(ask.kind, ask.size, c.source, c.company);
    if (refused) return refused;
    const row = await prisma.mediaObject.create({
      data: {
        area: prep.area, kind: ask.kind, mime: ask.mime, bytes: ask.size, objectKey: objectKey(prep.area, ask.ext, now, randomBytes(16).toString("hex")),
        partCount: plan.partCount, siteLinkId: party.source.siteLinkId ?? null, attendanceId: party.source.attendanceId ?? null,
        sessionId: party.source.sessionId ?? null, deviceId: party.source.deviceId ?? null, takenBy: party.source.takenBy.slice(0, 80),
        sha256: ask.sha256, durationSec: ask.durationSec, ...prep.fields,
      },
    });
    if (ceilingReached(c.company + ask.size)) await noticeCeiling().catch(() => false);
    return row;
  });
  if ("error" in made) {
    if (made.ceiling) await noticeCeiling().catch(() => false);
    const { ceiling, ...r } = made;
    // PS-044: the company ceiling never waives a pre-start photo (no capFull). A photo can still go the old way
    // (shrunk, through Operations) - fallback tells the phone to use it; a video can't.
    return fail(ceiling && ask.kind === "PHOTO" ? { ...r, fallback: true } : r);
  }
  try {
    if (!plan.multipart) {
      return { status: 201, body: { mediaId: made.id, kind: made.kind, multipart: false, ...(await singlePut(store, made)) } };
    }
    const uploadId = await store.createMultipart(made.objectKey, made.mime);
    const row = await prisma.mediaObject.update({ where: { id: made.id }, data: { uploadId } });
    const p = await partsReply(store, row);
    return { status: 201, body: { mediaId: row.id, kind: row.kind, multipart: true, partCount: row.partCount, partBytes: MEDIA_LIMITS.partBytes, ...p, expiresAt: expiresAt() } };
  } catch (e) {
    console.error("media start", e instanceof MediaStoreError ? e.message : "failed");
    await prisma.mediaObject.update({ where: { id: made.id }, data: { state: "REJECTED", rejectReason: "STORE", verifiedAt: new Date() } });
    return { status: 503, body: { error: "Couldn't start the upload - try again in a minute." } };
  }
}

// ---------- parts (resume / renew) ----------

async function ownedRow(party: Party, mediaId: unknown): Promise<MediaObject | null> {
  if (typeof mediaId !== "string" || !/^[a-z0-9]{10,40}$/.test(mediaId)) return null;
  const row = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
  return row && party.owns(row) ? row : null;
}
const NOT_YOURS: Reply = { status: 404, body: { error: "That upload isn't one of yours - start it again." } };

export async function uploadParts(party: Party, body: Record<string, unknown>): Promise<Reply> {
  const store = await getMediaStore();
  if (!store) return OFF;
  const row = await ownedRow(party, body.mediaId);
  if (!row) return NOT_YOURS;
  if (row.state !== "PENDING") return { status: 409, body: { error: row.state === "READY" ? "That's already sent." : "That upload was refused - start again.", state: row.state } };
  if (row.abortedAt) return { status: 410, body: { error: "That upload was left too long - start it again." } };
  try {
    if (!row.uploadId) {
      const there = await store.head(row.objectKey);
      if (there) return { status: 200, body: { mediaId: row.id, multipart: false, uploaded: true } };
      return { status: 200, body: { mediaId: row.id, multipart: false, ...(await singlePut(store, row)) } };
    }
    return { status: 200, body: { mediaId: row.id, multipart: true, partCount: row.partCount, partBytes: MEDIA_LIMITS.partBytes, ...(await partsReply(store, row)), expiresAt: expiresAt() } };
  } catch (e) {
    if (e instanceof MediaStoreError && e.code === "NO_UPLOAD") return { status: 410, body: { error: "That upload was left too long - start it again." } };
    console.error("media parts", e instanceof MediaStoreError ? e.message : "failed");
    return { status: 503, body: { error: "Couldn't reach the store - try again in a minute." } };
  }
}

// ---------- complete: the checks ----------

const REJECT_WORDS: Record<string, string> = {
  SIZE: "That file didn't arrive whole - try again.",
  TYPE: "That file isn't a photo or video we can use.",
  TOO_LONG,
  NO_VERSION: "That couldn't be stored safely - the office has been told. Try again later.",
};
// What the bucket holds, checked: exactly the declared size (within the kind's cap), the declared type stored, the first
// bytes that type, and an MP4 / MOV no longer than 125 s where its header can be read (start, or the last 2 MB).
export async function verifyObject(store: MediaStore, row: Pick<MediaObject, "objectKey" | "kind" | "mime" | "bytes">):
  Promise<{ ok: true; size: number; versionId: string | null } | { ok: false; reason: string; size: number | null; versionId: string | null } | null> {
  const head = await store.head(row.objectKey);
  if (!head) return null;
  const kind = row.kind as MediaKind;
  const base = { size: head.size, versionId: head.versionId };
  if (head.size !== row.bytes || head.size > maxBytesFor(kind) || head.size <= 0) return { ok: false, reason: "SIZE", ...base };
  if (head.contentType && head.contentType.split(";")[0].trim().toLowerCase() !== row.mime) return { ok: false, reason: "TYPE", ...base };
  const first = await store.getRange(row.objectKey, head.versionId, 0, Math.min(head.size, 64 * 1024) - 1);
  if (!matchesClaim(kind, row.mime, first)) return { ok: false, reason: "TYPE", ...base };
  if (kind === "VIDEO" && row.mime !== "video/webm") {
    let sec = mp4DurationSec(first);
    if (sec == null && head.size > first.length) {
      const tailStart = Math.max(first.length, head.size - 2 * 1024 * 1024);
      sec = mp4DurationSec(await store.getRange(row.objectKey, head.versionId, tailStart, head.size - 1));
    }
    if (sec != null && sec > MEDIA_LIMITS.videoRefuseOverSec) return { ok: false, reason: "TOO_LONG", ...base };
  }
  return { ok: true, ...base };
}

export async function completeUpload(party: Party, body: Record<string, unknown>): Promise<Reply> {
  const store = await getMediaStore({ read: true });
  if (!store) return OFF;
  const row0 = await ownedRow(party, body.mediaId);
  if (!row0) return NOT_YOURS;
  if (completing.has(row0.id)) return { status: 409, body: { error: "Still checking that one - a moment.", busy: true } };
  completing.add(row0.id);
  try {
    const row = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row0.id } });
    if (isFinal(row.state)) return finalReply(party, row);
    if (row.abortedAt) return { status: 410, body: { error: "That upload was left too long - start it again." } };
    try {
      if (row.uploadId) {
        let parts: Awaited<ReturnType<MediaStore["listParts"]>> | null = null;
        try { parts = await store.listParts(row.objectKey, row.uploadId); } catch (e) { if (!(e instanceof MediaStoreError && e.code === "NO_UPLOAD")) throw e; }
        if (parts) {
          // The bucket's own list decides - never the etags the phone sent.
          if (!partsComplete(row.bytes, row.partCount, parts)) {
            await prisma.mediaObject.update({ where: { id: row.id }, data: { partsDone: parts.length } });
            return { status: 409, body: { error: "Some of it is still to send - carrying on.", missing: true, done: parts.map((p) => p.n) } };
          }
          await store.completeMultipart(row.objectKey, row.uploadId, parts);
        } // NO_UPLOAD: already completed (a retried complete) - the HEAD below finds the object
      }
      const v = await verifyObject(store, row);
      if (!v) return { status: 409, body: { error: "It hasn't arrived yet - carrying on.", missing: true } };
      const now = new Date();
      await prisma.mediaObject.update({ where: { id: row.id }, data: { completedAt: row.completedAt ?? now, partsDone: row.partCount, storedBytes: v.size, versionId: v.versionId } });
      // PS-045 (11 Nov 2026): every read is pinned to the checked version - so READY needs one. No version = the bucket
      // isn't versioning (the key can't read the bucket's setting - checked per object instead): REJECTED, Admins told
      // once a day.
      const reason = !v.ok ? v.reason : !v.versionId ? "NO_VERSION" : null;
      if (reason) {
        await prisma.mediaObject.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "REJECTED", rejectReason: reason, verifiedAt: now } });
        if (reason === "NO_VERSION") await noticeOnce("MEDIA_NO_VERSION", { title: "Media bucket: versioning looks off", body: "An upload came back with no version, so it was refused. Check the bucket's versioning in Lightsail." }).catch(() => false);
        return { status: 422, body: { error: REJECT_WORDS[reason] ?? REJECT_WORDS.TYPE, rejected: true } };
      }
      const fresh = await prisma.mediaObject.findUniqueOrThrow({ where: { id: row.id } });
      const a = await party.attach(fresh);
      if ("refuse" in a) {
        await prisma.mediaObject.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "REJECTED", rejectReason: a.reason, verifiedAt: now } });
        const { status, ...rest } = a.refuse;
        return { status, body: { ...rest, rejected: true } };
      }
      await prisma.mediaObject.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "READY", verifiedAt: now, linkedId: a.linkedId ?? null } });
      return { status: 200, body: { mediaId: row.id, kind: row.kind, state: "READY", ...a.reply } };
    } catch (e) {
      console.error("media complete", e instanceof MediaStoreError ? e.message : "failed");
      return { status: 503, body: { error: "Couldn't check the upload - try again in a minute." } };
    }
  } finally {
    completing.delete(row0.id);
  }
}
async function finalReply(party: Party, row: MediaObject): Promise<Reply> {
  if (row.state === "READY") return { status: 200, body: { mediaId: row.id, kind: row.kind, state: "READY", ...(await party.replyFor(row)) } };
  return { status: 422, body: { error: REJECT_WORDS[row.rejectReason ?? ""] ?? "That upload was refused - start again.", rejected: true } };
}

// ---------- reading ----------

// A short-lived signed GET for a READY upload, pinned to the version that was checked (a later PUT with a still-valid
// address makes a new version, which is never shown). null = not READY / not there / no store.
export async function readUrl(mediaId: string, o: { download?: string | null } = {}): Promise<string | null> {
  const row = await prisma.mediaObject.findUnique({ where: { id: mediaId }, select: { objectKey: true, versionId: true, mime: true, state: true } });
  if (!row || row.state !== "READY") return null;
  const store = await getMediaStore({ read: true });
  if (!store) return null;
  return store.presignGet(row.objectKey, row.versionId, MEDIA_LIMITS.getTtlSec, { mime: row.mime, download: o.download ?? null });
}

// ---------- unfinished multipart uploads ----------

// An unfinished multipart upload older than 24 h is ABORTED in the bucket (Lightsail buckets have no lifecycle rules,
// so its parts would otherwise sit there unseen). This is the abort of an upload that never finished - never the
// deletion of anything that was sent: the MediaObject row is kept (still PENDING, with abortedAt), a finished object
// is never touched. OFF BY DEFAULT (10 Nov 2026 - not yet approved by Ilies): it runs only with MEDIA_ABORT_STALE=on.
// At most every 30 minutes, 50 at a time.
const tickMemo = globalThis as unknown as { __mediaAbortAt?: number };
export async function abortStaleMultipart(now = new Date(), o: { force?: boolean } = {}): Promise<number> {
  if (!abortStaleOn()) return 0;
  if (!o.force && tickMemo.__mediaAbortAt && now.getTime() - tickMemo.__mediaAbortAt < 30 * 60_000) return 0;
  tickMemo.__mediaAbortAt = now.getTime();
  const store = await getMediaStore({ read: true });
  if (!store) return 0;
  const stale = await prisma.mediaObject.findMany({
    where: { state: "PENDING", uploadId: { not: null }, abortedAt: null, createdAt: { lt: new Date(now.getTime() - MEDIA_LIMITS.staleMultipartHours * 3600_000) } },
    orderBy: { createdAt: "asc" }, take: 50, select: { id: true, objectKey: true, uploadId: true },
  });
  let n = 0;
  for (const r of stale) {
    try {
      await store.abortMultipart(r.objectKey, r.uploadId!);
    } catch (e) {
      if (!(e instanceof MediaStoreError && e.code === "NO_UPLOAD")) { console.error("media abort", e instanceof MediaStoreError ? e.message : "failed"); continue; }
    }
    await prisma.mediaObject.update({ where: { id: r.id }, data: { abortedAt: now } });
    n++;
  }
  return n;
}

export { phoneConfig, type PhoneMediaConfig } from "./rules";
