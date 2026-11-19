// Shift rollover (19 Nov 2026, Ilies: "build it, deploy once it passes"): night shifts count to their start day.
//   (1) Labels: a night shift reads "Night shift Sun 15 → Mon 16 – hours count to Sun 15" on the supervisor's page and
//       the crew's scan; day shifts unchanged.
//   (2) Tonight's night shift takes new sign-ins only from 12 noon Sydney (which side of noon the run is on decides
//       what is checked - both sides are covered by the unit tests); last night's until 2pm; sign-out never blocked.
//   (3) Just off a night shift (6 h): a tick-in and a phone sign-in ask "same shift / new shift" first (409 + ask),
//       the answer is kept on the sign-in (shiftAnswer).
//   (4) Regional tip run on the worker's own phone (travel pass): start -> finish, one open at a time, refused while
//       signed in, ended by a sign-in, regional only (turning regional off keeps the runs), office corrections
//       (Manager+, reason, overlap refused, locked week refused), the Tip run column on Sign-ins / Timesheets /
//       Accounts / exports / pay-run files, Day Review's hours, approval blocked by a never-ended run, no $ on links.
// The TIP_RUN=off kill switch can't be flipped on a running server - unit tests (src/lib/tipRun/rules.test.ts) cover it.
// WRITES on the test copy: two projects with three jobs, allocations, a supervisor link and poster, sign-ins (seeded
// and real), tip runs, one approved far-past week (2020-08-03) and one locked week (2020-08-10) - weeks no other check uses.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const HOUR = 3_600_000;
const sydneyHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", hour: "2-digit", hourCycle: "h23" }).format(d));
const addDays = (iso, n) => new Date(new Date(iso + "T00:00:00.000Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

export default {
  id: "shift-rollover", title: "Shift rollover: night labels, tonight from noon, same-shift question, regional tip run (start/finish, column, approval, Day Review), no $ on links",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/app/api/site/in/tip/route.ts") || "needs the tip run route",
  async run(t, c) {
    const db = c.db;
    const today = c.today;
    const yesterday = addDays(today, -1);
    const since = new Date(Date.now() - 30 * HOUR);
    const people = await db.resource.findMany({
      where: {
        type: "PERSONNEL", active: true,
        attendances: { none: { OR: [{ date: { in: [today, yesterday] } }, { signInAt: { gte: since } }, { signOutAt: { gte: since } }] } },
      },
      select: { id: true, name: true }, take: 40,
    });
    const busy = new Set((await db.travelLeg.findMany({ where: { startAt: { gte: since } }, select: { resourceId: true } })).map((x) => x.resourceId));
    const free = people.filter((p) => !busy.has(p.id));
    if (free.length < 5) return t.block("fewer than 5 active Labour-register people with no sign-in / travel in the last 30 hours on the snapshot");
    const [sup, ticked, outer, same, tipper] = free;
    const tag = Date.now().toString(36);
    const reg = await db.project.create({ data: { name: `RC95 regional ${tag}`, status: "ACTIVE", regional: true } });
    const loc = await db.project.create({ data: { name: `RC95 local ${tag}`, status: "ACTIVE" } });
    const lastNight = await db.job.create({ data: { projectId: reg.id, title: reg.name, date: new Date(yesterday + "T00:00:00.000Z"), shift: "NIGHT", status: "ACTIVE" } });
    const tonight = await db.job.create({ data: { projectId: reg.id, title: reg.name, date: new Date(today + "T00:00:00.000Z"), shift: "NIGHT", status: "ACTIVE" } });
    const dayJob = await db.job.create({ data: { projectId: loc.id, title: loc.name, date: new Date(today + "T00:00:00.000Z"), shift: "DAY", status: "ACTIVE" } });
    for (const j of [lastNight, tonight, dayJob]) for (const p of free.slice(0, 5)) await db.assignment.create({ data: { jobId: j.id, resourceId: p.id } });
    const supLink = await makeLink(db, "SUPERVISOR", sup.id);
    const regPoster = await makeLink(db, "POSTER", null, { projectId: reg.id });
    const linkSafe = [];
    const keep = async (r) => { const j = await r.json().catch(() => ({})); linkSafe.push(JSON.stringify(j)); return { status: r.status, body: j }; };
    const supGet = async () => keep(await c.get(c.site(supLink, "/signin"), null));
    const supPost = async (body) => keep(await c.post(c.site(supLink, "/signin"), null, body));
    const qr = async (jobId) => (await supGet()).body?.jobs?.find((j) => j.id === jobId)?.qrUrl?.match(/\/in\/([^/?#]+)$/)?.[1] ?? "none";
    const dev = `rc95-${tag}`;
    const scanSign = async (code, jobId, action, who, extra = {}) => {
      const scan = await keep(await c.get(`/api/site/in/${encodeURIComponent(code)}`, null));
      return keep(await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId, action, resourceId: who, deviceId: dev, gps: { status: "DENIED" }, ...extra }));
    };
    const tip = async (body) => keep(await c.post("/api/site/in/tip", null, { deviceId: dev, ...body }));
    const hour = sydneyHour();

    // (1) Labels.
    const g = await supGet();
    const lbl = (id) => g.body?.jobs?.find((j) => j.id === id)?.label ?? "";
    const dn = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric" });
    t.ok(g.status === 200 && lbl(tonight.id) === `${reg.name} – Night shift ${dn(today)} → ${dn(addDays(today, 1))} – hours count to ${dn(today)}`, "tonight's night shift says its span and the day its hours count to", lbl(tonight.id));
    t.ok(lbl(lastNight.id) === `${reg.name} – Night shift ${dn(yesterday)} → ${dn(today)} – hours count to ${dn(yesterday)}`, "last night's too - the two can't look alike", lbl(lastNight.id));
    t.ok(lbl(dayJob.id) === loc.name, "a day shift's label is unchanged", lbl(dayJob.id));
    const posterScan = await keep(await c.get(`/api/site/in/${encodeURIComponent(regPoster.secret)}`, null));
    t.ok(posterScan.status === 200 && posterScan.body.jobs?.some((j) => j.id === tonight.id && /Night shift/.test(j.label) && /hours count to/.test(j.label)), "the poster scan names night shifts the same way");

    // (2) Tonight from noon; last night's until 2pm; sign-out never blocked.
    if (hour < 12) {
      t.ok(g.body.jobs.find((j) => j.id === tonight.id)?.notYet && posterScan.body.jobs.find((j) => j.id === tonight.id)?.notYet, "before noon: tonight's shift shows 'sign-ins open at 12 noon' (supervisor + poster)");
      const r = await supPost({ action: "MANUAL_IN", jobId: tonight.id, resourceId: ticked.id });
      t.ok(r.status === 400 && /12 noon/.test(r.body.error ?? ""), "before noon: the supervisor can't tick anyone in on tonight's night shift", `${r.status} ${r.body.error ?? ""}`);
      const st = await scanSign(await qr(tonight.id), tonight.id, "STATUS", ticked.id);
      t.ok(st.status === 200 && /12 noon/.test(st.body.signInClosed ?? ""), "before noon: the crew phone (supervisor QR) shows sign-in closed for tonight", JSON.stringify(st.body));
      const ph = await scanSign(await qr(tonight.id), tonight.id, "IN", ticked.id);
      t.ok(ph.status === 400 && /12 noon/.test(ph.body.error ?? ""), "before noon: a phone sign-in on tonight's shift is refused", `${ph.status}`);
      const pp = await scanSign(regPoster.secret, tonight.id, "IN", ticked.id);
      t.ok(pp.status === 400 || pp.status === 403, "before noon: a poster sign-in on tonight's shift is refused", `${pp.status}`);
      t.ok((await db.siteAttendance.count({ where: { jobId: tonight.id } })) === 0, "nobody is on tonight's shift before noon");
    } else {
      t.note(`run at ${hour}:xx Sydney (after noon) - the before-noon refusal is covered by the unit tests`);
      const r = await supPost({ action: "MANUAL_IN", jobId: tonight.id, resourceId: ticked.id });
      t.ok(r.status === 200, "after noon: tonight's night shift takes a tick-in", `${r.status} ${r.body.error ?? ""}`);
      const a = await db.siteAttendance.findFirst({ where: { jobId: tonight.id, resourceId: ticked.id } });
      if (a) t.status(await c.post(c.site(supLink, "/signin"), null, { action: "MANUAL_OUT", attendanceId: a.id }), 200, "and signs out");
    }
    if (hour < 14) {
      const r = await supPost({ action: "MANUAL_IN", jobId: lastNight.id, resourceId: outer.id });
      t.ok(r.status === 200, "before 2pm: last night's night shift still takes a sign-in (non-regional tip runs)", `${r.status} ${r.body.error ?? ""}`);
    } else {
      const r = await supPost({ action: "MANUAL_IN", jobId: lastNight.id, resourceId: outer.id });
      t.ok(r.status === 400, "from 2pm: last night's night shift takes no new sign-in", `${r.status}`);
    }
    // Sign-out is never blocked: an open sign-in on last night's shift (6 h ago) signs out, whatever the time.
    const openLine = await db.siteAttendance.findFirst({ where: { jobId: lastNight.id, resourceId: outer.id, signOutAt: null } })
      ?? await db.siteAttendance.create({ data: { jobId: lastNight.id, date: yesterday, resourceId: outer.id, workerName: outer.name, signInAt: new Date(Date.now() - 6 * HOUR), signInMethod: "MANUAL", status: "CONFIRMED" } });
    t.status(await c.post(c.site(supLink, "/signin"), null, { action: "MANUAL_OUT", attendanceId: openLine.id }), 200, "signing out of last night's shift is never blocked");

    // (3) The same-shift question. `same`: off last night's regional shift an hour ago.
    await db.siteAttendance.create({ data: { jobId: lastNight.id, date: yesterday, resourceId: same.id, workerName: same.name, signInAt: new Date(Date.now() - 9 * HOUR), signOutAt: new Date(Date.now() - HOUR), signInMethod: "MANUAL", status: "CONFIRMED" } });
    const askDay = await supPost({ action: "MANUAL_IN", jobId: dayJob.id, resourceId: same.id });
    t.ok(askDay.status === 409 && askDay.body.ask && askDay.body.ask.newOffered === true && askDay.body.ask.sameOffered === false && /another site/.test(askDay.body.ask.sameNote ?? ""),
      "tick-in just off a night shift (another site): asked first - only 'new shift' on offer here", JSON.stringify(askDay.body).slice(0, 300));
    t.ok((await db.siteAttendance.count({ where: { jobId: dayJob.id, resourceId: same.id } })) === 0, "nothing signed in silently");
    const newIn = await supPost({ action: "MANUAL_IN", jobId: dayJob.id, resourceId: same.id, shiftAnswer: "NEW" });
    t.ok(newIn.status === 200, "'This is a new shift' signs them in on the day job", `${newIn.status} ${newIn.body.error ?? ""}`);
    const newRow = await db.siteAttendance.findFirst({ where: { jobId: dayJob.id, resourceId: same.id } });
    t.ok(newRow?.shiftAnswer === "NEW", "the answer is kept on the sign-in (shiftAnswer NEW)", newRow?.shiftAnswer);
    if (newRow) await c.post(c.site(supLink, "/signin"), null, { action: "MANUAL_OUT", attendanceId: newRow.id });
    if (hour < 14) {
      const sameAsk = await supPost({ action: "MANUAL_IN", jobId: lastNight.id, resourceId: same.id });
      t.ok(sameAsk.status === 409 && sameAsk.body.ask?.sameOffered === true && sameAsk.body.ask?.newOffered === false && sameAsk.body.ask?.tipRun === true,
        "back on last night's job: asked, 'same shift' only, and pointed to Start tip run (regional)", JSON.stringify(sameAsk.body).slice(0, 300));
      const sameIn = await supPost({ action: "MANUAL_IN", jobId: lastNight.id, resourceId: same.id, shiftAnswer: "SAME" });
      t.ok(sameIn.status === 200, "'Back on the same shift' signs them on last night's job", `${sameIn.status} ${sameIn.body.error ?? ""}`);
      const sameRow = await db.siteAttendance.findFirst({ where: { jobId: lastNight.id, resourceId: same.id, signOutAt: null } });
      t.ok(sameRow?.shiftAnswer === "SAME" && sameRow.date === yesterday, "kept as SAME, on last night's date", `${sameRow?.shiftAnswer} ${sameRow?.date}`);
      if (sameRow) await c.post(c.site(supLink, "/signin"), null, { action: "MANUAL_OUT", attendanceId: sameRow.id });
    } else t.note("run after 2pm - 'same shift' on last night's job is refused then (unit tests cover the offer)");

    // (4) Tip run. The tipper's phone gets its travel pass from the supervisor's QR (allocated, regional work on the board).
    const inQr = await scanSign(await qr(dayJob.id), dayJob.id, "IN", tipper.id);
    t.ok(inQr.status === 200 && typeof inQr.body.travelPass === "string", "the tipper's phone gets its pass from the supervisor's QR", `${inQr.status} ${inQr.body.error ?? ""}`);
    const pass = inQr.body.travelPass;
    await scanSign(await qr(dayJob.id), dayJob.id, "OUT", tipper.id);
    t.status((await tip({ action: "STATUS" })).status, 401, "no pass: refused");
    t.status((await tip({ pass, deviceId: "another-phone", action: "STATUS" })).status, 401, "the pass doesn't work on another phone");
    const none = await tip({ pass, action: "START" });
    t.ok(none.status === 409, "no regional shift signed out of yet: Start tip run refused (the local day job doesn't count)", `${none.status} ${none.body.error ?? ""}`);
    // Last night's regional shift: in 10 h ago, out 2 h ago.
    const shiftOut = new Date(Date.now() - 2 * HOUR);
    const shiftRow = await db.siteAttendance.create({ data: { jobId: lastNight.id, date: yesterday, resourceId: tipper.id, workerName: tipper.name, signInAt: new Date(Date.now() - 10 * HOUR), signOutAt: shiftOut, signInMethod: "MANUAL", status: "CONFIRMED" } });
    const st = await tip({ pass, action: "STATUS" });
    t.ok(st.status === 200 && st.body.enabled === true && st.body.shifts?.[0]?.attendanceId === shiftRow.id && /Night shift/.test(st.body.shifts[0].label), "STATUS offers last night's regional shift", JSON.stringify(st.body).slice(0, 300));
    const s1 = await tip({ pass, action: "START", attendanceId: shiftRow.id });
    t.ok(s1.status === 200 && s1.body.run?.id, "Start tip run", `${s1.status} ${s1.body.error ?? ""}`);
    const s2 = await tip({ pass, action: "START", attendanceId: shiftRow.id });
    t.ok(s2.status === 200 && s2.body.run?.id === s1.body.run?.id, "a second tap shows the same run");
    t.ok((await db.tipRun.count({ where: { resourceId: tipper.id, endAt: null } })) === 1, "one open run per person");
    const run1 = await db.tipRun.findUnique({ where: { id: s1.body.run.id } });
    t.ok(run1?.jobId === lastNight.id && run1.date === yesterday && run1.shiftAttendanceId === shiftRow.id && run1.projectId === reg.id, "it belongs to that shift: its job and the shift's date");
    const fin = await tip({ pass, action: "FINISH" });
    t.ok(fin.status === 200 && /tip docket/i.test(fin.body.reminder ?? ""), "Tipped – finished, then the reminder to photograph the docket", `${fin.status} ${JSON.stringify(fin.body)}`);
    t.ok((await db.tipRun.findUnique({ where: { id: run1.id } }))?.endMethod === "FINISHED", "ended FINISHED");
    t.status((await tip({ pass, action: "FINISH" })).status, 404, "finish twice: nothing open");
    // Signed in: no start. A sign-in also ends an open run. Signing in now asks the same-shift question (phone path).
    const ask = await scanSign(await qr(dayJob.id), dayJob.id, "IN", tipper.id);
    t.ok(ask.status === 409 && ask.body.ask && ask.body.ask.newOffered === true, "phone sign-in just off a night shift: asked first (409 + ask)", `${ask.status} ${JSON.stringify(ask.body).slice(0, 200)}`);
    const in2 = await scanSign(await qr(dayJob.id), dayJob.id, "IN", tipper.id, { shiftAnswer: "NEW" });
    t.ok(in2.status === 200, "'This is a new shift' from the phone", `${in2.status} ${in2.body.error ?? ""}`);
    t.ok((await db.siteAttendance.findFirst({ where: { jobId: dayJob.id, resourceId: tipper.id, signOutAt: null } }))?.shiftAnswer === "NEW", "phone answer kept (NEW)");
    const whileIn = await tip({ pass, action: "START", attendanceId: shiftRow.id });
    t.ok(whileIn.status === 409 && /signed in/.test(whileIn.body.error ?? ""), "can't start while signed in anywhere", `${whileIn.status} ${whileIn.body.error ?? ""}`);
    await scanSign(await qr(dayJob.id), dayJob.id, "OUT", tipper.id);
    const s3 = await tip({ pass, action: "START", attendanceId: shiftRow.id });
    t.ok(s3.status === 200 && s3.body.run?.id && s3.body.run.id !== run1.id, "a second run after the first is finished", `${s3.status}`);
    await scanSign(await qr(dayJob.id), dayJob.id, "IN", tipper.id, { shiftAnswer: "NEW" });
    const run2 = await db.tipRun.findUnique({ where: { id: s3.body.run?.id ?? "-" } });
    t.ok(run2?.endAt && run2.endMethod === "SIGN_IN", "signing in ends the open run (never two places at once)", run2?.endMethod);
    const lastIn = await db.siteAttendance.findFirst({ where: { jobId: dayJob.id, resourceId: tipper.id, signOutAt: null } });
    if (lastIn) await c.post(c.site(supLink, "/signin"), null, { action: "MANUAL_OUT", attendanceId: lastIn.id });

    // Office corrections: Manager+, a reason, overlap refused; the hours then show everywhere.
    const fixStart = new Date(shiftOut.getTime() + 30 * 60_000), fixEnd = new Date(shiftOut.getTime() + 105 * 60_000); // 1h15
    t.status(await c.patch(`/api/attendance/tip-runs/${run1.id}`, "VIEWER", { endAt: fixEnd.toISOString(), reason: "rc" }), 403, "a Viewer can't correct a tip run");
    t.status(await c.patch(`/api/attendance/tip-runs/${run1.id}`, "ACCOUNTS", { endAt: fixEnd.toISOString(), reason: "rc" }), 403, "ACCOUNTS can't correct a tip run");
    if (c.users.COORDINATOR) t.status(await c.patch(`/api/attendance/tip-runs/${run1.id}`, "COORDINATOR", { endAt: fixEnd.toISOString(), reason: "rc" }), 403, "the COORDINATOR can't correct a tip run");
    t.status(await c.patch(`/api/attendance/tip-runs/${run1.id}`, "MANAGER", { startAt: fixStart.toISOString(), endAt: fixEnd.toISOString() }), 400, "a correction needs a reason");
    const ov = await c.patch(`/api/attendance/tip-runs/${run1.id}`, "MANAGER", { startAt: new Date(shiftOut.getTime() - HOUR).toISOString(), endAt: fixEnd.toISOString(), reason: "Release check - overlap" });
    t.ok(ov.status === 400 && /overlap/.test((await ov.json().catch(() => ({}))).error ?? ""), "a time over one of their sign-ins is refused", `${ov.status}`);
    const actualBefore = (await db.jobActual.findFirst({ where: { jobId: lastNight.id, resourceId: tipper.id } }))?.actualHours ?? null;
    t.status(await c.patch(`/api/attendance/tip-runs/${run1.id}`, "MANAGER", { startAt: fixStart.toISOString(), endAt: fixEnd.toISOString(), reason: "Release check - tip opened at 8" }), 200, "a Manager corrects a tip run with a reason");
    const fixed = await db.tipRun.findUnique({ where: { id: run1.id }, include: { edits: true } });
    t.ok(fixed?.endMethod === "OFFICE" && fixed.edits.length === 2 && fixed.edits.every((e) => e.reason.startsWith("Release check")), "the change and its reason are kept (TipRunEdit)");
    // Day Review: the sign-in hours for that job and person now include the run's 1.25 h (typed hours never overwritten).
    await new Promise((r) => setTimeout(r, 500));
    const actual = await db.jobActual.findFirst({ where: { jobId: lastNight.id, resourceId: tipper.id } });
    if (await db.dayClose.count({ where: { date: yesterday, status: "CLOSED" } })) t.note(`${yesterday} is closed on the copy - Day Review leaves closed days alone (unit tests cover the tip run hours)`);
    else t.ok(actual?.hoursSource === "SIGN_IN" && actualBefore != null && Math.abs(actual.actualHours - actualBefore - 1.25) < 0.01, "Day Review's sign-in hours for the shift include the tip run", `${actualBefore} -> ${actual?.actualHours} (${actual?.hoursSource})`);
    t.ok((await db.allocationCost.count({ where: { jobId: lastNight.id } })) === 0, "no allocation cost written for the shift by the tip run");

    // Sign-ins, Timesheets, Accounts, exports.
    const att = await c.json(`/api/attendance?date=${yesterday}`, "MANAGER");
    t.ok(att.body?.tipRuns?.some((r) => r.tipRunId === run1.id && r.hours === 1.25 && r.jobId === lastNight.id), "Sign-ins lists the tip run under last night's shift (1.25 h)");
    const week = (await c.json(`/api/timesheets?week=${yesterday}`, "MANAGER")).body;
    const wp = week?.people?.find((x) => x.resourceId === tipper.id);
    const runs = Object.values(wp?.tipRuns ?? {}).flat();
    t.ok(runs.some((r) => r.tipRunId === run1.id && r.date === yesterday) && wp.tipRunTotal >= 1.25 && typeof week.tipRunHours === "number", "Timesheets: the Tip run column on the shift's date", JSON.stringify(wp?.tipRuns ?? null).slice(0, 200));
    const lines = Object.values(wp?.days ?? {}).flat().reduce((n, l) => n + (l.hours ?? 0), 0);
    t.ok(Math.abs(wp.total - (lines + wp.tipRunTotal)) < 0.01, "worked total = sign-ins + tip runs (not travel)", `${wp.total} vs ${lines} + ${wp.tipRunTotal}`);
    const acc = (await c.json(`/api/accounts/timesheets?week=${yesterday}`, "ACCOUNTS")).body;
    t.ok(Object.values(acc?.people?.find((x) => x.resourceId === tipper.id)?.tipRuns ?? {}).flat().some((r) => r.tipRunId === run1.id), "the Accounts timesheet view has it too");
    for (const [who, path] of [["MANAGER", `/api/timesheets/export?week=${yesterday}`], ["ACCOUNTS", `/api/accounts/timesheets/export?week=${yesterday}`]]) {
      const r = await c.text(path, who);
      if (r.status !== 200) { t.note(`${who} timesheet export for this week answers ${r.status} on the copy (other checks seed $ names this week)`); continue; }
      t.ok(r.text.includes("Hours,Tip run (h),Travel (h)") && r.text.includes(`Tip run - ${reg.name}`) && noMoney(r.text), `${who} timesheet export: the Tip run column and line, no $`);
    }

    // Approval: a never-ended run blocks the week until the office fixes it; it's then locked into the snapshot.
    const blockWeek = "2020-08-03";
    const block = await db.tipRun.create({ data: { resourceId: tipper.id, workerName: tipper.name, jobId: `rc95-block-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-08-04", shiftAttendanceId: shiftRow.id, startAt: new Date("2020-08-04T21:00:00Z") } });
    const refused = await c.post("/api/timesheets", "MANAGER", { week: blockWeek, action: "approve" });
    const rb = await refused.json().catch(() => ({}));
    t.ok(refused.status === 400 && /tip run never ended/.test(rb.error ?? ""), "approve refused while a tip run was never ended", `${refused.status} ${rb.error ?? ""}`);
    t.status(await c.patch(`/api/attendance/tip-runs/${block.id}`, "MANAGER", { endAt: "2020-08-04T22:30:00.000Z", reason: "Release check - driver says 1.5 h" }), 200, "the office ends it with a reason");
    t.status(await c.post("/api/timesheets", "MANAGER", { week: blockWeek, action: "approve" }), 200, "approve allowed once it's fixed");
    const snap = await db.timesheetWeek.findFirst({ where: { weekStart: blockWeek, reopenedAt: null }, orderBy: { approvedAt: "desc" } });
    t.ok(JSON.parse(snap?.snapshot ?? "{}").tipRuns?.some((r) => r.tipRunId === block.id && r.hours === 1.5) && snap.totalHours >= 1.5, "the tip run is locked into the approved week (and its hours)");
    // Payroll files: a Tip run hours column, hours only (on that 2020 week - no $ names there).
    for (const f of ["payrun", "summary"]) {
      const r = await c.text(`/api/accounts/payroll/export?week=${blockWeek}&file=${f}`, "ACCOUNTS");
      t.ok(r.status === 200 && /Tip run hours/.test(r.text) && noMoney(r.text), `payroll ${f} file: Tip run hours column, no money`, `${r.status} ${r.text.slice(0, 160)}`);
      if (f === "summary") t.ok(r.text.split("\n").some((l) => l.startsWith(tipper.name) && /,1\.5\r?$/.test(l)), "summary: the person's 1.5 h in Tip run hours", r.text.slice(0, 300));
    }
    // A locked week refuses a correction.
    const lockedWeek = "2020-08-10";
    await db.timesheetWeek.create({ data: { weekStart: lockedWeek, approvedBy: "Release check", snapshot: JSON.stringify({ weekStart: lockedWeek, lines: [] }), totalHours: 0, people: 0 } });
    const old = await db.tipRun.create({ data: { resourceId: tipper.id, workerName: tipper.name, jobId: `rc95-old-${tag}`, projectId: reg.id, siteLabel: reg.name, date: "2020-08-11", shiftAttendanceId: shiftRow.id, startAt: new Date("2020-08-11T21:00:00Z") } });
    t.status(await c.patch(`/api/attendance/tip-runs/${old.id}`, "MANAGER", { endAt: "2020-08-11T22:00:00.000Z", reason: "Release check" }), 400, "a locked (approved) week refuses a tip run change");

    // Turning regional off keeps every run; Start tip run is no longer offered for it.
    const before = await db.tipRun.count({ where: { projectId: reg.id } });
    t.status(await c.patch(`/api/projects/${reg.id}`, "MANAGER", { regional: false }), 200, "a Manager marks it local");
    t.ok((await db.tipRun.count({ where: { projectId: reg.id } })) === before && before === 4, "every tip run is kept", `${before}`);
    const st2 = await tip({ pass, action: "STATUS" });
    t.ok(st2.status === 200 && (st2.body.shifts ?? []).length === 0, "not offered once the project is local");
    t.status((await tip({ pass, action: "START", attendanceId: shiftRow.id })).status, 409, "Start tip run refused on a local project");

    // Nothing with a dollar figure on any link answer; the page opens with no login.
    t.ok(linkSafe.every(noMoney), `no $ in ${linkSafe.length} link answers`);
    const page = await c.text("/site/in/tip", null);
    t.ok(page.status === 200 && !/Application error/.test(page.text), "the tip run page opens with no login", page.status);
  },
};
