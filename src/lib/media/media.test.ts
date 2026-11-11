// Large uploads (Ilies, 10 Nov 2026): the object key, the type / first-bytes checks, a video's length, the caps, the
// split into parts, the upload's states and resume - and the local fake bucket end to end (127.0.0.1 only). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  KEY_PATTERN, LOG_MEDIA, abortStaleOn, MB, GB, MEDIA_LIMITS, capRefusal, dataNote, downloadName, isFinal, mediaIdOf, mediaRef, nextPartNumbers, nextState, objectKey,
  parseStart, partRange, partsComplete, planUpload, videoLengthOk,
} from "./rules";
import { matchesClaim, mp4DurationSec, sniff } from "./magic";
import { mediaStatus } from "./store";
import { FakeMediaStore } from "./fake";
import { allowedHosts, hostAllowed } from "./s3";

const R = "0123456789abcdef0123456789abcdef";
const bytes = (...v: (number | string)[]) => new Uint8Array(v.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF", 0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const WEBP = bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ");
const HEIC = bytes(0, 0, 0, 0x18, "ftyp", "heic", 0, 0, 0, 0);
const MP4 = bytes(0, 0, 0, 0x20, "ftyp", "isom", 0, 0, 2, 0);
const MOV = bytes(0, 0, 0, 0x14, "ftyp", "qt  ", 0, 0, 2, 0);
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81);
// A movie header ("mvhd", version 0): timescale 600, duration in those units.
const mvhd = (scale: number, units: number) => {
  const b = new Uint8Array(8 + 4 + 16);
  const v = new DataView(b.buffer);
  v.setUint32(0, b.length); b.set(bytes("mvhd"), 4); v.setUint8(8, 0); v.setUint32(8 + 4 + 8, scale); v.setUint32(8 + 4 + 12, units);
  return b;
};

test("object keys: <area>/<yyyy>/<mm>/<random>.<ext>, made here only", () => {
  const k = objectKey("BEFORE_AFTER", "mov", new Date("2026-11-09T14:30:00Z"), R); // 10 Nov in Sydney
  assert.equal(k, `before-after/2026/11/${R}.mov`);
  assert.match(k, KEY_PATTERN);
  assert.equal(objectKey("HOUR_METER", "jpg", new Date("2026-12-31T13:30:00Z"), R).slice(0, 19), "hour-meter/2027/01/"); // Sydney's new year
  assert.throws(() => objectKey("FAULT", "jpg", new Date(), "../../etc"), /bad key random/);
  assert.throws(() => objectKey("FAULT", "j/pg", new Date(), R), /bad key extension/);
});

test("media refs: media:<id> only - never a stored photo name or a data URL", () => {
  assert.equal(mediaIdOf(mediaRef("ckabc1234567890")), "ckabc1234567890");
  for (const x of ["1730000000000-0123456789abcdef.jpg", "data:image/jpeg;base64,AAAA", "media:../x", "media:", null, 5]) assert.equal(mediaIdOf(x), null, String(x));
});

test("first bytes: JPEG / PNG / WebP / HEIC photos, MP4 / MOV / WebM videos", () => {
  assert.equal(sniff(JPEG), "image/jpeg");
  assert.equal(sniff(PNG), "image/png");
  assert.equal(sniff(WEBP), "image/webp");
  assert.equal(sniff(HEIC), "image/heic");
  assert.equal(sniff(MP4), "video/mp4");
  assert.equal(sniff(MOV), "video/quicktime");
  assert.equal(sniff(WEBM), "video/webm");
  assert.equal(sniff(bytes("%PDF-1.7 hello")), null);
  assert.equal(sniff(bytes("<html><script>")), null);
});

test("the bytes must fit the claim: a photo is a photo of that type, a video a video", () => {
  assert.ok(matchesClaim("PHOTO", "image/jpeg", JPEG));
  assert.ok(!matchesClaim("PHOTO", "image/png", JPEG), "a JPEG claimed as PNG");
  assert.ok(matchesClaim("PHOTO", "image/heic", HEIC));
  assert.ok(matchesClaim("PHOTO", "image/heif", HEIC));
  assert.ok(!matchesClaim("PHOTO", "image/jpeg", MP4), "a video sent as a photo");
  assert.ok(!matchesClaim("VIDEO", "video/mp4", JPEG), "a photo sent as a video");
  assert.ok(!matchesClaim("VIDEO", "video/mp4", HEIC), "a HEIC photo is not a video");
  assert.ok(matchesClaim("VIDEO", "video/mp4", MOV), "MP4 / MOV: the same container");
  assert.ok(matchesClaim("VIDEO", "video/quicktime", MP4));
  assert.ok(matchesClaim("VIDEO", "video/webm", WEBM));
  assert.ok(!matchesClaim("VIDEO", "video/webm", MP4));
  assert.ok(!matchesClaim("VIDEO", "video/mp4", bytes("not a video at all")));
});

test("a video's length from its movie header - at the start or in the tail", () => {
  assert.equal(mp4DurationSec(new Uint8Array([...MP4, ...mvhd(600, 600 * 90)])), 90);
  const tail = new Uint8Array(5000); tail.set(mvhd(1000, 130_000), 3000);
  assert.equal(mp4DurationSec(tail), 130);
  assert.equal(mp4DurationSec(MP4), null, "no header in these bytes");
  assert.ok(videoLengthOk(120) && videoLengthOk(125) && !videoLengthOk(125.5) && !videoLengthOk(0) && !videoLengthOk(NaN));
});

test("start: kinds per area, types, sizes, the 2-minute rule read on the phone", () => {
  const ok = parseStart("FAULT", { kind: "VIDEO", mime: "video/mp4; codecs=avc1", size: 50 * MB, durationSec: 119.6 });
  assert.ok(!("error" in ok) && ok.ext === "mp4" && ok.mime === "video/mp4" && ok.durationSec === 119.6);
  const st = (area: Parameters<typeof parseStart>[0], b: Record<string, unknown>) => { const r = parseStart(area, b); return "error" in r ? r.status : 0; };
  assert.equal(st("WALKAROUND", { kind: "VIDEO", mime: "video/mp4", size: 10, durationSec: 5 }), 400, "walk-around: photos only");
  assert.equal(st("HOUR_METER", { kind: "VIDEO", mime: "video/mp4", size: 10, durationSec: 5 }), 400, "hour meter: photos only");
  assert.equal(st("DAILY_LOG", { kind: "VIDEO", mime: "video/mp4", size: 10, durationSec: 126 }), 413, "over 125 s");
  assert.equal(st("DAILY_LOG", { kind: "VIDEO", mime: "video/mp4", size: 10 }), 400, "no length read");
  assert.equal(st("DAILY_LOG", { kind: "VIDEO", mime: "video/mp4", size: MEDIA_LIMITS.videoMaxBytes + 1, durationSec: 60 }), 413, "over 400 MB");
  assert.equal(st("DAILY_LOG", { kind: "PHOTO", mime: "image/jpeg", size: 25 * MB }), 0, "a 25 MB photo");
  assert.equal(st("DAILY_LOG", { kind: "PHOTO", mime: "image/jpeg", size: 25 * MB + 1 }), 413, "over 25 MB");
  assert.equal(st("DAILY_LOG", { kind: "PHOTO", mime: "image/gif", size: 10 }), 415);
  assert.equal(st("DAILY_LOG", { kind: "PHOTO", mime: "video/mp4", size: 10 }), 415, "a video type as a photo");
  assert.equal(st("DAILY_LOG", { kind: "PHOTO", mime: "image/jpeg", size: 0 }), 400);
  assert.equal(st("DAILY_LOG", { kind: "PHOTO", mime: "image/jpeg", size: 1.5 }), 400);
  assert.equal(st("DAILY_LOG", { kind: "AUDIO", mime: "image/jpeg", size: 10 }), 400);
  const sha = parseStart("FAULT", { kind: "PHOTO", mime: "image/heic", size: 10, sha256: "A".repeat(64) });
  assert.ok(!("error" in sha) && sha.sha256 === null && sha.ext === "heic", "a malformed hash is ignored");
});

test("split: one PUT up to 15 MB, 8 MB parts above; resume hands out the missing parts in batches", () => {
  assert.deepEqual(planUpload(10 * MB), { multipart: false, partCount: 1, partBytes: 10 * MB });
  assert.deepEqual(planUpload(20 * MB), { multipart: true, partCount: 3, partBytes: 8 * MB });
  assert.equal(planUpload(400 * MB).partCount, 50);
  assert.deepEqual(partRange(20 * MB, 3), { start: 16 * MB, end: 20 * MB });
  assert.deepEqual(nextPartNumbers(3, []), [1, 2, 3]);
  assert.deepEqual(nextPartNumbers(3, [1, 3]), [2], "a dropped part 2 is the only one sent again");
  assert.deepEqual(nextPartNumbers(50, [1, 2]), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(nextPartNumbers(3, [1, 2, 3]), []);
  const size = 20 * MB;
  const full = [1, 2, 3].map((n) => ({ n, size: partRange(size, n).end - partRange(size, n).start }));
  assert.ok(partsComplete(size, 3, full));
  assert.ok(!partsComplete(size, 3, full.slice(0, 2)), "a part missing");
  assert.ok(!partsComplete(size, 3, [full[0], { n: 2, size: 1 }, full[2]]), "a short part");
});

test("caps: per link / sign-in a day, and the company's 20 GB a day", () => {
  const none = { items: 0, videos: 0, bytes: 0 };
  assert.equal(capRefusal("PHOTO", 5 * MB, none, 0), null);
  assert.equal(capRefusal("PHOTO", 5 * MB, { ...none, items: 80 }, 0)?.status, 429);
  assert.equal(capRefusal("VIDEO", 5 * MB, { ...none, videos: 10 }, 0)?.status, 429);
  assert.equal(capRefusal("PHOTO", 5 * MB, { ...none, videos: 10 }, 0), null, "the video cap leaves photos alone");
  assert.equal(capRefusal("VIDEO", 100 * MB, { ...none, bytes: 4 * GB - 50 * MB }, 0)?.status, 429);
  const c = capRefusal("PHOTO", 5 * MB, none, 20 * GB - MB);
  assert.ok(c?.ceiling && c.status === 429, "the company ceiling");
  assert.equal(LOG_MEDIA.logPhotos, 12);
  assert.equal(LOG_MEDIA.logVideos, 3);
});

test("states: PENDING -> READY or REJECTED, then final; a second complete changes nothing", () => {
  assert.equal(nextState("PENDING", "VERIFIED"), "READY");
  assert.equal(nextState("PENDING", "FAILED"), "REJECTED");
  assert.equal(nextState("READY", "FAILED"), "READY");
  assert.equal(nextState("REJECTED", "VERIFIED"), "REJECTED");
  assert.ok(isFinal("READY") && isFinal("REJECTED") && !isFinal("PENDING"));
});

test("words: the mobile-data note and a download's name (no key, no person)", () => {
  assert.match(dataNote(87 * MB), /about 87 MB/);
  assert.match(dataNote(0.3 * MB), /about 1 MB/);
  assert.equal(downloadName("VIDEO", "mov", new Date("2026-11-10T01:00:00Z")), "site-video-2026-11-10.mov");
  assert.equal(downloadName("PHOTO", "../x", new Date("2026-11-10T01:00:00Z")), "site-photo-2026-11-10.bin");
});

test("on / off: OFF with no MEDIA_* settings, the kill switch, bad settings; the fake only by name", () => {
  const keys = { MEDIA_BUCKET: "lobos-ops-media", MEDIA_REGION: "ap-southeast-2", MEDIA_ACCESS_KEY_ID: "x", MEDIA_SECRET_ACCESS_KEY: "y" };
  assert.deepEqual(mediaStatus({}), { on: false, reason: "NOT_SET_UP" });
  assert.deepEqual(mediaStatus(keys), { on: true, store: "s3" });
  assert.deepEqual(mediaStatus({ ...keys, MEDIA_UPLOADS: "off" }), { on: false, reason: "KILL_SWITCH" });
  assert.deepEqual(mediaStatus({ ...keys, MEDIA_UPLOADS: "off" }, { read: true }), { on: true, store: "s3" }, "the kill switch stops uploads, not reading");
  assert.deepEqual(mediaStatus({ ...keys, MEDIA_REGION: "us-east-1" }), { on: false, reason: "BAD_SETTINGS" });
  assert.deepEqual(mediaStatus({ ...keys, MEDIA_BUCKET: "a.b.c" }), { on: false, reason: "BAD_SETTINGS" });
  assert.deepEqual(mediaStatus({ ...keys, MEDIA_SECRET_ACCESS_KEY: "" }), { on: false, reason: "BAD_SETTINGS" });
  assert.deepEqual(mediaStatus({ MEDIA_STORE: "fake", MEDIA_FAKE_DIR: "/tmp/x" }), { on: true, store: "fake" });
  assert.deepEqual(mediaStatus({ MEDIA_STORE: "fake" }), { on: false, reason: "BAD_SETTINGS" });
});

test("the 24 h abort of unfinished multipart uploads is OFF unless MEDIA_ABORT_STALE=on", () => {
  assert.equal(abortStaleOn({}), false);
  assert.equal(abortStaleOn({ MEDIA_ABORT_STALE: "off" }), false);
  assert.equal(abortStaleOn({ MEDIA_ABORT_STALE: "yes" }), false);
  assert.equal(abortStaleOn({ MEDIA_ABORT_STALE: " ON " }), true);
});

test("outbound #8: only the bucket's own host in Sydney, https, default port", () => {
  assert.deepEqual(allowedHosts("lobos-ops-media"), ["lobos-ops-media.s3.ap-southeast-2.amazonaws.com", "s3.ap-southeast-2.amazonaws.com"]);
  assert.ok(hostAllowed("https://lobos-ops-media.s3.ap-southeast-2.amazonaws.com/a/b?X-Amz-Signature=1", "lobos-ops-media"));
  for (const u of ["http://lobos-ops-media.s3.ap-southeast-2.amazonaws.com/a", "https://lobos-ops-media.s3.us-east-1.amazonaws.com/a", "https://evil.example/a",
    "https://lobos-ops-media.s3.ap-southeast-2.amazonaws.com:8443/a", "https://other.s3.ap-southeast-2.amazonaws.com/a", "not a url"]) assert.ok(!hostAllowed(u, "lobos-ops-media"), u);
});

test("the SDK stays on the server: no client component imports lib/media/s3 or the SDK", () => {
  for (const f of ["src/components/site/DailyLog.tsx", "src/components/site/BeforeAfterPhotos.tsx", "src/components/site/PrestartCheck.tsx", "src/lib/media/client.ts"]) {
    const src = readFileSync(path.join(process.cwd(), f), "utf8");
    assert.ok(!/@aws-sdk|media\/s3|media\/store|media\/protocol"|media\/fake/.test(src), f);
  }
});

