// Regional travel (2 Nov 2026, Ilies): the Regional flag on a project (board badge + toggle), travel out (Start travel
// -> site sign-in) and travel home (Travelling home -> Arrived) from the worker's own phone, the Travel column on
// timesheets and the payroll files, office corrections with a reason, locked weeks refused, no $ on the link.
// WRITES on the test copy: two projects ("RC regional" / "RC local") with a job today each, an allocation, two site
// posters, sign-ins, travel legs and one approved far-past week (for the lock check).
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const HOUR = 3_600_000;

export default {
  id: "regional-travel", title: "Regional travel: flag + badge, out / home legs, refusals, Travel column, corrections, no $ on links",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/app/api/site/in/travel/route.ts") || "needs the travel routes",
  async run(t, c) {
    const db = c.db;
    const today = c.today;
    const jobDate = new Date(today + "T00:00:00.000Z");
    const people = await db.resource.findMany({ where: { type: "PERSONNEL", active: true, attendances: { none: { date: today } } }, select: { id: true, name: true }, take: 3 });
    if (people.length < 3) return t.block("fewer than 3 active Labour-register people without a sign-in today on the snapshot");
    const [person, person2, person3] = people;
    const tag = Date.now().toString(36);
    const reg = await db.project.create({ data: { name: `RC regional ${tag}`, status: "ACTIVE" } });
    const loc = await db.project.create({ data: { name: `RC local ${tag}`, status: "ACTIVE" } });
    const regJob = await db.job.create({ data: { projectId: reg.id, title: reg.name, date: jobDate, shift: "DAY", status: "ACTIVE" } });
    const regNight = await db.job.create({ data: { projectId: reg.id, title: reg.name, date: jobDate, shift: "NIGHT", status: "ACTIVE" } });
    const locJob = await db.job.create({ data: { projectId: loc.id, title: loc.name, date: jobDate, shift: "DAY", status: "ACTIVE" } });
    for (const j of [regJob, regNight, locJob]) await db.assignment.create({ data: { jobId: j.id, resourceId: person.id } });
    await db.assignment.create({ data: { jobId: regJob.id, resourceId: person2.id } }); // regional work, but not on the night job
    await db.assignment.create({ data: { jobId: locJob.id, resourceId: person3.id } }); // no regional work at all
    const regPoster = await makeLink(db, "POSTER", null, { projectId: reg.id });
    const locPoster = await makeLink(db, "POSTER", null, { projectId: loc.id });
    const officePoint = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const supLink = await makeLink(db, "SUPERVISOR", person.id); // the person runs sign-in for their jobs
    const dev = `rc-dev-${tag}`;
    const linkSafe = [];
    const travel = async (body) => {
      const r = await c.post("/api/site/in/travel", null, { deviceId: dev, ...body });
      const j = await r.json().catch(() => ({}));
      linkSafe.push(JSON.stringify(j));
      return { status: r.status, body: j };
    };
    // A scan: a poster / point secret, or the supervisor's changing QR code; then IN / OUT as that person on that phone.
    const sign = async (code, jobId, action, who = person.id, device = dev) => {
      const scan = await c.json(`/api/site/in/${encodeURIComponent(code)}`, null);
      linkSafe.push(JSON.stringify(scan.body ?? {}));
      const r = await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId, action, resourceId: who, deviceId: device, gps: { status: "DENIED" } });
      const j = await r.json().catch(() => ({}));
      linkSafe.push(JSON.stringify(j));
      return { status: r.status, body: j };
    };
    // The supervisor's current QR for one of their jobs (it changes every 30 s - fetched fresh each time).
    const qr = async (jobId) => {
      const s = await c.json(c.site(supLink, "/signin"), null);
      return s.body?.jobs?.find((j) => j.id === jobId)?.qrUrl?.match(/\/in\/([^/?#]+)$/)?.[1] ?? "none";
    };
    // (1) The Regional flag: Manager+ sets it through the project PATCH; a Viewer can't; the board gets it in /api/jobs.
    t.status(await c.patch(`/api/projects/${reg.id}`, "VIEWER", { regional: true }), 403, "a Viewer can't mark a project regional");
    t.status(await c.patch(`/api/projects/${reg.id}`, "ACCOUNTS", { regional: true }), 403, "ACCOUNTS can't mark a project regional");
    t.status(await c.patch(`/api/projects/${reg.id}`, "MANAGER", { regional: true }), 200, "a Manager marks a project regional");
    const jobs = (await c.json(`/api/jobs?date=${today}`, "VIEWER")).body ?? [];
    t.ok(jobs.find((j) => j.id === regJob.id)?.regional === true && jobs.find((j) => j.id === locJob.id)?.regional === false, "/api/jobs carries the badge data (regional true / false)");
    const page = await c.text("/command", "VIEWER");
    t.ok(page.status === 200 && !/Application error/.test(page.text), "the board page loads", page.status);

    // (2) No pass yet: travel refused. AT-001 (Ilies, "Supervisor QR only"): a POINT, a POSTER, an unallocated person or
    // someone with no regional work gets no pass; the supervisor's QR on a regional job they're allocated to does.
    t.status((await travel({ action: "STATUS" })).status, 401, "travel without a pass is refused");
    const pt = await sign(officePoint.secret, officePoint.id, "IN");
    t.ok(pt.status === 200 && !pt.body.travelPass, "AT-001: an office / yard / truck POINT sign-in gives no pass", pt.status);
    await sign(officePoint.secret, officePoint.id, "OUT");
    const inLoc = await sign(locPoster.secret, locJob.id, "IN");
    t.ok(inLoc.status === 200 && !inLoc.body.travelPass, "AT-001: a POSTER sign-in gives no pass", inLoc.status);
    t.ok(inLoc.body.travelLink === true, "the phone is still told there's regional work coming up (travel page link)");
    const outLoc = await sign(locPoster.secret, locJob.id, "OUT");
    t.ok(outLoc.status === 200 && !outLoc.body.travelHome && !outLoc.body.travelPass, "signing out of a LOCAL job offers no trip home (and no pass)", outLoc.status);
    const inQr = await sign(await qr(regNight.id), regNight.id, "IN");
    t.ok(inQr.status === 200 && typeof inQr.body.travelPass === "string", "the supervisor's QR on a regional job they're allocated to gives the pass", `${inQr.status} ${inQr.body.error ?? ""}`);
    const pass = inQr.body.travelPass;
    const unalloc = await sign(await qr(regNight.id), regNight.id, "IN", person2.id, `${dev}-2`);
    t.ok(unalloc.status === 200 && !unalloc.body.travelPass, "AT-001: the supervisor's QR but NOT on that job's allocation gives no pass", `${unalloc.status} ${unalloc.body.error ?? ""}`);
    const noReg = await sign(await qr(locJob.id), locJob.id, "IN", person3.id, `${dev}-3`);
    t.ok(noReg.status === 200 && !noReg.body.travelPass && noReg.body.travelLink === false, "AT-001: the supervisor's QR, allocated, but no regional work gives no pass", `${noReg.status} ${noReg.body.error ?? ""}`);
    t.status((await travel({ pass, deviceId: "another-phone", action: "STATUS" })).status, 401, "the pass doesn't work on another phone");
    t.status((await travel({ pass, action: "START_HOME" })).status, 409, "travelling home after a local sign-out is refused");
    // (3) Travel out: only the regional job is offered; the local one is refused; a second tap is the same leg.
    const st = await travel({ pass, action: "STATUS" });
    t.ok(st.status === 200 && st.body.outJobs?.some((j) => j.jobId === regJob.id) && !st.body.outJobs?.some((j) => j.jobId === locJob.id), "only the regional job is offered", JSON.stringify(st.body).slice(0, 200));
    t.status((await travel({ pass, action: "START_OUT", jobId: locJob.id })).status, 403, "Start travel on a local job is refused");
    const s1 = await travel({ pass, action: "START_OUT", jobId: regJob.id, gps: { status: "OK", lat: -33.28, lng: 149.1, accuracy: 20 } });
    t.ok(s1.status === 200 && s1.body.leg?.id, "Start travel on the regional job", s1.status);
    const s2 = await travel({ pass, action: "START_OUT", jobId: regJob.id });
    t.ok(s2.status === 200 && s2.body.leg?.id === s1.body.leg?.id, "a second tap shows the same leg");
    t.ok((await db.travelLeg.count({ where: { resourceId: person.id, jobId: regJob.id, direction: "OUT" } })) === 1, "no duplicate leg");
    t.status((await travel({ pass, action: "START_HOME" })).status, 409, "no trip home while travelling out");

    // (4) The site sign-in ends the outward leg.
    const inReg = await sign(regPoster.secret, regJob.id, "IN");
    t.ok(inReg.status === 200 && /Travel ended/.test(inReg.body.message ?? ""), "signing in on site ends travel", inReg.body.message);
    t.ok(!inReg.body.travelPass, "AT-001: the regional site POSTER (allocated) gives no pass either");
    const outLeg = await db.travelLeg.findUnique({ where: { id: s1.body.leg.id } });
    t.ok(outLeg?.endAt && outLeg.endMethod === "SIGN_IN" && outLeg.endAttendanceId, "leg ended by the sign-in (endMethod SIGN_IN)");

    // (5) Travel home: offered after a regional sign-out, once; Arrived ends it.
    const outReg = await sign(regPoster.secret, regJob.id, "OUT");
    t.ok(outReg.status === 200 && outReg.body.travelHome === true, "a regional sign-out offers Travelling home", outReg.status);
    const h1 = await travel({ pass, action: "START_HOME", gps: { status: "TIMEOUT" } });
    t.ok(h1.status === 200 && h1.body.leg?.direction === "HOME", "Travelling home starts", h1.status);
    const h2 = await travel({ pass, action: "START_HOME" });
    t.ok(h2.status === 200 && h2.body.leg?.id === h1.body.leg?.id, "a second tap shows the same home leg");
    t.status((await travel({ pass, action: "ARRIVED", gps: { status: "DENIED" } })).status, 200, "Arrived ends the home leg");
    t.status((await travel({ pass, action: "ARRIVED" })).status, 404, "Arrived twice: nothing open");
    t.ok((await db.travelLeg.findUnique({ where: { id: h1.body.leg.id } }))?.endMethod === "ARRIVED", "home leg ended by Arrived");

    // (6) Never ended and over the cap: no hours, flagged (seeded legs on the local job).
    const never = await db.travelLeg.create({ data: { direction: "OUT", resourceId: person.id, workerName: person.name, jobId: locJob.id, projectId: loc.id, siteLabel: loc.name, date: today, startAt: new Date(Date.now() - 9 * HOUR) } });
    const long = await db.travelLeg.create({ data: { direction: "HOME", resourceId: person.id, workerName: person.name, jobId: locJob.id, projectId: loc.id, siteLabel: loc.name, date: today, startAt: new Date(Date.now() - 10 * HOUR), endAt: new Date(), endMethod: "ARRIVED" } });

    // (7) Timesheets: the Travel column for Managers, TIMESHEETS and the Accounts view; site hours unchanged by travel.
    const week = c.thisWeek;
    for (const [who, path] of [["MANAGER", `/api/timesheets?week=${week}`], ["TIMESHEETS", `/api/timesheets?week=${week}`], ["ACCOUNTS", `/api/accounts/timesheets?week=${week}`]]) {
      const w = (await c.json(path, who)).body;
      const p = w?.people?.find((x) => x.resourceId === person.id);
      const legs = Object.values(p?.travel ?? {}).flat();
      t.ok(legs.length === 4 && typeof p.travelTotal === "number" && typeof w.travelHours === "number", `${who}: the person's four travel legs and a travel total`, `${legs.length}`);
      if (who === "MANAGER") {
        t.ok(legs.find((l) => l.legId === never.id)?.flag === "NOT_ENDED" && legs.find((l) => l.legId === never.id)?.hours === null, "never ended: flagged, no hours");
        t.ok(legs.find((l) => l.legId === long.id)?.flag === "OVER_CAP" && legs.find((l) => l.legId === long.id)?.hours === null, "over 8h: flagged, no hours");
        t.ok(w.travelIssues >= 2, "travel issues counted for the office");
        const siteHours = Object.values(p.days).flat().reduce((n, l) => n + (l.hours ?? 0), 0);
        t.ok(Math.abs(siteHours - p.total) < 0.01, "site hours total is the sign-ins only (travel not added)");
        t.ok(!/gps/i.test(JSON.stringify(w)), "no GPS in the Managers' timesheets");
      }
    }
    for (const [who, path] of [["MANAGER", `/api/timesheets/export?week=${week}`], ["ACCOUNTS", `/api/accounts/timesheets/export?week=${week}`]]) {
      const csv = (await c.text(path, who)).text;
      t.ok(csv.includes("Hours,Travel (h),Status") && csv.includes("Travel out to") && csv.includes("Travel home from") && noMoney(csv), `${who} timesheet export has the Travel column and legs, no $`);
    }
    // Payroll files (accounts): a Travel hours column, still hours only. On a week of its own (2020-02-03), because
    // earlier checks seed "$5 Labour" sign-ins this week and the payroll files refuse a week with a $ in a name.
    const payWeek = "2020-02-03";
    await db.siteAttendance.create({ data: { place: "OFFICE", placeLabel: "Office", date: "2020-02-04", resourceId: person.id, workerName: person.name, signInAt: new Date("2020-02-03T21:00:00Z"), signOutAt: new Date("2020-02-04T05:30:00Z"), signInMethod: "OFFICE", status: "CONFIRMED" } });
    await db.travelLeg.create({ data: { direction: "HOME", resourceId: person.id, workerName: person.name, jobId: `rc-pay-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-02-04", startAt: new Date("2020-02-04T05:40:00Z"), endAt: new Date("2020-02-04T07:40:00Z"), endMethod: "ARRIVED" } });
    for (const f of ["payrun", "summary"]) {
      const r = await c.text(`/api/accounts/payroll/export?week=${payWeek}&file=${f}`, "ACCOUNTS");
      const csv = r.text;
      t.ok(r.status === 200 && /Travel hours/.test(csv) && noMoney(csv) && !/\bBSB\b|\bTFN\b|\bABA\b/i.test(csv), `payroll ${f} file: Travel hours column, no money`, `${r.status} ${csv.slice(0, 160)}`);
      if (f === "summary") t.ok(csv.split("\n").some((l) => l.startsWith(person.name) && /,2\r?$/.test(l)), "summary: the person's 2h travel in Travel hours", csv.slice(0, 300));
    }
    // (7b) Ilies (2 Nov 2026): a leg never ended blocks the week's approval until the office fixes it with a reason.
    const blockLeg = await db.travelLeg.create({ data: { direction: "OUT", resourceId: person.id, workerName: person.name, jobId: `rc-block-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-02-05", startAt: new Date("2020-02-04T19:00:00Z") } });
    const refused = await c.post("/api/timesheets", "MANAGER", { week: payWeek, action: "approve" });
    const refusedBody = await refused.json().catch(() => ({}));
    t.ok(refused.status === 400 && /travel never ended/.test(refusedBody.error ?? ""), "approve refused while a travel leg was never ended", `${refused.status} ${refusedBody.error ?? ""}`);
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "MANAGER", { endAt: "2020-02-04T21:30:00.000Z", reason: "Release check - arrival time from the supervisor" }), 200, "the office ends it with a reason");
    t.status(await c.post("/api/timesheets", "MANAGER", { week: payWeek, action: "approve" }), 200, "approve allowed once the leg is fixed");
    const thisWeekPay = await c.get(`/api/accounts/payroll/export?week=${week}&file=summary`, "ACCOUNTS");
    if (thisWeekPay.status !== 200) t.note(`this week's payroll summary answers ${thisWeekPay.status} on the copy - earlier checks seed $ names this week (pre-existing fileIsSafe refusal, not travel)`);
    // GPS: accounts / Admins only (the payroll week), never the Sign-ins page.
    const pay = await c.text(`/api/accounts/payroll?week=${week}`, "ACCOUNTS");
    t.ok(pay.status === 200 && /"travel":\[/.test(pay.text) && /-33\.28/.test(pay.text), "accounts see the travel legs with the start GPS point");
    const att = await c.json(`/api/attendance?date=${today}`, "MANAGER");
    t.ok(att.body?.travel?.some((l) => l.legId === s1.body.leg.id) && !/gps/i.test(JSON.stringify(att.body?.travel ?? [])), "Sign-ins page lists the legs, without GPS");

    // (8) Office corrections: Manager+, a reason, kept; a locked week refuses.
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "ACCOUNTS", { endAt: new Date().toISOString(), reason: "rc" }), 403, "ACCOUNTS can't correct travel");
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "VIEWER", { endAt: new Date().toISOString(), reason: "rc" }), 403, "a Viewer can't correct travel");
    if (c.users.COORDINATOR) {
      t.status(await c.patch(`/api/attendance/travel/${never.id}`, "COORDINATOR", { endAt: new Date().toISOString(), reason: "rc" }), 403, "the COORDINATOR can't correct travel (view only)");
      t.status(await c.patch(`/api/projects/${reg.id}`, "COORDINATOR", { regional: false }), 403, "the COORDINATOR can't change the Regional flag");
      const cw = (await c.json(`/api/timesheets?week=${week}`, "COORDINATOR")).body;
      t.ok(Object.values(cw?.people?.find((x) => x.resourceId === person.id)?.travel ?? {}).flat().length === 4, "the COORDINATOR sees the Travel column (view only)");
      const ca = (await c.json(`/api/attendance?date=${today}`, "COORDINATOR")).body;
      t.ok(ca?.travel?.some((l) => l.legId === s1.body.leg.id) && !/gps/i.test(JSON.stringify(ca?.travel ?? [])), "the COORDINATOR sees the travel legs on Sign-ins, without GPS");
    } else t.note("no COORDINATOR test login on this build - its travel checks skipped");
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "MANAGER", { endAt: new Date().toISOString() }), 400, "a correction needs a reason");
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "MANAGER", { endAt: new Date(Date.now() - 6 * HOUR).toISOString(), reason: "Release check - forgot to sign in on site" }), 200, "a Manager corrects a travel time with a reason");
    const fixed = await db.travelLeg.findUnique({ where: { id: never.id }, include: { edits: true } });
    t.ok(fixed?.endMethod === "OFFICE" && fixed.edits.length === 1 && fixed.edits[0].reason.startsWith("Release check"), "the change and its reason are kept (TravelEdit)");
    const lockedWeek = "2020-01-06";
    await db.timesheetWeek.create({ data: { weekStart: lockedWeek, approvedBy: "Release check", snapshot: JSON.stringify({ weekStart: lockedWeek, lines: [] }), totalHours: 0, people: 0 } });
    const old = await db.travelLeg.create({ data: { direction: "OUT", resourceId: person.id, workerName: person.name, jobId: `rc-old-${tag}`, projectId: loc.id, siteLabel: loc.name, date: "2020-01-07", startAt: new Date("2020-01-06T20:00:00Z") } });
    t.status(await c.patch(`/api/attendance/travel/${old.id}`, "MANAGER", { endAt: "2020-01-06T23:00:00.000Z", reason: "Release check" }), 400, "a locked (approved) week refuses a travel change");

    // (9) Turning regional off keeps every leg; travel is no longer offered for it.
    const before = await db.travelLeg.count({ where: { projectId: reg.id } });
    t.status(await c.patch(`/api/projects/${reg.id}`, "MANAGER", { regional: false }), 200, "a Manager marks it local again");
    t.ok((await db.travelLeg.count({ where: { projectId: reg.id } })) === before && before === 4, "its travel legs are all kept (out, home, the payroll-week one, the approval-block one)", `${before}`);
    const st2 = await travel({ pass, action: "STATUS" });
    t.ok(st2.status === 200 && !st2.body.outJobs?.some((j) => j.jobId === regJob.id && !j.leg), "not offered once it's local");

    // (10) Nothing with a dollar figure on any link answer.
    t.ok(linkSafe.every(noMoney), `no $ in ${linkSafe.length} link answers`);
    t.ok(!linkSafe.some((s) => /gps(Lat|Lng)|startGps|endGps/.test(s)), "no GPS sent back to the phone");
    const tp = await c.text("/site/in/travel", null);
    t.ok(tp.status === 200 && !/Application error/.test(tp.text), "the travel page opens with no login", tp.status);
  },
};
