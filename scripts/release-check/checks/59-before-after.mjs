// Before and after site photos on the daily log (30 Oct 2026). A supervisor link sends Before and After photos for a
// job it can log today (saved straight away); the 7th in a set is refused; another job's id gets 403; office and
// driver links get 404; a removed photo is hidden (not served). The office's photo route is Manager+ and the
// directors' copy guardDirector - both only for a shown photo of that job. Day Review (Manager+ only - never on a
// Viewer's reply) and the daily site report show both sets. No dollar figure anywhere; no outside call.
// WRITES a job for today on the copy (the supervisor on it), links and photo rows (files go to the run's temp folder).
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
    t.status(await c.get(office(b1?.id), "MANAGER"), 404, "...and never a removed one");
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
