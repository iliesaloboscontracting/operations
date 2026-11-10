// Large uploads (Ilies, 10 Nov 2026, option A): photos at full quality and videos up to 2 minutes go from the phone
// straight to the media bucket with short-lived signed addresses; Operations checks every one when it's done. Here the
// bucket is the LOCAL FAKE (MEDIA_STORE=fake - a folder and a stub on 127.0.0.1), so nothing leaves the machine and the
// no-outbound check still holds. Covers: start -> multipart -> complete -> READY for a 20 MB video and a 10 MB photo;
// resume after a "dropped" part; an over-size and a wrong-bytes file -> REJECTED and never shown; a video whose own
// header says it's over 2 minutes -> REJECTED; another link can't complete, resume or read; the office's routes are
// guarded as today (VIEWER / ACCOUNTS refused where they are today) and give a short-lived redirect with a Download
// variant; the daily log, Day Review, the daily site report (office + directors), before / after and the job page show
// the video; pre-start fault videos and full-quality walk-around photos through the same caps, /faults plays the
// video; feature OFF / kill switch -> the protocol refuses and the old routes are as before; the company's daily
// ceiling (one Admin notice a day, cap ALL for the pre-start waiver); the 24 h abort is OFF unless MEDIA_ABORT_STALE=on;
// no $ + digit in any link reply.
// WRITES on the test copy: a project + job today, links, a truck, two drivers, sign-ins, a check + fault, media rows, a
// daily log; one seeded ceiling row (removed again).
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const MB = 1024 * 1024;
const ascii = (s) => Buffer.from(s, "latin1");
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00]);
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const uniqPng = () => `data:image/png;base64,${Buffer.concat([Buffer.from(PNG_B64, "base64"), randomBytes(16)]).toString("base64")}`;
// An MP4: ftyp, a movie header (mvhd) saying how long it is, then filler to the size wanted.
function mp4(size, seconds) {
  const ftyp = Buffer.concat([u32(24), ascii("ftyp"), ascii("isom"), u32(0x200), ascii("isomiso2")]);
  const mvhd = Buffer.concat([u32(28), ascii("mvhd"), Buffer.from([0, 0, 0, 0]), u32(0), u32(0), u32(600), u32(Math.round(seconds * 600))]);
  const head = Buffer.concat([ftyp, mvhd]);
  return Buffer.concat([head, randomBytes(Math.max(0, size - head.length))]);
}
const jpeg = (size) => Buffer.concat([JPEG_HEAD, randomBytes(size - JPEG_HEAD.length)]);
const PARTS = 8 * MB;

export default {
  id: "large-uploads", title: "Large uploads: bucket (local fake) - multipart + resume, server checks, REJECTED never shown, own media only, office guards, daily log + faults show videos, OFF, ceiling, no $",
  writes: true, timeoutMs: 600_000,
  applies: (c) => c.hasPath("src/lib/media/protocol.ts") || "the candidate has no large uploads",
  async run(t, c) {
    const db = c.db;
    const L = c.links;
    if (!db) return t.block("no test database handle");
    if (!L.sup) return t.block(L.missing.join("; "));
    const env = c.childEnv ?? {};
    if (env.MEDIA_STORE !== "fake" || !env.MEDIA_FAKE_DIR) return t.block("the test server has no local fake bucket (MEDIA_STORE=fake) - the release check's setup must set it");
    const tag = Date.now().toString(36);
    const bodies = [];
    const keep = async (r) => {
      const text = await r.text().catch(() => "");
      bodies.push(text);
      let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: j ?? {}, headers: r.headers };
    };
    const day = c.today;

    // A job today with the supervisor on it, two of that person's own SUPERVISOR links (ownership is by link).
    const project = await db.project.create({ data: { name: `RC uploads site ${tag}`, status: "ACTIVE" } });
    const job = await db.job.create({ data: { title: project.name, projectId: project.id, date: new Date(`${day}T00:00:00Z`), shift: "DAY", startTime: "6:30am", endTime: "3pm", status: "ACTIVE" } });
    await db.assignment.create({ data: { jobId: job.id, resourceId: L.sup.resourceId } });
    const link = await makeLink(db, "SUPERVISOR", L.sup.resourceId);
    const other = await makeLink(db, "SUPERVISOR", L.sup.resourceId);

    const op = (l, name, body) => c.post(c.site(l, `/media/${name}`), null, body).then(keep);
    const put = async (url, bytes, ct) => (await fetch(url, { method: "PUT", headers: ct ? { "Content-Type": ct } : {}, body: bytes })).status;
    // A whole upload: start, send (every part, or one PUT), complete. skip = part numbers left out ("dropped").
    async function upload(l, fields, bytes, o = {}) {
      const s = await op(l, "start", { ...fields, kind: o.kind ?? "PHOTO", mime: o.mime ?? "image/jpeg", size: o.declare ?? bytes.length, durationSec: o.durationSec });
      if (s.status !== 201) return { start: s };
      if (!s.body.multipart) await put(s.body.put.url, o.sendBytes ?? bytes, s.body.put.contentType);
      else for (const p of s.body.urls) if (!(o.skip ?? []).includes(p.n)) await put(p.url, bytes.subarray((p.n - 1) * PARTS, Math.min(bytes.length, p.n * PARTS)));
      const done = await op(l, "complete", { mediaId: s.body.mediaId });
      return { start: s, done, mediaId: s.body.mediaId };
    }

    // (1) The link's log says large uploads are on.
    const view = await keep(await c.get(c.site(link, "/log"), null));
    t.ok(view.status === 200 && view.body.media?.on === true && view.body.media.kinds?.includes("VIDEO"), "the link's daily log: large uploads on (fake bucket)", view.status);

    // (2) A 10 MB photo: one PUT, checked, READY.
    const photo = await upload(link, { area: "DAILY_LOG", jobId: job.id }, jpeg(10 * MB));
    t.ok(photo.start.status === 201 && photo.start.body.multipart === false && /^http:\/\/127\.0\.0\.1:\d+\//.test(photo.start.body.put?.url ?? ""), "a 10 MB photo: one signed PUT, on the local fake", photo.start.status);
    t.ok(photo.done?.status === 200 && photo.done.body.state === "READY" && photo.done.body.ref === `media:${photo.mediaId}`, "...complete: checked, READY, a media ref", JSON.stringify({ s: photo.done?.status, b: photo.done?.body }));
    const pRow = await db.mediaObject.findUnique({ where: { id: photo.mediaId } });
    t.ok(pRow?.state === "READY" && pRow.storedBytes === 10 * MB && pRow.versionId && /^daily-log\/\d{4}\/\d{2}\/[a-f0-9]{32}\.jpg$/.test(pRow.objectKey) && pRow.siteLinkId === link.id, "...the row: size from HEAD, version pinned, key made by the server");

    // (3) A 20 MB video: 3 parts, part 2 "dropped" - complete says what's missing, /parts resumes just that one.
    const vbytes = mp4(20 * MB, 90);
    const v = await upload(link, { area: "DAILY_LOG", jobId: job.id }, vbytes, { kind: "VIDEO", mime: "video/mp4", durationSec: 90, skip: [2] });
    t.ok(v.start.status === 201 && v.start.body.multipart === true && v.start.body.partCount === 3 && v.start.body.urls?.length === 3, "a 20 MB video: multipart, 3 x 8 MB parts", JSON.stringify({ s: v.start.status, n: v.start.body.partCount }));
    t.ok(v.done?.status === 409 && v.done.body.missing === true, "...part 2 dropped: complete says it isn't all there (409)", v.done?.status);
    const resumed = await op(link, "parts", { mediaId: v.mediaId });
    t.ok(resumed.status === 200 && JSON.stringify(resumed.body.done?.map((d) => d.n)) === "[1,3]" && resumed.body.urls?.length === 1 && resumed.body.urls[0].n === 2, "...resume: the server lists parts 1 and 3 as there and hands out part 2 only", JSON.stringify({ done: resumed.body.done?.map((d) => d.n), next: resumed.body.urls?.map((u) => u.n) }));
    await put(resumed.body.urls?.[0]?.url, vbytes.subarray(PARTS, 2 * PARTS));
    const vDone = await op(link, "complete", { mediaId: v.mediaId });
    t.ok(vDone.status === 200 && vDone.body.state === "READY" && vDone.body.kind === "VIDEO", "...then complete: READY", vDone.status);
    const again = await op(link, "complete", { mediaId: v.mediaId });
    t.ok(again.status === 200 && again.body.ref === vDone.body.ref, "a second complete gives the same answer and changes nothing");
    const vRef = vDone.body.ref;

    // (4) Refused before anything is sent: over 125 s (read on the phone), over 400 MB, a 26 MB photo, a type, walk-around video.
    t.status(await op(link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "VIDEO", mime: "video/mp4", size: 5 * MB, durationSec: 126 }), 413, "a video over 2 minutes (126 s): refused at the start");
    t.status(await op(link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "VIDEO", mime: "video/mp4", size: 401 * MB, durationSec: 60 }), 413, "a video over 400 MB: refused");
    t.status(await op(link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "PHOTO", mime: "image/jpeg", size: 26 * MB }), 413, "a photo over 25 MB: refused");
    t.status(await op(link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "PHOTO", mime: "text/html", size: 100 }), 415, "an HTML file as a photo: refused");
    t.status(await op(link, "start", { area: "DAILY_LOG", jobId: "not-a-job", kind: "PHOTO", mime: "image/jpeg", size: 100 }), 403, "another job's id: 403");
    t.status(await op(L.office ?? link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "PHOTO", mime: "image/jpeg", size: 100 }), L.office ? 404 : 403, "an office link (no daily log): 404");

    // (5) The server's checks are what count: more bytes than declared, wrong first bytes, a video's own header over 125 s.
    const big = await upload(link, { area: "DAILY_LOG", jobId: job.id }, jpeg(2000), { declare: 1000 });
    const bad = await upload(link, { area: "DAILY_LOG", jobId: job.id }, ascii("<html><script>alert(1)</script></html>" + " ".repeat(200)));
    const longV = await upload(link, { area: "DAILY_LOG", jobId: job.id }, mp4(3 * MB, 130), { kind: "VIDEO", mime: "video/mp4", durationSec: 60 });
    const rows = await db.mediaObject.findMany({ where: { id: { in: [big.mediaId, bad.mediaId, longV.mediaId].filter(Boolean) } } });
    const reason = (id) => rows.find((r) => r.id === id)?.rejectReason;
    t.ok(big.done?.status === 422 && reason(big.mediaId) === "SIZE", "more bytes than declared: 422, REJECTED (SIZE)", JSON.stringify({ s: big.done?.status, r: reason(big.mediaId) }));
    t.ok(bad.done?.status === 422 && reason(bad.mediaId) === "TYPE", "an HTML file sent as a JPEG: 422, REJECTED (TYPE - first bytes)", JSON.stringify({ s: bad.done?.status, r: reason(bad.mediaId) }));
    t.ok(longV.done?.status === 422 && reason(longV.mediaId) === "TOO_LONG", "a video whose own header says 130 s (the phone said 60): REJECTED (TOO_LONG)", JSON.stringify({ s: longV.done?.status, r: reason(longV.mediaId) }));
    t.ok(rows.length === 3 && rows.every((r) => r.state === "REJECTED"), "...all three rows kept (REJECTED), none deleted");
    t.status(await keep(await c.get(c.site(link, `/media/${bad.mediaId}`), null)), 404, "a REJECTED upload is never shown, even to its own link");

    // (6) Only its own link: another link can't resume, complete or read; the owner reads by a short-lived redirect.
    t.status(await op(other, "complete", { mediaId: photo.mediaId }), 404, "another link can't complete it");
    t.status(await op(other, "parts", { mediaId: v.mediaId }), 404, "...or resume it");
    t.status(await keep(await c.get(c.site(other, `/media/${photo.mediaId}`), null)), 404, "...or read it");
    const own = await c.get(c.site(link, `/media/${photo.mediaId}`), null);
    const loc = own.headers.get("location") ?? "";
    t.ok(own.status === 302 && /^http:\/\/127\.0\.0\.1:\d+\/o\?t=/.test(loc) && own.headers.get("cache-control") === "no-store", "its own link: a redirect to a signed read (never cached)", own.status);
    const got = loc ? await fetch(loc) : null;
    t.ok(got?.status === 200 && Number(got.headers.get("content-length")) === 10 * MB, "...which serves the checked photo", got?.status);
    const tampered = loc ? await fetch(loc.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"))) : null;
    t.status({ status: tampered?.status ?? 0 }, 403, "a tampered signed address is refused");

    // (7) The daily log cites them: a new ref must be this link's READY upload; the photo + video + a delay video.
    const dv = await upload(link, { area: "DELAY", jobId: job.id }, mp4(MB, 20), { kind: "VIDEO", mime: "video/mp4", durationSec: 20 });
    const logBody = (photos, delayPhotos) => ({ jobId: job.id, crewOk: false, crewNote: "Release check", handCrew: 2, handHours: 8, hours: [{ code: "STR-02", hours: 8 }], noDockets: true,
      note: "Large uploads check", photos, delays: [{ delayCode: "WEATHER", hoursLost: 1, affects: "CREW", photos: delayPhotos }] });
    const sendLog = (l, b) => c.post(c.site(l, "/log"), null, b).then(keep);
    t.status(await sendLog(link, logBody([`media:${bad.mediaId}`], [])), 400, "a log citing a REJECTED upload is refused");
    t.status(await sendLog(other, logBody([photo.done?.body?.ref], [])), 400, "a log on another link citing this link's upload is refused");
    const logged = await sendLog(link, logBody([photo.done?.body?.ref, vRef], [dv.done?.body?.ref]));
    t.ok(logged.status === 201 && logged.body.log?.videos?.includes(vRef) && logged.body.log.videos.includes(dv.done?.body?.ref), "the log saves with a photo, a video and a delay video - the reply marks the videos", JSON.stringify({ s: logged.status, e: logged.body.error }));
    const logRow = await db.dailyLog.findFirst({ where: { jobId: job.id }, orderBy: { revision: "desc" }, select: { id: true } });
    t.ok((await db.mediaObject.count({ where: { id: { in: [photo.mediaId, v.mediaId] }, logId: logRow?.id } })) === 2, "...the uploads remember the log that used them");

    // (8) Office: Day Review / the daily site report / the job page show the video; the routes keep today's guards.
    const dr = await c.json(`/api/day-review/site-logs?date=${day}`, "MANAGER");
    const drJob = (dr.body?.jobs ?? []).find((x) => x.jobId === job.id);
    t.ok(drJob?.latest?.videos?.includes(vRef) && drJob.latest.photos.includes(vRef), "Day Review: the log's video is marked a video", JSON.stringify(drJob?.latest?.videos ?? null));
    const logPhoto = (file, extra = "") => `/api/day-review/site-logs/photo?log=${encodeURIComponent(logRow?.id ?? "")}&file=${encodeURIComponent(file)}${extra}`;
    const mgr = await c.get(logPhoto(vRef), "MANAGER");
    t.ok(mgr.status === 302 && /127\.0\.0\.1/.test(mgr.headers.get("location") ?? ""), "Manager: the video's route redirects to a 5-minute signed read", mgr.status);
    const dl = await c.get(logPhoto(vRef, "&download=1"), "MANAGER");
    const dlGet = dl.headers.get("location") ? await fetch(dl.headers.get("location"), { method: "HEAD" }) : null;
    t.ok(dl.status === 302 && /attachment; filename="site-video-\d{4}-\d{2}-\d{2}\.mp4"/.test(dlGet?.headers.get("content-disposition") ?? ""), "...Download: the same, saved as site-video-<date>.mp4", dlGet?.headers.get("content-disposition"));
    t.status(await c.get(logPhoto(vRef), "VIEWER"), 302, "VIEWER: the log's photos route is open to Viewers today - unchanged");
    for (const who of ["ACCOUNTS", "TIMESHEETS", null]) t.status(await c.get(logPhoto(vRef), who), [401, 403], `${who ?? "no login"}: refused, as today`);
    t.status(await c.get(logPhoto(`media:${bad.mediaId}`), "MANAGER"), 404, "a REJECTED upload the log doesn't hold: 404");
    const rep = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.ok(rep.status === 200 && rep.body?.report?.log?.videos?.includes(vRef) && noMoney(JSON.stringify(rep.body)), "the daily site report marks the video, no dollar figure", rep.status);
    const drep = await c.json(`/api/directors/daily-report/${job.id}`, "DIRECTOR");
    t.ok(drep.status === 200 && drep.body?.report?.log?.videos?.includes(vRef), "...and the directors' copy", drep.status);
    const dirPhoto = `/api/directors/daily-report/photo?log=${encodeURIComponent(logRow?.id ?? "")}&file=${encodeURIComponent(vRef)}`;
    t.status(await c.get(dirPhoto, "DIRECTOR"), 302, "DIRECTOR: the directors' video route redirects");
    t.status(await c.get(dirPhoto, "MANAGER"), [401, 403], "MANAGER: the directors' route is refused, as today");
    const days = await c.json(`/api/daily-report?projectId=${project.id}`, "MANAGER");
    t.ok((days.body?.days ?? []).some((d) => d.jobId === job.id && d.videos >= 2), "the job page's report list says how many videos", JSON.stringify(days.body?.days?.find((d) => d.jobId === job.id) ?? null));

    // (9) Before / after videos: READY makes the set's row; 3 videos a set; the office's route is Manager+ as today.
    let baLast = null;
    for (let i = 0; i < 3; i++) baLast = await upload(link, { area: "BEFORE_AFTER", jobId: job.id, phase: "AFTER" }, mp4(2000, 10), { kind: "VIDEO", mime: "video/mp4", durationSec: 10 });
    const after = baLast?.done?.body?.photos?.after ?? [];
    t.ok(baLast?.done?.status === 200 && after.filter((p) => p.video).length === 3, "three after videos: each READY makes a before / after row (video)", JSON.stringify({ s: baLast?.done?.status, n: after.length }));
    t.status(await op(link, "start", { area: "BEFORE_AFTER", jobId: job.id, phase: "AFTER", kind: "VIDEO", mime: "video/mp4", size: 2000, durationSec: 10 }), 409, "a 4th video in the set: refused (3 a set)");
    const baPhoto = await upload(link, { area: "BEFORE_AFTER", jobId: job.id, phase: "AFTER" }, jpeg(4 * MB));
    t.ok(baPhoto.done?.status === 200, "...a 4 MB before / after photo still goes (the old 3 MB limit is for the old route only)", baPhoto.done?.status);
    const baId = after.find((p) => p.video)?.id;
    const baRoute = (who) => c.get(`/api/day-review/site-logs/before-after?job=${encodeURIComponent(job.id)}&id=${encodeURIComponent(baId ?? "")}`, who);
    t.status(await baRoute("MANAGER"), 302, "Manager: a before / after video redirects to a signed read");
    for (const who of ["VIEWER", "ACCOUNTS", null]) t.status(await baRoute(who), [401, 403], `${who ?? "no login"}: the before / after route refused, as today`);
    t.status(await c.get(`/api/directors/daily-report/before-after?job=${encodeURIComponent(job.id)}&id=${encodeURIComponent(baId ?? "")}`, "DIRECTOR"), 302, "DIRECTOR: the directors' copy too");
    const linkBa = await keep(await c.get(c.site(link, `/log/photos?id=${encodeURIComponent(baId ?? "")}`), null));
    t.status(linkBa, 302, "the link that sent it opens its own video");
    t.status(await keep(await c.get(c.site(other, `/log/photos?id=${encodeURIComponent(baId ?? "")}`), null)), 404, "...another link on the same job can't");
    const otherView = await keep(await c.get(c.site(other, "/log"), null));
    const ov = (otherView.body.jobs ?? []).find((j) => j.jobId === job.id);
    t.ok(ov?.beforeAfter?.after?.some((p) => p.id === baId && p.mine === false && p.video), "...its screen shows it as someone else's (mine: false)");
    const mDr = await c.json(`/api/day-review/site-logs?date=${day}`, "MANAGER");
    t.ok(((mDr.body?.jobs ?? []).find((x) => x.jobId === job.id)?.beforeAfter?.after ?? []).filter((p) => p.video).length === 3, "Day Review: the three after videos");

    // (10) The old routes are unchanged with the feature on (a phone with an older page still works).
    const oldBa = await keep(await fetch(`${c.base}${c.site(link, "/log/photos")}?phase=BEFORE`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, photo: uniqPng() }) }));
    t.status(oldBa, 201, "the old before / after photo route still saves a shrunk photo");
    const oldLog = await sendLog(link, { ...logBody([uniqPng()], []), delays: [], noDelays: true });
    t.status(oldLog, 201, "the old way (a photo inside the log) still saves");

    // (11) Faults: a truck sign-in's token (header), walk-around photos through the bucket, a fault VIDEO, the check.
    const truck = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC uploads truck ${tag}`, identifier: `RU${tag}`.slice(0, 12), ownership: "OWNED", status: "AVAILABLE" } });
    const truck2 = await db.resource.create({ data: { type: "VEHICLE", category: "Tipper", role: "Vehicle", name: `RC uploads truck B ${tag}`, identifier: `RV${tag}`.slice(0, 12), ownership: "OWNED", status: "AVAILABLE" } });
    const point = await makeLink(db, "POSTER", truck.id, { place: "VEHICLE" });
    const point2 = await makeLink(db, "POSTER", truck2.id, { place: "VEHICLE" });
    const A = await db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rcupa Tester ${tag}` } });
    const B = await db.resource.create({ data: { type: "PERSONNEL", category: "Truck Driver", name: `Rcupb Tester ${tag}` } });
    const signIn = async (pt, who) => {
      const scan = await keep(await c.get(`/api/site/in/${encodeURIComponent(pt.secret)}`, null));
      return keep(await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId: pt.id, action: "IN", resourceId: who.id, deviceId: `rc80-${who.id}`, gps: { status: "DENIED" } }));
    };
    const sA = await signIn(point, A);
    const sB = await signIn(point2, B);
    const tokA = sA.body?.prestart, tokB = sB.body?.prestart;
    if (!t.ok(typeof tokA === "string" && typeof tokB === "string", "truck sign-ins hand out pre-start tokens", sA.status)) return;
    const pview = await keep(await c.req("GET", "/api/site/in/prestart", null, undefined, { "x-prestart-token": tokA }));
    t.ok(pview.body?.media?.on === true, "the pre-start view says large uploads are on");
    const pop = (tok, name, body) => c.req("POST", `/api/site/in/prestart/media/${name}`, null, body, tok ? { "x-prestart-token": tok } : {}).then(keep);
    async function pupload(tok, fields, bytes, o = {}) {
      const s = await pop(tok, "start", { ...fields, kind: o.kind ?? "PHOTO", mime: o.mime ?? "image/jpeg", size: bytes.length, durationSec: o.durationSec, deviceId: `rc80-dev-${tag}` });
      if (s.status !== 201) return { start: s };
      if (!s.body.multipart) await put(s.body.put.url, bytes, s.body.put.contentType);
      else for (const p of s.body.urls) await put(p.url, bytes.subarray((p.n - 1) * PARTS, Math.min(bytes.length, p.n * PARTS)));
      return { start: s, done: await pop(tok, "complete", { mediaId: s.body.mediaId }), mediaId: s.body.mediaId };
    }
    t.status(await pop(null, "start", { kind: "PHOTO", mime: "image/jpeg", size: 100 }), 401, "no token: refused");
    t.status(await pop(tokA, "start", { kind: "VIDEO", mime: "video/mp4", size: 2000, durationSec: 5, slot: "FRONT" }), 400, "a walk-around VIDEO: refused (photos only, camera only)");
    const walkaround = {};
    for (const s of ["FRONT", "BACK", "DRIVER", "PASSENGER", "CAB"]) walkaround[s] = (await pupload(tokA, { slot: s }, jpeg(12 * MB))).done?.body?.id;
    t.ok(Object.values(walkaround).every((x) => typeof x === "string"), "five full-quality (12 MB) walk-around photos through the bucket", JSON.stringify(walkaround));
    const fv = await pupload(tokA, {}, mp4(18 * MB, 45), { kind: "VIDEO", mime: "video/quicktime", durationSec: 45 });
    const fvId = fv.done?.body?.id;
    t.ok(fv.start.body?.multipart === true && fv.done?.status === 200 && typeof fvId === "string", "a 45 s fault video (18 MB, multipart): READY, an AssetFaultMedia id like a photo's", JSON.stringify({ s: fv.done?.status, e: fv.done?.body?.error }));
    t.status(await pop(tokB, "complete", { mediaId: fv.mediaId }), 404, "another truck's sign-in can't complete it");
    t.status(await pop(tokB, "parts", { mediaId: fv.mediaId }), 404, "...or resume it");
    const fm = await db.assetFaultMedia.findUnique({ where: { id: fvId ?? "-" } });
    t.ok(fm?.kind === "VIDEO" && fm.mediaId === fv.mediaId && fm.role === "FAULT" && fm.fileName === `media:${fv.mediaId}`, "...recorded under the same pre-start caps (role FAULT, kind VIDEO)");
    const odo = await keep(await c.post("/api/site/in/odometer", null, { token: sA.body?.odometer, dataUrl: uniqPng() }));
    const items = ["tyres", "lights", "brakes", "horn", "mirrors", "seatbelt", "fluids", "leaks", "tipper", "load", "safety-kit", "body"];
    const answers = Object.fromEntries(items.map((k) => [k, k === "tyres" ? "FAULT" : "OK"]));
    const check = await keep(await c.post("/api/site/in/prestart", null, { token: tokA, answers, walkaround, stillThere: [], faults: [{ itemKey: "tyres", description: "Large uploads check - tyre cut", priority: "HIGH", mediaIds: [fvId] }] }));
    t.ok(check.status === 201 && odo.status < 300, "the pre-start goes with the bucket walk-around and the fault video", JSON.stringify({ s: check.status, e: check.body?.error, odo: odo.status }));
    const faults = await c.json(`/api/faults?status=ALL&resource=${truck.id}`, "MANAGER");
    const f = (faults.body?.faults ?? [])[0];
    t.ok(f?.mediaIds?.includes(fvId) && f.videoIds?.includes(fvId), "/faults: the fault carries its video (videoIds)", JSON.stringify(f ? { m: f.mediaIds, v: f.videoIds } : null));
    const fr = (who, extra = "") => c.get(`/api/faults/media/${encodeURIComponent(fvId ?? "")}${extra}`, who);
    t.status(await fr("MANAGER"), 302, "Manager: the fault video redirects to a signed read");
    const fdl = await fr("MANAGER", "?download=1");
    const fdlHead = fdl.headers.get("location") ? await fetch(fdl.headers.get("location"), { method: "HEAD" }) : null;
    t.ok(/attachment; filename="site-video-.*\.mov"/.test(fdlHead?.headers.get("content-disposition") ?? ""), "...Download saves it as a .mov", fdlHead?.headers.get("content-disposition"));
    for (const who of ["VIEWER", "ACCOUNTS", "TIMESHEETS", null]) t.status(await fr(who), [401, 403], `${who ?? "no login"}: /api/faults/media refused, as today`);
    const checks = await c.json(`/api/faults/checks?date=${day}`, "ADMIN");
    t.ok(checks.status === 200, "the Checks tab still answers", checks.status);

    // (12) The company's daily ceiling: one seeded 20 GB row today -> a start is refused (cap ALL for a pre-start), one
    // Admin notice a day (PhotoCapNotice "*media" / MEDIA_DAY), a second refusal adds nothing. Then the seed is removed.
    const seed = await db.mediaObject.create({ data: { area: "DAILY_LOG", kind: "VIDEO", mime: "video/mp4", bytes: 2147483647, objectKey: `rc80/${tag}/seed-a.mp4`, state: "REJECTED", rejectReason: "RC_SEED" } });
    const seed2 = await db.mediaObject.create({ data: { area: "DAILY_LOG", kind: "VIDEO", mime: "video/mp4", bytes: 2147483647, objectKey: `rc80/${tag}/seed-b.mp4`, state: "REJECTED", rejectReason: "RC_SEED" } });
    const extra = [];
    for (let i = 0; i < 9; i++) extra.push((await db.mediaObject.create({ data: { area: "DAILY_LOG", kind: "VIDEO", mime: "video/mp4", bytes: 2147483647, objectKey: `rc80/${tag}/seed-${i}.mp4`, state: "REJECTED", rejectReason: "RC_SEED" } })).id);
    const c1 = await op(link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "PHOTO", mime: "image/jpeg", size: 1000 });
    const c2 = await op(link, "start", { area: "DAILY_LOG", jobId: job.id, kind: "PHOTO", mime: "image/jpeg", size: 1000 });
    const c3 = await pop(tokB, "start", { kind: "PHOTO", mime: "image/jpeg", size: 1000 });
    const notices = await db.photoCapNotice.count({ where: { resourceId: "*media", cap: "MEDIA_DAY" } });
    t.ok(c1.status === 429 && c2.status === 429 && notices === 1, "over the company's 20 GB today: refused, ONE notice for the day", JSON.stringify({ c1: c1.status, c2: c2.status, notices }));
    t.ok(c3.status === 429 && c3.body.capFull === true && c3.body.cap === "ALL", "...a pre-start upload is told cap ALL (an Urgent fault can still go without a photo - PS-010)", JSON.stringify(c3.body));
    await db.mediaObject.deleteMany({ where: { id: { in: [seed.id, seed2.id, ...extra] } } }); // the test copy's own seed only

    // (13) OFF (no MEDIA_* settings) and the kill switch: run through tsx with the protocol itself - it refuses (404)
    // before touching the store; the 24 h abort is OFF unless MEDIA_ABORT_STALE=on.
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    const stale = await upload(link, { area: "DAILY_LOG", jobId: job.id }, mp4(17 * MB, 30), { kind: "VIDEO", mime: "video/mp4", durationSec: 30, skip: [1, 2, 3] });
    await db.mediaObject.update({ where: { id: stale.mediaId }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    if (existsSync(tsxCli)) {
      const proto = "file:///" + path.join(c.p.appDir, "src", "lib", "media", "protocol.ts").split(path.sep).join("/");
      const script = path.join(c.p.files, `rc80-off-${tag}.mts`);
      writeFileSync(script, [
        `import { startUpload, abortStaleMultipart } from ${JSON.stringify(proto)};`,
        `import { mediaStatus } from ${JSON.stringify(proto.replace("protocol.ts", "store.ts"))};`,
        `const party = { source: { siteLinkId: "x", takenBy: "x" }, owns: () => false, prepare: async () => { throw new Error("must not be reached"); }, attach: async () => ({ reply: {} }), replyFor: async () => ({}) };`,
        `const r = await startUpload(party, { kind: "PHOTO", mime: "image/jpeg", size: 10 });`,
        `const aborted = await abortStaleMultipart(new Date(), { force: true });`,
        `console.log("RESULT " + JSON.stringify({ status: r.status, on: mediaStatus().on, aborted }));`,
        `process.exit(0);`,
      ].join("\n"));
      const run = (extraEnv) => {
        const e = { ...process.env, ...env, ...extraEnv };
        for (const k of Object.keys(e)) if (extraEnv[k] === undefined && k in extraEnv) delete e[k];
        let out = "";
        try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: e, encoding: "utf8", timeout: 120_000 }); } catch (x) { out = String(x?.stdout ?? ""); }
        try { return JSON.parse(out.match(/RESULT (.*)/)?.[1] ?? "{}"); } catch { return {}; }
      };
      const off = run({ MEDIA_STORE: undefined, MEDIA_FAKE_DIR: undefined, MEDIA_BUCKET: undefined, MEDIA_REGION: undefined, MEDIA_ACCESS_KEY_ID: undefined, MEDIA_SECRET_ACCESS_KEY: undefined });
      t.ok(off.status === 404 && off.on === false && off.aborted === 0, "no MEDIA_* settings: OFF - the protocol refuses (404), nothing aborted", JSON.stringify(off));
      const kill = run({ MEDIA_UPLOADS: "off" });
      t.ok(kill.status === 404 && kill.on === false, "MEDIA_UPLOADS=off: the kill switch refuses new uploads", JSON.stringify(kill));
      const notOn = run({});
      t.ok(notOn.aborted === 0 && !(await db.mediaObject.findUnique({ where: { id: stale.mediaId } }))?.abortedAt, "the 24 h abort is OFF by default - a 25 h old unfinished upload is left alone", JSON.stringify(notOn));
      const on = run({ MEDIA_ABORT_STALE: "on" });
      const sRow = await db.mediaObject.findUnique({ where: { id: stale.mediaId } });
      t.ok(on.aborted >= 1 && sRow?.abortedAt && sRow.state === "PENDING", "MEDIA_ABORT_STALE=on: the unfinished multipart upload is aborted, its record kept (PENDING + abortedAt)", JSON.stringify({ on, state: sRow?.state }));
      t.status(await op(link, "parts", { mediaId: stale.mediaId }), 410, "...and it can't be carried on (start again)");
    } else t.note("tsx not found - the OFF / kill switch / abort checks were not run");

    // (14) No dollar figure in anything a link was sent.
    t.ok(bodies.every((b) => noMoney(b)), "no $ + digit in any link reply", bodies.find((b) => !noMoney(b))?.slice(0, 80));
  },
};
