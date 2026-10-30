// Before and after site photos on the daily log (30 Oct 2026). A supervisor link sends Before and After photos for a
// job it can log today (saved straight away); the 7th in a set is refused; another job's id gets 403; office and
// driver links get 404; a removed photo is hidden (not served). The office's photo route is Manager+ and the
// directors' copy guardDirector - both only for a shown photo of that job. Day Review (Manager+ only - never on a
// Viewer's reply) and the daily site report show both sets. No dollar figure anywhere; no outside call.
// Security fixes (30 Oct 2026): SEC-BA-001 40 a link a day (removed count) and 3 MB a photo; SEC-BA-002 413 over 9 MB
// before reading; SEC-BA-003 magic bytes (also tool photos and the log's own photos); SEC-BA-004 removed photos for
// Managers only. The supervisor guide: only on links with the daily log.
// WRITES a job for today on the copy (the supervisor on it), links and photo rows (files go to the run's temp folder).
import http from "node:http";
import { makeLink } from "../lib/setup.mjs";

const sydneyDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const noMoney = (x) => !/\$\s?\d/.test(JSON.stringify(x ?? ""));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  id: "before-after", title: "Before and after site photos: link upload, 6 a set, job check, office / directors' routes, no money",
  writes: true,
  applies: (c) => c.hasPath("src/app/api/site/[token]/log/photos/route.ts") || "needs the before / after photos route",
  async run(t, c) {
    const L = c.links;
    if (!L.sup || !L.office) return t.block(L.missing.join("; "));
    const day = sydneyDay();
    const project = await c.db.project.findFirst({ where: { archived: false, jobs: { none: { date: new Date(`${day}T00:00:00Z`) } } }, select: { id: true, name: true } });
    if (!project) return t.block("no active project without a job today on the copy");
    const job = await c.db.job.create({ data: { title: project.name, projectId: project.id, date: new Date(`${day}T00:00:00Z`), shift: "DAY", startTime: "6:30am", endTime: "3pm" } });
    await c.db.assignment.create({ data: { jobId: job.id, resourceId: L.sup.resourceId } });
    const link = await makeLink(c.db, "SUPERVISOR", L.sup.resourceId);
    const driver = await makeLink(c.db, "DRIVER", L.sup.resourceId);
    // An upload names its set in the address (SEC-BA-002: checked before the photo is read); a remove sends none.
    const post = (l, { phase, ...body }) => fetch(`${c.base}${c.site(l, "/log/photos")}${phase ? `?phase=${encodeURIComponent(phase)}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    // Who can't.
    t.status(await post(L.office, { jobId: job.id, phase: "BEFORE", photo: PNG }), 404, "an office link can't send before / after photos");
    t.status(await post(driver, { jobId: job.id, phase: "BEFORE", photo: PNG }), 404, "a driver link can't send them");
    t.status(await c.get(c.site(L.office, "/log/photos?id=x"), null), 404, "an office link can't fetch one");
    t.status(await post(link, { jobId: "not-a-job", phase: "BEFORE", photo: PNG }), 403, "another job's id: 403");
    t.status(await post(link, { jobId: job.id, phase: "DURING", photo: PNG }), 400, "only BEFORE or AFTER");
    t.status(await post(link, { jobId: job.id, phase: "BEFORE", photo: "data:text/html;base64,PGI+" }), 400, "not an image: refused");

    // Before: 6, then the 7th refused.
    let last = null;
    for (let i = 1; i <= 6; i++) {
      const r = await post(link, { jobId: job.id, phase: "BEFORE", photo: PNG });
      last = await r.json().catch(() => ({}));
      if (r.status !== 201) { t.status(r, 201, `before photo ${i} saved`); break; }
    }
    t.ok(last?.photos?.before?.length === 6 && noMoney(last), "6 before photos saved straight away, names and times only", JSON.stringify(last?.photos?.before?.map((p) => p.atLabel)));
    t.ok(last?.photos?.before?.every((p) => !("fileName" in p)), "...no file name goes back to the phone");
    const seventh = await post(link, { jobId: job.id, phase: "BEFORE", photo: PNG });
    t.status(seventh, 409, "the 7th before photo is refused");
    t.ok(/6 photos already/.test((await seventh.json().catch(() => ({}))).error ?? ""), "...saying to remove one first");

    // After: one, with no log sent (saved without it).
    const after = await post(link, { jobId: job.id, phase: "AFTER", photo: PNG });
    const afterBody = await after.json().catch(() => ({}));
    t.status(after, 201, "an after photo is saved with no log sent");
    const [b1] = afterBody.photos?.before ?? [];
    const [a1] = afterBody.photos?.after ?? [];

    // The link sees its own photo; remove hides one and frees its place.
    const img = await c.get(c.site(link, `/log/photos?id=${b1?.id}`), null);
    t.ok(img.status === 200 && /image\//.test(img.headers.get("content-type") ?? ""), "the link fetches its own photo", img.status);
    const hid = await post(link, { hide: b1?.id });
    const hidBody = await hid.json().catch(() => ({}));
    t.ok(hid.status === 200 && hidBody.photos?.before?.length === 5, "remove hides it (5 left)", hid.status);
    const row = await c.db.siteLogPhoto.findUnique({ where: { id: b1?.id } });
    t.ok(row && row.hiddenAt && row.hiddenBy, "...the row is kept, with who and when");
    t.status(await c.get(c.site(link, `/log/photos?id=${b1?.id}`), null), 404, "...and a removed photo isn't served");
    t.status(await post(link, { jobId: job.id, phase: "BEFORE", photo: PNG }), 201, "...its place is free again (6)");

    // The log screen carries the sets.
    const view = await c.json(c.site(link, "/log"), null);
    const vj = (view.body?.jobs ?? []).find((j) => j.jobId === job.id);
    t.ok(vj?.beforeAfter?.before?.length === 6 && vj.beforeAfter.after.length === 1 && noMoney(view.body), "the link's log shows 6 before and 1 after", JSON.stringify(vj?.beforeAfter ? { b: vj.beforeAfter.before.length, a: vj.beforeAfter.after.length } : null));

    // Day Review: Managers and Admins see both sets; a Viewer sees neither.
    for (const who of ["MANAGER", "ADMIN"]) {
      const r = await c.json(`/api/day-review/site-logs?date=${day}`, who);
      const j = (r.body?.jobs ?? []).find((x) => x.jobId === job.id);
      t.ok(j?.beforeAfter?.before?.length === 6 && j.beforeAfter.after.length === 1 && !j.beforeAfter.noBefore && !j.beforeAfter.noAfter, `${who}: Day Review shows both sets`, JSON.stringify(j?.beforeAfter ? { b: j.beforeAfter.before.length, a: j.beforeAfter.after.length } : null));
      const s = (r.body?.summary ?? []).find((x) => x.jobId === job.id);
      t.ok(s && s.noBefore === false && s.noAfter === false, `${who}: the summary has the photo flags`);
      t.ok(noMoney(r.body), `${who}: no dollar figure`);
    }
    const vr = await c.json(`/api/day-review/site-logs?date=${day}`, "VIEWER");
    t.status({ status: vr.status }, 200, "VIEWER: Day Review's site logs still open");
    const vjob = (vr.body?.jobs ?? []).find((x) => x.jobId === job.id);
    const vsum = (vr.body?.summary ?? []).find((x) => x.jobId === job.id);
    t.ok(vjob && !("beforeAfter" in vjob) && vsum && !("noBefore" in vsum), "VIEWER: no before / after photos or flags in the reply");

    // The office's photo route: Manager+, that job's shown photos only.
    const office = (id, jobId = job.id) => `/api/day-review/site-logs/before-after?job=${encodeURIComponent(jobId)}&id=${encodeURIComponent(id ?? "")}`;
    const ok = await c.get(office(a1?.id), "MANAGER");
    t.ok(ok.status === 200 && /image\//.test(ok.headers.get("content-type") ?? ""), "a Manager gets an after photo", ok.status);
    t.status(await c.get(office(a1?.id, "another-job"), "MANAGER"), 404, "...only with its own job");
    // SEC-BA-004: a removed photo is still there for Managers (greyed out), never for the directors' copy or a link.
    t.status(await c.get(office(b1?.id), "MANAGER"), 200, "...a removed one too, for a Manager (shown greyed out)");
    for (const who of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) t.status(await c.get(office(a1?.id), who), [401, 403], `${who}: the office's photo route is refused`);
    t.status(await c.get(office(a1?.id), null), [401, 403], "no login: refused");

    // The directors' copy: guardDirector, its own route.
    const dir = (id, jobId = job.id) => `/api/directors/daily-report/before-after?job=${encodeURIComponent(jobId)}&id=${encodeURIComponent(id ?? "")}`;
    t.status(await c.get(dir(a1?.id), "DIRECTOR"), 200, "a DIRECTOR login gets the photo on the directors' copy");
    t.status(await c.get(dir(a1?.id, "another-job"), "DIRECTOR"), 404, "...only with its own job");
    for (const who of ["MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS"]) t.status(await c.get(dir(a1?.id), who), [401, 403], `${who}: the directors' photo route is refused`);

    // The daily site report shows both sets (office and directors).
    const rep = await c.json(`/api/daily-report/${job.id}`, "MANAGER");
    t.ok(rep.status === 200 && rep.body?.report?.beforeAfter?.before?.length === 6 && rep.body.report.beforeAfter.after.length === 1 && noMoney(rep.body), "the daily site report shows both sets, no dollar figure", rep.status);
    const drep = await c.json(`/api/directors/daily-report/${job.id}`, "DIRECTOR");
    t.ok(drep.status === 200 && drep.body?.report?.beforeAfter?.after?.length === 1 && noMoney(drep.body), "...and the directors' copy", drep.status);

    // SEC-BA-004: removed photos - Managers see them (greyed, who and when); never a link, a Viewer or the directors' copy.
    const mgr = await c.json(`/api/day-review/site-logs?date=${day}`, "MANAGER");
    const mj = (mgr.body?.jobs ?? []).find((x) => x.jobId === job.id);
    const gone = (mj?.beforeAfter?.removed ?? []).find((r) => r.id === b1?.id);
    t.ok(gone && gone.phase === "BEFORE" && gone.removedBy && gone.removedAtLabel, "Manager: Day Review lists the removed photo with who removed it and when", JSON.stringify(gone ?? null));
    t.ok(rep.body?.report?.beforeAfter?.removed?.some((r) => r.id === b1?.id), "...and so does the office's daily site report");
    t.ok(!drep.body?.report?.beforeAfter?.removed && !JSON.stringify(drep.body ?? {}).includes(b1?.id ?? "-"), "the directors' copy has no removed photos");
    t.status(await c.get(dir(b1?.id), "DIRECTOR"), 404, "...and its photo route won't serve one");
    const vAgain = await c.json(`/api/day-review/site-logs?date=${day}`, "VIEWER");
    t.ok(!JSON.stringify(vAgain.body ?? {}).includes(b1?.id ?? "-"), "VIEWER: the removed photo is nowhere in the reply");
    const linkAgain = await c.json(c.site(link, "/log"), null);
    t.ok(!JSON.stringify(linkAgain.body ?? {}).includes(b1?.id ?? "-") && !JSON.stringify(linkAgain.body ?? {}).includes("removed"), "the link's log: no removed photos");

    // SEC-BA-003: only real image bytes are kept - here, on a tool photo and on the daily log's own photos.
    const fake = "data:image/png;base64," + Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    const fakeRes = await post(link, { jobId: job.id, phase: "AFTER", photo: fake });
    t.status(fakeRes, 400, "a photo whose bytes aren't an image is refused (magic bytes)");
    t.ok(/JPEG, PNG or WebP/.test((await fakeRes.json().catch(() => ({}))).error ?? ""), "...saying what's allowed");
    const toolPhoto = (dataUrl) => fetch(`${c.base}${c.site(link, "/photos")}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "CONDITION", dataUrl }) });
    const tp = await toolPhoto(PNG);
    t.ok(tp.status >= 200 && tp.status < 300, "a tool photo from the link still saves", tp.status);
    t.status(await toolPhoto(fake), 400, "...and a fake one is refused there too");
    const logWithPhoto = await fetch(`${c.base}${c.site(link, "/log")}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, crewOk: false, crewNote: "Release check", handCrew: 2, handHours: 8, hours: [{ code: "STR-02", hours: 8 }], noDelays: true, noDockets: true, note: "Photo check", photos: [PNG] }),
    });
    t.status(logWithPhoto, 201, "a daily log with a photo of the day still saves");

    // SEC-BA-002: a declared body over 9 MB is refused before it's read; SEC-BA-001: a photo over 3 MB is refused.
    // A raw request with a real 10 MB body (the server may answer before it's all sent); never left hanging - 20 s.
    const raw = (body) => new Promise((resolve) => {
      const u = new URL(`${c.base}${c.site(link, "/log/photos")}?phase=AFTER`);
      let done = false;
      const finish = (st) => { if (!done) { done = true; clearTimeout(timer); rq.destroy(); resolve(st); } };
      const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: { "content-type": "application/json", "content-length": String(body.length) } }, (res) => { res.resume(); finish(res.statusCode); });
      const timer = setTimeout(() => finish(-2), 20_000);
      rq.on("error", () => finish(-1));
      rq.write(body);
      rq.end();
    });
    t.status({ status: await raw(Buffer.alloc(10 * 1024 * 1024, 0x78)) }, 413, "a 10 MB upload: 413 before it's read");
    const big = "data:image/png;base64," + Buffer.concat([Buffer.from(PNG.split(",")[1], "base64"), Buffer.alloc(3 * 1024 * 1024 + 10)]).toString("base64");
    t.status(await post(link, { jobId: job.id, phase: "AFTER", photo: big }), 413, "a photo over 3 MB: 413");

    // SEC-BA-001: 40 photos a link a Sydney day - removed ones count too.
    const capLink = await makeLink(c.db, "SUPERVISOR", L.sup.resourceId);
    await c.db.siteLogPhoto.createMany({ data: Array.from({ length: 40 }, () => ({ jobId: job.id, day, phase: "AFTER", fileName: "0-0000000000000000.png", siteLinkId: capLink.id, takenBy: "release check", hiddenAt: new Date(), hiddenBy: "release check" })) });
    const capped = await post(capLink, { jobId: job.id, phase: "AFTER", photo: PNG });
    t.status(capped, 429, "the 41st photo from a link today is refused (40 sent, all removed)");
    const capMsg = (await capped.json().catch(() => ({}))).error;
    t.ok(capMsg === "That's the most photos this link can send in a day - call the office.", "...with the exact message", capMsg);

    // The supervisor guide: on links with the daily log (supervisor, hand-over on their job) - never office, poster or driver.
    const home = (l) => c.json(c.site(l), null);
    const supHome = await home(link);
    t.ok(supHome.status === 200 && typeof supHome.body?.guide === "number", "SUPERVISOR: the guide is offered", JSON.stringify(supHome.body?.guide));
    const hand = await makeLink(c.db, "HANDOVER", L.sup.resourceId, { jobId: job.id, expiresAt: new Date(Date.now() + 3600_000) });
    const handHome = await home(hand);
    t.ok(handHome.status === 200 && typeof handHome.body?.guide === "number", "HANDOVER on the supervisor's job: the guide is offered", handHome.status);
    const offHome = await home(L.office);
    t.ok(offHome.status === 200 && !("guide" in (offHome.body ?? {})), "OFFICE: no guide", offHome.status);
    const poster = await makeLink(c.db, "POSTER", L.sup.resourceId);
    const posterHome = await home(poster);
    t.ok(posterHome.status === 404 || !("guide" in (posterHome.body ?? {})), "POSTER: no guide", posterHome.status);
    const driverHome = await home(driver);
    t.ok(driverHome.status === 404 || !("guide" in (driverHome.body ?? {})), "DRIVER: no guide", driverHome.status);
    t.ok(noMoney(supHome.body) && noMoney(handHome.body), "no dollar figure on the link home");

    // Missing sets: a job with no photos shows "No before photos" on the report (read after the day).
    const project2 = await c.db.project.findFirst({ where: { archived: false, jobs: { none: { date: new Date(`${day}T00:00:00Z`) } } }, select: { id: true, name: true } });
    if (project2) {
      const job2 = await c.db.job.create({ data: { title: project2.name, projectId: project2.id, date: new Date(`${day}T00:00:00Z`), shift: "DAY", startTime: "6:30am", endTime: "3pm" } });
      await c.db.assignment.create({ data: { jobId: job2.id, resourceId: L.sup.resourceId } });
      const r2 = await c.json(`/api/daily-report/${job2.id}`, "MANAGER");
      t.ok(r2.body?.report?.beforeAfter?.noBefore === true && r2.body.report.beforeAfter.noAfter === true, "a job with no photos: the report says no before and no after photos");
      const l2 = await c.json(c.site(link, "/log"), null);
      t.ok((l2.body?.jobs ?? []).find((j) => j.jobId === job2.id)?.beforeAfter?.noBefore === true, "...and the link's log says no before photos");
    }
  },
};
