// Regional travel (2 Nov 2026, Ilies): the Regional flag on a project (board badge + toggle), travel out (Start travel
// -> site sign-in) and travel home (Travelling home -> Arrived) from the worker's own phone, the Travel column on
// timesheets and the payroll files, office corrections with a reason, locked weeks refused, no $ on the link.
// Travel pay (Ilies, 23-24 Nov 2026): the phone's mode (own car/ute or passenger) is required, Start travel is refused on
// an open truck sign-in, paid hours (passenger 1h less each way, own vehicle in full) on the screens, exports and the
// approved snapshot, office mode corrections (Manager+, reason, TravelEdit, locked weeks refuse).
// Travel design (Ilies, 24 Nov 2026): only SUPERVISOR / DRIVER link-holders record travel (no link = refused on the
// server, nothing offered); crew's travel worked out from the driver they travelled with (truck QR or own leg, +-30 min,
// paid 1h less each way); own car pays full, passenger 1h less; TP-001 (a leg over the person's own sign-ins pays nothing
// and blocks approval) with option A's one-tap "End yard sign-in when the truck left"; "no driver found" amber, the
// office adds the leg; TP-003 (a travel change after Victoria approved drops the person from the pay-run); TP-005 (Travel
// paid hours last in the pay-run file).
// WRITES on the test copy: two projects ("RC regional" / "RC local") with a job today each, an allocation, two site
// posters, sign-ins, travel legs and one approved far-past week (for the lock check); for the 24 Nov 2026 design a
// third project ("RC regional crew") with a job on Tue 5 Mar 2019, DRIVER / SUPERVISOR links for three people, seeded
// truck / site / Yard sign-ins and legs, an office-added leg, an approved (reopened, re-approved) week and a payroll review.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const HOUR = 3_600_000;

export default {
  id: "regional-travel", title: "Regional travel: flag + badge, out / home legs, refusals, Travel + paid travel columns, mode, corrections, no $ on links",
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
    // Shift rollover (19 Nov 2026): tonight's night shift takes sign-ins only from 12 noon Sydney - before noon the
    // night job is last night's (it takes sign-ins until 2pm), so the QR sign-in below works whenever the check runs.
    const sydHour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const nightDate = sydHour < 12 ? new Date(jobDate.getTime() - 86_400_000) : jobDate;
    const regNight = await db.job.create({ data: { projectId: reg.id, title: reg.name, date: nightDate, shift: "NIGHT", status: "ACTIVE" } });
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
    // Off the night job before travelling (TP-001: a leg over one of their own open sign-ins would count nothing).
    t.status((await sign(await qr(regNight.id), regNight.id, "OUT")).status, 200, "signed out of the night job before Start travel");
    // (3) Travel out: only the regional job is offered; the local one is refused; a second tap is the same leg.
    const st = await travel({ pass, action: "STATUS" });
    t.ok(st.status === 200 && st.body.outJobs?.some((j) => j.jobId === regJob.id) && !st.body.outJobs?.some((j) => j.jobId === locJob.id), "only the regional job is offered", JSON.stringify(st.body).slice(0, 200));
    t.status((await travel({ pass, action: "START_OUT", jobId: locJob.id, mode: "PASSENGER" })).status, 403, "Start travel on a local job is refused");
    // Travel pay (Ilies, 23-24 Nov 2026): the phone's "own car/ute or passenger" is required before a leg starts.
    const noMode = await travel({ pass, action: "START_OUT", jobId: regJob.id });
    t.ok(noMode.status === 400 && /I'm driving my own car\/ute, or I'm a passenger/.test(noMode.body.error ?? ""), "travel pay: Start travel with no mode picked is refused", `${noMode.status} ${noMode.body.error ?? ""}`);
    t.status((await travel({ pass, action: "START_OUT", jobId: regJob.id, mode: "DRIVER" })).status, 400, "travel pay: only the two modes are taken");
    // A truck driver's drive is their truck-QR sign-in: travel is refused while that sign-in is open.
    const onTruck = await db.siteAttendance.create({ data: { place: "VEHICLE", vehicleId: `rc-truck-${tag}`, placeLabel: "RC Tipper", date: today, resourceId: person.id, workerName: person.name, signInAt: new Date(), signInMethod: "POINT", status: "CONFIRMED" } });
    const truckOut = await travel({ pass, action: "START_OUT", jobId: regJob.id, mode: "PASSENGER" });
    t.ok(truckOut.status === 409 && truckOut.body.error === "You're signed in on the truck - that already counts your drive. No need to start travel.", "travel pay: Start travel refused while signed in on a truck", `${truckOut.status} ${truckOut.body.error ?? ""}`);
    t.ok((await db.travelLeg.count({ where: { resourceId: person.id, jobId: regJob.id } })) === 0, "travel pay: no leg made by a refused start (no mode / on a truck)");
    await db.siteAttendance.update({ where: { id: onTruck.id }, data: { removedAt: new Date(), removedBy: "release-check", status: "REJECTED" } }); // out of the way for the rest
    const s1 = await travel({ pass, action: "START_OUT", jobId: regJob.id, mode: "PASSENGER", gps: { status: "OK", lat: -33.28, lng: 149.1, accuracy: 20 } });
    t.ok(s1.status === 200 && s1.body.leg?.id, "Start travel on the regional job (as a passenger)", s1.status);
    t.ok((await db.travelLeg.findUnique({ where: { id: s1.body.leg?.id ?? "-" } }))?.mode === "PASSENGER", "travel pay: the leg keeps the mode picked on the phone");
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
    t.status((await travel({ pass, action: "START_HOME" })).status, 400, "travel pay: Travelling home with no mode picked is refused");
    const h1 = await travel({ pass, action: "START_HOME", mode: "DRIVER_OWN_VEHICLE", gps: { status: "TIMEOUT" } });
    t.ok(h1.status === 200 && h1.body.leg?.direction === "HOME", "Travelling home starts (driving own car/ute)", h1.status);
    t.ok((await db.travelLeg.findUnique({ where: { id: h1.body.leg?.id ?? "-" } }))?.mode === "DRIVER_OWN_VEHICLE", "travel pay: the home leg keeps its own mode");
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
        t.ok(!/"gps[a-z]*"\s*:/i.test(JSON.stringify(w)), "no GPS in the Managers' timesheets");
        const o = legs.find((l) => l.legId === s1.body.leg.id), h = legs.find((l) => l.legId === h1.body.leg.id), n = legs.find((l) => l.legId === never.id);
        t.ok(o?.mode === "PASSENGER" && o.paidHours === Math.max(0, Math.round(((o.hours ?? 0) - 1) * 4) / 4) && h?.mode === "DRIVER_OWN_VEHICLE" && h.paidHours === h.hours, "travel pay: each leg carries its mode and paid hours (passenger 1h less, own vehicle in full)", JSON.stringify([o?.mode, o?.paidHours, h?.mode, h?.paidHours]));
        t.ok(n?.paidHours == null && typeof w.travelPaidHours === "number" && typeof p.travelPaidTotal === "number", "travel pay: a never-ended leg is still paid nothing; week and person paid totals");
      }
    }
    for (const [who, path] of [["MANAGER", `/api/timesheets/export?week=${week}`], ["ACCOUNTS", `/api/accounts/timesheets/export?week=${week}`]]) {
      const csv = (await c.text(path, who)).text;
      t.ok(csv.includes("Hours,Of which tip run (h),Travel (h),Travel paid (h),Status") && csv.includes("Travel out to") && csv.includes("Travel home from") && noMoney(csv), `${who} timesheet export has the Travel and Travel paid columns and legs, no $`);
    }
    // Payroll files (accounts): Travel hours and Travel paid hours columns, still hours only. On a week of its own
    // (2020-02-03), because earlier checks seed "$5 Labour" sign-ins this week and the payroll files refuse a week with
    // a $ in a name. Travel pay (23-24 Nov 2026): a passenger's 2h leg is paid 1h, an own-vehicle 2h leg is paid 2h.
    const payWeek = "2020-02-03";
    await db.siteAttendance.create({ data: { place: "OFFICE", placeLabel: "Office", date: "2020-02-04", resourceId: person.id, workerName: person.name, signInAt: new Date("2020-02-03T21:00:00Z"), signOutAt: new Date("2020-02-04T05:30:00Z"), signInMethod: "OFFICE", status: "CONFIRMED" } });
    const ownLeg = await db.travelLeg.create({ data: { direction: "HOME", resourceId: person.id, workerName: person.name, jobId: `rc-pay-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-02-04", startAt: new Date("2020-02-04T05:40:00Z"), endAt: new Date("2020-02-04T07:40:00Z"), endMethod: "ARRIVED", mode: "DRIVER_OWN_VEHICLE" } });
    const passLeg = await db.travelLeg.create({ data: { direction: "OUT", resourceId: person.id, workerName: person.name, jobId: `rc-pay-out-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-02-04", startAt: new Date("2020-02-03T19:00:00Z"), endAt: new Date("2020-02-03T21:00:00Z"), endMethod: "SIGN_IN", mode: "PASSENGER" } });
    const pw = (await c.json(`/api/timesheets?week=${payWeek}`, "MANAGER")).body;
    const pwP = pw?.people?.find((x) => x.resourceId === person.id);
    const pwLegs = Object.values(pwP?.travel ?? {}).flat();
    t.ok(pwLegs.find((l) => l.legId === passLeg.id)?.paidHours === 1 && pwLegs.find((l) => l.legId === passLeg.id)?.hours === 2, "travel pay: a passenger's 2h leg shows paid 1h", JSON.stringify(pwLegs.map((l) => [l.mode, l.hours, l.paidHours])));
    t.ok(pwLegs.find((l) => l.legId === ownLeg.id)?.paidHours === 2, "travel pay: an own-vehicle 2h leg shows paid 2h");
    t.ok(pwP?.travelTotal === 4 && pwP?.travelPaidTotal === 3 && pwP?.travelModeMissing === 0 && typeof pw?.travelPaidHours === "number", "travel pay: the person's week shows 4h travel, 3h paid", `${pwP?.travelTotal} / ${pwP?.travelPaidTotal}`);
    for (const [who, path] of [["MANAGER", `/api/timesheets/export?week=${payWeek}`], ["ACCOUNTS", `/api/accounts/timesheets/export?week=${payWeek}`]]) {
      const r = await c.text(path, who);
      // The accounts route refuses (rather than sends) a file that fails fileIsSafe - a 200 is a file that passed it.
      t.ok(r.status === 200 && /Travel out to [^,\r\n]+,[^,]*,[^,]*,,,,2,1,Travel,Passenger/.test(r.text) && /Travel home from [^,\r\n]+,[^,]*,[^,]*,,,,2,2,Travel,Own vehicle/.test(r.text) && noMoney(r.text) && !/\bBSB\b|\bTFN\b|\bABA\b/i.test(r.text), `travel pay: ${who} timesheet export shows Travel 2 / paid 1 (passenger) and 2 / 2 (own vehicle), no $`, `${r.status}`);
    }
    for (const f of ["payrun", "summary"]) {
      const r = await c.text(`/api/accounts/payroll/export?week=${payWeek}&file=${f}`, "ACCOUNTS");
      const csv = r.text;
      t.ok(r.status === 200 && (f === "payrun" ? /Travel hours,Of which tip run hours,Travel paid hours\r?\n/ : /Travel hours,Travel paid hours/).test(csv) && noMoney(csv) && !/\bBSB\b|\bTFN\b|\bABA\b/i.test(csv), `payroll ${f} file: Travel hours and Travel paid hours columns, no money (fileIsSafe passed - the route refuses otherwise)`, `${r.status} ${csv.slice(0, 160)}`);
      if (f === "summary") t.ok(csv.split("\n").some((l) => l.startsWith(person.name) && /,4,3,0\r?$/.test(l)), "summary: the person's 4h travel, 3h paid (then 0 Tip run hours)", csv.slice(0, 400));
    }
    const pay2 = (await c.json(`/api/accounts/payroll?week=${payWeek}`, "ACCOUNTS")).body;
    const payP = pay2?.people?.find((x) => x.personKey === person.id);
    t.ok(payP?.travelHours === 4 && payP?.travelPaidHours === 3 && payP?.travel?.some((l) => l.mode === "PASSENGER" && l.paidHours === 1), "travel pay: accounts' Payroll shows travel 4h · paid 3h, leg by leg", JSON.stringify([payP?.travelHours, payP?.travelPaidHours]));
    // (7b) Ilies (2 Nov 2026): a leg never ended blocks the week's approval until the office fixes it with a reason.
    const blockLeg = await db.travelLeg.create({ data: { direction: "OUT", resourceId: person.id, workerName: person.name, jobId: `rc-block-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-02-05", startAt: new Date("2020-02-04T19:00:00Z") } });
    const refused = await c.post("/api/timesheets", "MANAGER", { week: payWeek, action: "approve" });
    const refusedBody = await refused.json().catch(() => ({}));
    t.ok(refused.status === 400 && /travel never ended/.test(refusedBody.error ?? ""), "approve refused while a travel leg was never ended", `${refused.status} ${refusedBody.error ?? ""}`);
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "MANAGER", { endAt: "2020-02-04T21:30:00.000Z", reason: "Release check - arrival time from the supervisor" }), 200, "the office ends it with a reason");
    // Travel pay: the office sets a leg's mode through the same correction - Manager+, a reason, kept in TravelEdit.
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "ACCOUNTS", { mode: "PASSENGER", reason: "rc" }), 403, "travel pay: ACCOUNTS can't set a leg's mode");
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "VIEWER", { mode: "PASSENGER", reason: "rc" }), 403, "travel pay: a Viewer can't set a leg's mode");
    if (c.users.COORDINATOR) t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "COORDINATOR", { mode: "PASSENGER", reason: "rc" }), 403, "travel pay: the COORDINATOR can't set a leg's mode");
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "MANAGER", { mode: "PASSENGER" }), 400, "travel pay: a mode change needs a reason");
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "MANAGER", { mode: "BUS", reason: "Release check" }), 400, "travel pay: only the two modes");
    t.status(await c.patch(`/api/attendance/travel/${blockLeg.id}`, "MANAGER", { mode: "PASSENGER", reason: "Release check - rode with the supervisor" }), 200, "travel pay: a Manager sets the mode with a reason");
    const modeEdit = await db.travelEdit.findFirst({ where: { travelLegId: blockLeg.id, field: "mode" } });
    t.ok(modeEdit?.before === null && modeEdit?.after === "PASSENGER" && modeEdit.reason.startsWith("Release check"), "travel pay: the mode change, from 'not recorded', and its reason are kept (TravelEdit)", JSON.stringify(modeEdit));
    t.status(await c.post("/api/timesheets", "MANAGER", { week: payWeek, action: "approve" }), 200, "approve allowed once the leg is fixed");
    // The approved week's snapshot keeps each leg's mode and paid hours (block leg: 2.5h as a passenger = paid 1.5h).
    const approvedRow = await db.timesheetWeek.findFirst({ where: { weekStart: payWeek, reopenedAt: null }, orderBy: { approvedAt: "desc" } });
    const snapTravel = JSON.parse(approvedRow?.snapshot ?? "{}").travel ?? [];
    t.ok(snapTravel.find((l) => l.legId === passLeg.id)?.paidHours === 1 && snapTravel.find((l) => l.legId === ownLeg.id)?.mode === "DRIVER_OWN_VEHICLE" && snapTravel.find((l) => l.legId === blockLeg.id)?.paidHours === 1.5, "travel pay: the approved-week snapshot has the mode and paid hours", JSON.stringify(snapTravel.map((l) => [l.mode, l.hours, l.paidHours])));
    t.status(await c.patch(`/api/attendance/travel/${ownLeg.id}`, "MANAGER", { mode: "PASSENGER", reason: "Release check - locked" }), 400, "travel pay: a locked (approved) week refuses a mode change");
    t.ok((await db.travelEdit.count({ where: { travelLegId: ownLeg.id } })) === 0 && (await db.travelLeg.findUnique({ where: { id: ownLeg.id } }))?.mode === "DRIVER_OWN_VEHICLE", "travel pay: nothing changed or logged on the locked leg");
    const lockedCsv = await c.text(`/api/accounts/timesheets/export?week=${payWeek}`, "ACCOUNTS");
    t.ok(lockedCsv.status === 200 && /APPROVED by/.test(lockedCsv.text) && /,2\.5,1\.5,Travel,Passenger/.test(lockedCsv.text) && noMoney(lockedCsv.text), "travel pay: the locked week's export shows the approved paid hours");
    const thisWeekPay = await c.get(`/api/accounts/payroll/export?week=${week}&file=summary`, "ACCOUNTS");
    if (thisWeekPay.status !== 200) t.note(`this week's payroll summary answers ${thisWeekPay.status} on the copy - earlier checks seed $ names this week (pre-existing fileIsSafe refusal, not travel)`);
    // GPS: accounts / Admins only (the payroll week), never the Sign-ins page.
    const pay = await c.text(`/api/accounts/payroll?week=${week}`, "ACCOUNTS");
    t.ok(pay.status === 200 && /"travel":\[/.test(pay.text) && /-33\.28/.test(pay.text), "accounts see the travel legs with the start GPS point");
    const att = await c.json(`/api/attendance?date=${today}`, "MANAGER");
    t.ok(att.body?.travel?.some((l) => l.legId === s1.body.leg.id) && !/"gps[a-z]*"\s*:/i.test(JSON.stringify(att.body?.travel ?? [])), "Sign-ins page lists the legs, without GPS");

    // (8) Office corrections: Manager+, a reason, kept; a locked week refuses.
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "ACCOUNTS", { endAt: new Date().toISOString(), reason: "rc" }), 403, "ACCOUNTS can't correct travel");
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "VIEWER", { endAt: new Date().toISOString(), reason: "rc" }), 403, "a Viewer can't correct travel");
    if (c.users.COORDINATOR) {
      t.status(await c.patch(`/api/attendance/travel/${never.id}`, "COORDINATOR", { endAt: new Date().toISOString(), reason: "rc" }), 403, "the COORDINATOR can't correct travel (view only)");
      t.status(await c.patch(`/api/projects/${reg.id}`, "COORDINATOR", { regional: false }), 403, "the COORDINATOR can't change the Regional flag");
      const cw = (await c.json(`/api/timesheets?week=${week}`, "COORDINATOR")).body;
      t.ok(Object.values(cw?.people?.find((x) => x.resourceId === person.id)?.travel ?? {}).flat().length === 4, "the COORDINATOR sees the Travel column (view only)");
      const ca = (await c.json(`/api/attendance?date=${today}`, "COORDINATOR")).body;
      t.ok(ca?.travel?.some((l) => l.legId === s1.body.leg.id) && !/"gps[a-z]*"\s*:/i.test(JSON.stringify(ca?.travel ?? [])), "the COORDINATOR sees the travel legs on Sign-ins, without GPS");
    } else t.note("no COORDINATOR test login on this build - its travel checks skipped");
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "MANAGER", { endAt: new Date().toISOString() }), 400, "a correction needs a reason");
    t.status(await c.patch(`/api/attendance/travel/${never.id}`, "MANAGER", { endAt: new Date(Date.now() - 6 * HOUR).toISOString(), reason: "Release check - forgot to sign in on site" }), 200, "a Manager corrects a travel time with a reason");
    const fixed = await db.travelLeg.findUnique({ where: { id: never.id }, include: { edits: true } });
    t.ok(fixed?.endMethod === "OFFICE" && fixed.edits.length === 1 && fixed.edits[0].reason.startsWith("Release check"), "the change and its reason are kept (TravelEdit)");
    const lockedWeek = "2020-01-06";
    await db.timesheetWeek.create({ data: { weekStart: lockedWeek, approvedBy: "Release check", snapshot: JSON.stringify({ weekStart: lockedWeek, lines: [] }), totalHours: 0, people: 0 } });
    const old = await db.travelLeg.create({ data: { direction: "OUT", resourceId: person.id, workerName: person.name, jobId: `rc-old-${tag}`, projectId: loc.id, siteLabel: loc.name, date: "2020-01-07", startAt: new Date("2020-01-06T20:00:00Z") } });
    t.status(await c.patch(`/api/attendance/travel/${old.id}`, "MANAGER", { endAt: "2020-01-06T23:00:00.000Z", reason: "Release check" }), 400, "a locked (approved) week refuses a travel change");

    // (8b) Only link-holders record travel (Ilies, 24 Nov 2026). person3 has no SUPERVISOR / DRIVER link: put on the
    // regional job and signed in on the supervisor's QR (so the phone gets its pass - AT-001 unchanged), the phone is
    // offered no travel and the server refuses a start.
    if (await db.siteLink.count({ where: { resourceId: person3.id, kind: { in: ["SUPERVISOR", "DRIVER"] }, revokedAt: null } })) {
      t.note("person3 has a SUPERVISOR / DRIVER link on this snapshot - the no-link phone case is checked in (11) instead");
    } else {
      await db.assignment.create({ data: { jobId: regJob.id, resourceId: person3.id } });
      const dev3 = `${dev}-3`;
      const in3 = await sign(await qr(regJob.id), regJob.id, "IN", person3.id, dev3);
      t.ok(in3.status === 200 && typeof in3.body.travelPass === "string" && in3.body.travelLink === false, "no link: the pass is still given (AT-001 unchanged) but no travel page link", `${in3.status} ${in3.body.error ?? ""} ${in3.body.travelLink}`);
      const out3 = await sign(await qr(regJob.id), regJob.id, "OUT", person3.id, dev3);
      t.ok(out3.status === 200 && !out3.body.travelHome, "no link: a regional sign-out offers no Travelling home", `${out3.status}`);
      const st3 = await travel({ pass: in3.body.travelPass, deviceId: dev3, action: "STATUS" });
      t.ok(st3.status === 200 && st3.body.byDriver === true && !(st3.body.outJobs ?? []).length && !st3.body.home, "no link: the travel page offers nothing (recorded by the driver)", JSON.stringify(st3.body).slice(0, 160));
      for (const [action, extra] of [["START_OUT", { jobId: regJob.id, mode: "PASSENGER" }], ["START_HOME", { mode: "DRIVER_OWN_VEHICLE" }]]) {
        const r = await travel({ pass: in3.body.travelPass, deviceId: dev3, action, ...extra });
        t.ok(r.status === 403 && r.body.error === "Travel is recorded by your driver - nothing to do.", `no link: ${action} refused on the server`, `${r.status} ${r.body.error ?? ""}`);
      }
      t.ok((await db.travelLeg.count({ where: { resourceId: person3.id } })) === 0, "no link: no travel leg stored");
    }

    // (11) Crew travel worked out from the driver (Ilies, 24 Nov 2026) - a week of its own (4-10 Mar 2019; Sydney is
    // UTC+11 then, so 19:00Z on the 4th = 6am on Tue 5 Mar). Seeded sign-ins (the truck QR and site sign-ins as they're
    // stored), read back through the office, Timesheets, the approval and Payroll.
    const WK = "2019-03-04", DAY = "2019-03-05";
    const Z = (s) => new Date(`2019-03-${s}:00.000Z`); // "04T19:00" -> 2019-03-04T19:00Z
    const free = await db.resource.findMany({
      where: {
        type: "PERSONNEL", active: true, id: { notIn: [person.id, person2.id, person3.id] }, OR: [{ engagement: null }, { engagement: { not: "ABN" } }],
        siteLinks: { none: { kind: { in: ["SUPERVISOR", "DRIVER"] }, revokedAt: null } }, attendances: { none: { date: { gte: WK, lte: "2019-03-10" } } },
      },
      select: { id: true, name: true }, orderBy: { name: "asc" }, take: 8,
    });
    if (free.length < 8) { t.note(`only ${free.length} Labour-register people without a link on the snapshot - the worked-out travel cases need 8`); }
    else {
      const [D, A, B, O, P, C, F, G] = free;
      await makeLink(db, "DRIVER", D.id); // the truck driver
      await makeLink(db, "SUPERVISOR", O.id); // drives their own ute
      await makeLink(db, "DRIVER", P.id); // a link-holder riding along as a passenger
      const reg2 = await db.project.create({ data: { name: `RC regional crew ${tag}`, status: "ACTIVE", regional: true } });
      const j2 = await db.job.create({ data: { projectId: reg2.id, title: reg2.name, date: new Date(`${DAY}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
      const seedAtt = (who, o) => db.siteAttendance.create({ data: { date: DAY, resourceId: who.id, workerName: who.name, signInMethod: "SUPERVISOR_QR", status: "CONFIRMED", signOutMethod: "SUPERVISOR_QR", ...o } });
      const seedTruck = (who, o) => seedAtt(who, { place: "VEHICLE", vehicleId: `rc-truck2-${tag}`, placeLabel: "RC Tipper 2", signInMethod: "POSTER", signOutMethod: "POSTER", ...o });
      // D: truck QR 6:00 -> site 8:00 (the site sign-in moves them off the truck), site -> 5:00pm, truck back 5:00 -> 7:30pm.
      await seedTruck(D, { signInAt: Z("04T19:00"), signOutAt: Z("04T21:00"), signOutMethod: "MOVED" });
      await seedAtt(D, { jobId: j2.id, signInAt: Z("04T21:00"), signOutAt: Z("05T06:00"), signOutMethod: "MOVED" });
      const dBack = await seedTruck(D, { signInAt: Z("05T06:00"), signOutAt: Z("05T08:30") });
      // Two crew with no link, on site within 30 min of D: their travel is D's drive (2h out, 2.5h home) less 1h each way -
      // cut at their own sign-in: B signed in at 7:45, before D arrived at 8:00, so B's travel out is 6:00-7:45 (1.75h).
      await seedAtt(A, { jobId: j2.id, signInAt: Z("04T21:10"), signOutAt: Z("05T05:50") });
      await seedAtt(B, { jobId: j2.id, signInAt: Z("04T20:45"), signOutAt: Z("05T06:00") });
      // G (no link) scanned the truck QR themselves for the ride out: that sign-in is their record - no worked-out out leg.
      const gTruck = await seedTruck(G, { signInAt: Z("04T19:00"), signOutAt: Z("04T21:00"), signOutMethod: "MOVED" });
      await seedAtt(G, { jobId: j2.id, signInAt: Z("04T21:00"), signOutAt: Z("05T06:00") });
      // O: own ute, 6:40 -> 8:25 (1.75h, paid in full), home 5:30 -> 7:30pm (2h, paid in full).
      const oSite = await seedAtt(O, { jobId: j2.id, signInAt: Z("04T21:25"), signOutAt: Z("05T06:20") });
      const seedLeg = (who, o) => db.travelLeg.create({ data: { resourceId: who.id, workerName: who.name, jobId: j2.id, projectId: reg2.id, siteLabel: reg2.name, date: DAY, ...o } });
      await seedLeg(O, { direction: "OUT", startAt: Z("04T19:40"), endAt: Z("04T21:25"), endMethod: "SIGN_IN", endAttendanceId: oSite.id, mode: "DRIVER_OWN_VEHICLE" });
      await seedLeg(O, { direction: "HOME", startAt: Z("05T06:30"), endAt: Z("05T08:30"), endMethod: "ARRIVED", startAttendanceId: oSite.id, mode: "DRIVER_OWN_VEHICLE" });
      // P: rode in someone's car as a passenger, 6:00 -> 8:05 (2h to the quarter, paid 1h).
      const pSite = await seedAtt(P, { jobId: j2.id, signInAt: Z("04T21:05"), signOutAt: Z("05T06:00") });
      await seedLeg(P, { direction: "OUT", startAt: Z("04T19:00"), endAt: Z("04T21:05"), endMethod: "SIGN_IN", endAttendanceId: pSite.id, mode: "PASSENGER" });
      // C: signed in at the Yard 5:30am, still on it when the truck left (the site sign-in at 8:10 moved them off it).
      const cYard = await seedAtt(C, { place: "YARD", placeLabel: "Yard", signInMethod: "POSTER", signInAt: Z("04T18:30"), signOutAt: Z("04T21:10"), signOutMethod: "MOVED" });
      await seedAtt(C, { jobId: j2.id, signInAt: Z("04T21:10"), signOutAt: Z("05T06:00") });
      // F: on site at noon - nobody with a link signed in near then: no driver found.
      await seedAtt(F, { jobId: j2.id, signInAt: Z("05T01:00"), signOutAt: Z("05T05:00") });

      const crewWeek = async () => (await c.json(`/api/timesheets?week=${WK}`, "MANAGER")).body;
      const legsOf = (w, who) => Object.values(w?.people?.find((x) => x.resourceId === who.id)?.travel ?? {}).flat();
      const w1 = await crewWeek();
      for (const [who, label, outH, outPaid] of [[A, "A", 2, 1], [B, "B (on site before the driver - cut at their own sign-in)", 1.75, 0.75]]) {
        const l = legsOf(w1, who);
        const o = l.find((x) => x.direction === "OUT"), h = l.find((x) => x.direction === "HOME");
        t.ok(o?.legId?.startsWith("derived:") && o.hours === outH && o.paidHours === outPaid && h?.hours === 2.5 && h.paidHours === 1.5 && o.via === `with ${D.name}'s truck (RC Tipper 2)`,
          `crew without a link ${label}: travel worked out from the driver's truck - out ${outH}h paid ${outPaid}h, home 2.5h paid 1.5h, "${o?.via ?? "-"}"`, JSON.stringify(l.map((x) => [x.direction, x.hours, x.paidHours, x.flag, x.via])));
      }
      const gL = legsOf(w1, G);
      t.ok(gL.length === 1 && gL[0].direction === "HOME" && gL[0].paidHours === 1.5 && !gL.some((x) => x.flag === "SIGNIN_OVERLAP"), "crew with their own truck QR sign-in: it stands - no worked-out out leg, no overlap flag; home still from the driver", JSON.stringify(gL.map((x) => [x.direction, x.hours, x.paidHours, x.flag])));
      t.ok(!!gTruck.id, "G's truck sign-in kept as it was");
      t.ok(legsOf(w1, D).length === 0, "the truck driver: no travel leg - their truck QR sign-ins are their worked hours");
      const oL = legsOf(w1, O), pL = legsOf(w1, P);
      t.ok(oL.find((x) => x.direction === "OUT")?.paidHours === 1.75 && oL.find((x) => x.direction === "HOME")?.paidHours === 2, "own car / ute link-holder: paid in full (1.75h out, 2h home)", JSON.stringify(oL.map((x) => [x.hours, x.paidHours])));
      t.ok(pL.length === 1 && pL[0].hours === 2 && pL[0].paidHours === 1 && pL[0].mode === "PASSENGER", "passenger link-holder: paid 1h less (2h -> 1h)", JSON.stringify(pL.map((x) => [x.hours, x.paidHours])));
      const cOut = legsOf(w1, C).find((x) => x.direction === "OUT");
      const fix = cOut?.pointFix ?? { attendanceId: "-", signOutAt: "", reason: "" };
      t.ok(cOut?.flag === "SIGNIN_OVERLAP" && cOut.hours === null && cOut.paidHours === null, "TP-001: crew whose Yard sign-in ran into the drive - flagged, pays nothing", JSON.stringify(cOut));
      t.ok(cOut?.pointFix?.attendanceId === cYard.id && cOut.pointFix.signOutAt === Z("04T19:00").toISOString() && cOut.pointFix.label === "End yard sign-in when the truck left"
        && cOut.pointFix.reason === `Rode to ${reg2.name} with ${D.name} - travel counted instead (option A, Ilies 24 Nov 2026)`, "option A: the one-tap fix ends the Yard sign-in at the truck's departure", JSON.stringify(cOut?.pointFix));
      const fL = legsOf(w1, F);
      t.ok(fL.length === 2 && fL.every((x) => x.flag === "NO_DRIVER" && x.hours === null && x.paidHours === null), "no driver found: both ways amber, nothing paid", JSON.stringify(fL.map((x) => x.flag)));
      t.ok((await db.siteAttendance.findUnique({ where: { id: cYard.id } }))?.signOutAt?.toISOString() === Z("04T21:10").toISOString(), "never automatic: the Yard sign-in is untouched until the office presses the button");
      const dayAtt = await c.json(`/api/attendance?date=${DAY}`, "MANAGER");
      t.ok((dayAtt.body?.travel ?? []).some((l) => l.resourceId === A.id && l.via) && !/"gps[a-z]*"\s*:/i.test(JSON.stringify(dayAtt.body?.travel ?? [])), "Sign-ins lists the worked-out legs with the driver's name, no GPS");

      // The overlap blocks approval; "no driver found" doesn't.
      const r1 = await c.post("/api/timesheets", "MANAGER", { week: WK, action: "approve" });
      const r1b = await r1.json().catch(() => ({}));
      t.ok(r1.status === 400 && /travel overlaps a sign-in/.test(r1b.error ?? "") && !/no driver/.test(r1b.error ?? ""), "TP-001: approval refused while the overlap is there (not for no driver found)", `${r1.status} ${r1b.error ?? ""}`);
      // The office presses "End yard sign-in when the truck left" - the ordinary office sign-in change.
      t.status(await c.patch(`/api/attendance/${fix.attendanceId}`, "ACCOUNTS", { signOutAt: fix.signOutAt, reason: fix.reason }), 403, "option A: ACCOUNTS can't press it");
      t.status(await c.patch(`/api/attendance/${fix.attendanceId}`, "MANAGER", { signOutAt: fix.signOutAt, reason: fix.reason }), 200, "option A: a Manager presses it");
      const yardEdit = await db.attendanceEdit.findFirst({ where: { attendanceId: cYard.id, field: "signOutAt" }, orderBy: { editedAt: "desc" } });
      t.ok((await db.siteAttendance.findUnique({ where: { id: cYard.id } }))?.signOutAt?.toISOString() === Z("04T19:00").toISOString() && yardEdit?.reason === fix.reason && yardEdit.after === Z("04T19:00").toISOString(),
        "option A: the Yard sign-in now ends when the truck left, logged in AttendanceEdit with the automatic reason", JSON.stringify(yardEdit));
      const cOut2 = legsOf(await crewWeek(), C).find((x) => x.direction === "OUT");
      t.ok(cOut2?.flag === null && cOut2.hours === 2 && cOut2.paidHours === 1 && !cOut2.pointFix, "option A: the flag clears; paid = driver's drive - 1h", JSON.stringify(cOut2));
      // "No driver found": the office adds the leg (Manager+, reason, never over a sign-in, one each way).
      const addBody = { resourceId: F.id, jobId: j2.id, direction: "OUT", startAt: Z("04T23:00").toISOString(), endAt: Z("05T01:00").toISOString(), mode: "PASSENGER", reason: "Release check - came up with the morning delivery" };
      for (const who of ["ACCOUNTS", "VIEWER", "TIMESHEETS", ...(c.users.COORDINATOR ? ["COORDINATOR"] : [])]) t.status(await c.post("/api/attendance/travel", who, addBody), 403, `adding a leg: ${who} refused`);
      t.status(await c.post("/api/attendance/travel", "MANAGER", { ...addBody, reason: "" }), 400, "adding a leg needs a reason");
      t.status(await c.post("/api/attendance/travel", "MANAGER", { ...addBody, endAt: Z("05T01:30").toISOString() }), 400, "adding a leg over their own sign-in is refused");
      t.status(await c.post("/api/attendance/travel", "MANAGER", addBody), 200, "a Manager adds F's travel out");
      t.status(await c.post("/api/attendance/travel", "MANAGER", addBody), 409, "a second one is refused (one leg each way per job)");
      const fAdded = await db.travelLeg.findFirst({ where: { resourceId: F.id, jobId: j2.id, direction: "OUT" }, include: { edits: true } });
      t.ok(fAdded?.endMethod === "OFFICE" && fAdded.mode === "PASSENGER" && fAdded.edits.some((e) => e.field === "added" && e.reason.startsWith("Release check")), "the added leg and its reason are kept (TravelEdit 'added')");
      const fL2 = legsOf(await crewWeek(), F);
      t.ok(fL2.find((x) => x.direction === "OUT")?.legId === fAdded?.id && fL2.find((x) => x.direction === "OUT")?.paidHours === 1 && fL2.find((x) => x.direction === "HOME")?.flag === "NO_DRIVER", "the office's leg takes the place of the worked-out one (paid 1h); home stays amber", JSON.stringify(fL2.map((x) => [x.legId, x.flag, x.paidHours])));
      t.status(await c.post("/api/timesheets", "MANAGER", { week: WK, action: "approve" }), 200, "approved once the overlap is fixed - 'no driver found' never blocks");
      const snap = JSON.parse((await db.timesheetWeek.findFirst({ where: { weekStart: WK, reopenedAt: null }, orderBy: { approvedAt: "desc" } }))?.snapshot ?? "{}").travel ?? [];
      t.ok(snap.some((l) => l.resourceId === A.id && l.legId.startsWith("derived:") && l.paidHours === 1), "the approved snapshot freezes the worked-out legs");
      t.status(await c.post("/api/attendance/travel", "MANAGER", { ...addBody, direction: "HOME", startAt: Z("05T05:10").toISOString(), endAt: Z("05T07:00").toISOString() }), 400, "a locked week refuses an added leg");
      // Exports: fileIsSafe (the accounts route refuses a file that fails it), the driver named, the paid column last.
      const tcsv = await c.text(`/api/accounts/timesheets/export?week=${WK}`, "ACCOUNTS");
      t.ok(tcsv.status === 200 && tcsv.text.includes(`With ${D.name}'s truck (RC Tipper 2)`) && noMoney(tcsv.text), "accounts' timesheet export: the worked-out legs name the driver, no $", `${tcsv.status}`);
      // TP-003: Victoria approves A, then the driver's time changes - A drops out of the pay-run until she approves again.
      t.status(await c.post("/api/accounts/payroll", "ACCOUNTS", { week: WK, personKey: A.id, status: "APPROVED" }), 200, "accounts approve A's week");
      const review = await db.payWeekReview.findFirst({ where: { weekStart: WK, personKey: A.id }, orderBy: { at: "desc" } });
      t.ok(JSON.parse(review?.snapshot ?? "{}").travel?.paidHours === 2.5, "TP-003: her approval keeps A's travel paid hours (2.5h)", review?.snapshot?.slice(0, 200));
      const run1 = await c.text(`/api/accounts/payroll/export?week=${WK}&file=payrun`, "ACCOUNTS");
      const rows1 = run1.text.trim().split(/\r?\n/).map((l) => l.split(","));
      const aRow = rows1.find((r) => r[0] === A.name || r[0] === `"${A.name}"`);
      t.ok(run1.status === 200 && rows1[0].join(",") === "Employee,Email,Earnings Rate,Date,Hours,Site,Travel hours,Of which tip run hours,Travel paid hours" && aRow?.[8] === "2.5" && aRow?.[6] === "4.5",
        "TP-005: pay-run file - 'Travel paid hours' last; A's day: travel 4.5h, paid 2.5h", `${run1.status} ${rows1[0].join(",")} | ${aRow?.join(",")}`);
      t.ok(rows1.slice(1).every((r) => [4, 6, 7, 8].every((i) => r[i] === "" || r[i] === undefined || /^\d+(\.\d+)?$/.test(r[i]))) && noMoney(run1.text), "TP-005: the number columns are numbers or blank, no $");
      t.status(await c.post("/api/timesheets", "ADMIN", { week: WK, action: "reopen", reason: "Release check - TP-003" }), 200, "an Admin reopens the week");
      t.status(await c.patch(`/api/attendance/${dBack.id}`, "MANAGER", { signOutAt: Z("05T09:00").toISOString(), reason: "Release check - truck back later" }), 200, "the office changes the driver's truck-back sign-out");
      t.status(await c.post("/api/timesheets", "MANAGER", { week: WK, action: "approve" }), 200, "the Manager locks the week again");
      const payW = (await c.json(`/api/accounts/payroll?week=${WK}`, "ACCOUNTS")).body;
      const pA = payW?.people?.find((x) => x.personKey === A.id);
      t.ok(pA && pA.travelPaidHours === 3 && pA.inPayRun === false && /Travel changed since you approved - approve again/.test(pA.payRunNote ?? ""), "TP-003: A's travel changed (paid 2.5h -> 3h) - out of the pay-run, 'approve again'", JSON.stringify([pA?.travelPaidHours, pA?.inPayRun, pA?.payRunNote]));
      const run2 = await c.text(`/api/accounts/payroll/export?week=${WK}&file=payrun`, "ACCOUNTS");
      t.ok(run2.status === 200 && !run2.text.includes(A.name), "TP-003: A is not in the pay-run file until approved again");
      t.ok(noMoney(JSON.stringify(payW)) && noMoney(JSON.stringify(w1)), "no $ on Payroll or Timesheets");
    }

    // (9) Turning regional off keeps every leg; travel is no longer offered for it.
    const before = await db.travelLeg.count({ where: { projectId: reg.id } });
    t.status(await c.patch(`/api/projects/${reg.id}`, "MANAGER", { regional: false }), 200, "a Manager marks it local again");
    t.ok((await db.travelLeg.count({ where: { projectId: reg.id } })) === before && before === 5, "its travel legs are all kept (out, home, the two payroll-week ones, the approval-block one)", `${before}`);
    const st2 = await travel({ pass, action: "STATUS" });
    t.ok(st2.status === 200 && !st2.body.outJobs?.some((j) => j.jobId === regJob.id && !j.leg), "not offered once it's local");

    // (10) Nothing with a dollar figure on any link answer.
    t.ok(linkSafe.every(noMoney), `no $ in ${linkSafe.length} link answers`);
    t.ok(!linkSafe.some((s) => /gps(Lat|Lng)|startGps|endGps/.test(s)), "no GPS sent back to the phone");
    const tp = await c.text("/site/in/travel", null);
    t.ok(tp.status === 200 && !/Application error/.test(tp.text), "the travel page opens with no login", tp.status);
  },
};
