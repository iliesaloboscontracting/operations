// Large uploads - the security fixes of 11 Nov 2026 (PS-043..046, Ilies approved): signed lengths, the usage watch,
// caps that count what really arrived, 3 uploads on their way at once, no pre-start waiver from the company ceiling,
// READY only with a version, one shared lock - and the local fake bucket end to end (127.0.0.1 only). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MB, MEDIA_LIMITS, PENDING_FULL, countedBytes, dayTotals, objectKey, usageFigures, usageVerdict, usageWatchOn, type CountedRow } from "./rules";
import { FakeMediaStore } from "./fake";

const R = "0123456789abcdef0123456789abcdef";
const bytes = (...v: (number | string)[]) => new Uint8Array(v.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF", 0);
const MP4 = bytes(0, 0, 0, 0x20, "ftyp", "isom", 0, 0, 2, 0);

test("the local fake: signed PUT (type AND length pinned - PS-043), multipart with a dropped part resumed, HEAD, range, versions, signed GET", async () => {
  const store = new FakeMediaStore(mkdtempSync(path.join(tmpdir(), "media-fake-")));
  const key = objectKey("DAILY_LOG", "jpg", new Date(), R);
  const put = await store.presignPut(key, "image/jpeg", JPEG.length, 60);
  assert.match(put, /^http:\/\/127\.0\.0\.1:\d+\//);
  const send = (url: string, body: Uint8Array, ct: string | null = "image/jpeg") => fetch(url, { method: "PUT", headers: ct ? { "Content-Type": ct } : {}, body: Buffer.from(body) }).then((r) => r.status);
  assert.equal(await send(put, JPEG, "image/png"), 403, "another type");
  assert.equal(await send(put + "x", JPEG), 403, "a tampered signature");
  // The MAC's last base64url character carries only 4 bits: the 3 characters that differ from it in the 2 discarded
  // bits decode to the same bytes, so the signature must be compared as written (the release check 80 flake, 11 Nov).
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = ALPHA.indexOf(put.slice(-1));
  for (const flip of [1, 2, 3]) assert.equal(await send(put.slice(0, -1) + ALPHA[last ^ flip], JPEG), 403, `the last character changed within its discarded bits (^${flip})`);
  assert.equal(await send(put, new Uint8Array([...JPEG, 0])), 403, "PS-043: one byte more");
  assert.equal(await send(put, JPEG.subarray(1)), 403, "PS-043: one byte less");
  assert.equal(await store.head(key), null, "...nothing stored by a refused PUT");
  assert.equal(await send(put, JPEG), 200);
  const h1 = await store.head(key);
  assert.equal(h1?.size, JPEG.length);
  assert.equal(h1?.contentType, "image/jpeg");
  // The same address again (same length) = a new version; the first stays readable by its version; the watch sees both.
  const JPEG2 = new Uint8Array(JPEG); JPEG2[JPEG2.length - 1] = 7;
  assert.equal(await send(put, JPEG2), 200);
  const h2 = await store.head(key);
  assert.notEqual(h2?.versionId, h1?.versionId);
  assert.equal((await store.listVersions()).filter((v) => v.key === key).length, 2, "the usage watch sees both versions");
  assert.deepEqual([...(await store.getRange(key, h1!.versionId, 0, 2))], [0xff, 0xd8, 0xff]);
  const g = await fetch(await store.presignGet(key, h1!.versionId, 60, { mime: "image/jpeg", download: "site-photo-2026-11-10.jpg" }));
  assert.equal(g.status, 200);
  assert.match(g.headers.get("content-disposition") ?? "", /attachment; filename="site-photo-2026-11-10.jpg"/);
  assert.deepEqual(new Uint8Array(await g.arrayBuffer()), JPEG, "the pinned version, not the newer one");
  // Multipart: each part's exact length signed; part 2 "dropped", then sent; complete.
  const vkey = objectKey("FAULT", "mp4", new Date(), R.replace("0", "1"));
  const id = await store.createMultipart(vkey, "video/mp4");
  const part = (n: number, size: number) => { const b = new Uint8Array(size).fill(n); if (n === 1) b.set(MP4); return b; };
  const sizeOf = (n: number) => (n === 3 ? 1000 : 2000);
  assert.equal(await send(await store.presignPart(vkey, id, 1, 2000, 60), part(1, 2500), null), 403, "PS-043: an oversized part");
  for (const n of [1, 3]) assert.equal(await send(await store.presignPart(vkey, id, n, sizeOf(n), 60), part(n, sizeOf(n)), null), 200);
  assert.deepEqual((await store.listParts(vkey, id)).map((p) => p.n), [1, 3]);
  assert.equal((await store.listUploads()).find((u) => u.uploadId === id)?.bytes, 3000, "the usage watch sees the unfinished upload's parts");
  assert.equal(await send(await store.presignPart(vkey, id, 2, 2000, 60), part(2, 2000), null), 200);
  const parts = await store.listParts(vkey, id);
  assert.deepEqual(parts.map((p) => [p.n, p.size]), [[1, 2000], [2, 2000], [3, 1000]]);
  await store.completeMultipart(vkey, id, parts);
  assert.equal((await store.head(vkey))?.size, 5000);
  await assert.rejects(store.listParts(vkey, id), /NO_UPLOAD/, "a completed upload is gone");
  assert.ok(!(await store.listUploads()).some((u) => u.uploadId === id), "...and no longer unfinished");
  assert.equal(await send(await store.presignPut(key, "image/jpeg", JPEG.length, -1), JPEG), 403, "an expired address");
  const id2 = await store.createMultipart(vkey + "x", "video/mp4");
  await store.abortMultipart(vkey + "x", id2);
  await assert.rejects(store.listParts(vkey + "x", id2), /NO_UPLOAD/);
  assert.equal(await store.head(vkey + "x"), null);
  // PS-045: a bucket with versioning off gives no version.
  process.env.MEDIA_FAKE_VERSIONING = "off";
  try { assert.equal((await store.head(key))?.versionId, null); } finally { delete process.env.MEDIA_FAKE_VERSIONING; }
});

test("PS-044: the caps count stored bytes and only fresh PENDING declarations; 3 on their way at once", () => {
  const now = new Date("2026-11-11T02:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const row = (o: Partial<CountedRow>): CountedRow => ({ state: "PENDING", bytes: 100 * MB, storedBytes: null, createdAt: ago(1), abortedAt: null, kind: "PHOTO", ...o });
  assert.equal(countedBytes(row({}), now), 100 * MB, "fresh PENDING: its declared size");
  assert.equal(countedBytes(row({ createdAt: ago(31) }), now), 0, "PENDING over 30 min: nothing");
  assert.equal(countedBytes(row({ abortedAt: ago(1) }), now), 0, "stopped: nothing");
  assert.equal(countedBytes(row({ state: "READY", storedBytes: 3 * MB }), now), 3 * MB, "READY: what the bucket received");
  assert.equal(countedBytes(row({ state: "REJECTED", storedBytes: 2 * MB }), now), 2 * MB, "REJECTED after the check: what was received");
  assert.equal(countedBytes(row({ state: "REJECTED" }), now), 0, "REJECTED before anything arrived: nothing");
  assert.deepEqual(dayTotals([row({}), row({ kind: "VIDEO" }), row({ createdAt: ago(45) }), row({ state: "READY", storedBytes: MB })], now), { items: 3, videos: 1, bytes: 201 * MB, pending: 2 });
  // 1,000 starts of 400 MB an hour ago that never sent anything: the company's day is untouched.
  assert.equal(dayTotals(Array.from({ length: 1000 }, () => row({ bytes: 400 * MB, createdAt: ago(60) })), now).bytes, 0);
  assert.equal(MEDIA_LIMITS.pendingPerSource, 3);
  assert.match(PENDING_FULL, /^3 uploads are already on their way/);
});

test("PS-043: one-PUT addresses live 5 minutes; the usage watch's verdict and switch", () => {
  assert.equal(MEDIA_LIMITS.singlePutTtlSec, 300);
  assert.deepEqual(usageVerdict({ bucketBytes: 1000 * MB, recordedBytes: 1000 * MB, extraVersionKeys: 0 }), { alert: false, reasons: [] });
  assert.deepEqual(usageVerdict({ bucketBytes: 1100 * MB, recordedBytes: 1000 * MB, extraVersionKeys: 0 }), { alert: false, reasons: [] }, "within 5% + 100 MB");
  assert.deepEqual(usageVerdict({ bucketBytes: 1200 * MB, recordedBytes: 1000 * MB, extraVersionKeys: 0 }).reasons, ["OVER"]);
  assert.deepEqual(usageVerdict({ bucketBytes: 10, recordedBytes: 10, extraVersionKeys: 1 }).reasons, ["EXTRA_VERSION"]);
  assert.equal(usageWatchOn({}), true);
  assert.equal(usageWatchOn({ MEDIA_USAGE_WATCH: "off" }), false);
});

test("PS-049: the usage watch counts only fresh PENDING declarations, and flags a key holding more than 2x its size", () => {
  const now = new Date("2026-11-11T02:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const row = (key: string, o: Partial<CountedRow> = {}) => ({ objectKey: key, state: "PENDING", bytes: 10 * MB, storedBytes: null, createdAt: ago(1), abortedAt: null, kind: "PHOTO", ...o });
  // 60 never-sent 400 MB declarations from an hour ago, and one PENDING key holding 15 x 10 MB: the ghosts don't hide it.
  const ghosts = Array.from({ length: 60 }, (_, i) => row(`g${i}`, { bytes: 400 * MB, createdAt: ago(60) }));
  const versions = Array.from({ length: 15 }, () => ({ key: "k", size: 10 * MB }));
  const f = usageFigures([...ghosts, row("k")], versions, [], now);
  assert.equal(f.recordedBytes, 10 * MB, "only the fresh declaration counts");
  assert.equal(f.oversizeKeys, 1);
  assert.deepEqual(usageVerdict(f).reasons, ["OVER", "OVERSIZE_KEY"]);
  // Up to 2x is fine (a retry after a dropped signal); 3 versions of a PENDING key is not; a READY key's 2nd version is EXTRA_VERSION.
  assert.equal(usageFigures([row("a")], [{ key: "a", size: 10 * MB }, { key: "a", size: 10 * MB }], [], now).oversizeKeys, 0);
  const three = usageFigures([row("b", { createdAt: ago(600) })], [1, 2, 3].map(() => ({ key: "b", size: 10 * MB })), [], now);
  assert.equal(three.oversizeKeys, 1, "3 versions of a PENDING key, whatever its age");
  assert.deepEqual(usageVerdict(three).reasons, ["OVERSIZE_KEY"]);
  const ready = usageFigures([row("c", { state: "READY", storedBytes: 10 * MB })], [{ key: "c", size: 10 * MB }, { key: "c", size: 10 * MB }], [], now);
  assert.deepEqual([ready.extraVersionKeys, ready.oversizeKeys], [1, 0]);
});

test("PS-043..046 in the code: lengths signed, no ceiling waiver on pre-starts, READY needs a version, one shared lock", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
  const pre = read("src/lib/prestart/store.ts");
  const at = pre.indexOf("export async function submitCheck");
  assert.doesNotMatch(pre.slice(at, at + 3000), /mediaCeilingFull|mediaFull/, "submitCheck's waivers come from the per-role photo caps only");
  const proto = read("src/lib/media/protocol.ts");
  assert.doesNotMatch(proto, /capFull: true/, "the company ceiling never answers capFull");
  assert.match(proto, /!v\.versionId \? "NO_VERSION"/, "no version -> REJECTED NO_VERSION");
  assert.match(proto, /__mediaChain/, "the start queue is on globalThis");
  assert.match(proto, /__mediaCompleting/, "the completing set is on globalThis");
  assert.doesNotMatch(proto, /^let chain/m);
  const s3 = read("src/lib/media/s3.ts");
  assert.match(s3, /ContentType: mime, ContentLength: bytes \}\),\s*\{ expiresIn: ttlSec, signableHeaders: new Set\(\["content-type", "content-length"\]\) \}/, "the S3 PUT signs type and length");
  assert.match(s3, /PartNumber: n, ContentLength: bytes \}\),\s*\{ expiresIn: ttlSec, signableHeaders: new Set\(\["content-length"\]\) \}/, "each S3 part signs its length");
  assert.match(proto, /partRange\(row\.bytes, n\)/, "a part's signed length is the planned one");
});
