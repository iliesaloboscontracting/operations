// Timesheet fixes (Ilies, 2 Nov 2026: "build fixes 1-5, break once per day over 5h", "yes fix the payroll $ names",
// and the security review TF-001..012). The once-a-day break (never below 5 h, the day rounded once, from 26 Oct
// 2026); overlaps once; fix 1 + TF-002 (tick-in ends another open line only for this crew); TF-006 (a filled-in
// office add ends one only when asked); fix 2 + TF-003 (supervisor sign-out limits); fix 3; fix 4 + TF-008/009;
// fix 5; payroll "$" names + TF-004 ("Aba"); TF-005 (same-name hire on two phones); TF-007c (a locked week's totals
// never change). WRITES on the test copy: projects, jobs, allocations, links, sign-ins, a lock that is reopened.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const HOUR = 3_600_000, MIN = 60_000;
// Feb 2027 and Jan-Mar 2020 are AEDT (UTC+11).
const aedt = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 11, m)); };
const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
const sydDate = (d) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
const hhmm24 = (d) => { const p = parts(d); return `${String(p.hour).padStart(2, "0")}:${p.minute}`; };
const ampm = (d) => { const p = parts(d); const h = Number(p.hour); return `${h % 12 === 0 ? 12 : h % 12}:${p.minute}${h < 12 ? "am" : "pm"}`; };
// Midnight at the start of a Sydney date, as a timestamp (summer or winter).
function sydMidnight(date) {
  const [y, m, d] = date.split("-").map(Number);
  for (const off of [11, 10]) { const t = Date.UTC(y, m - 1, d) - off * HOUR; const p = parts(new Date(t)); if (`${p.year}-${p.month}-${p.day}` === date && Number(p.hour) === 0) return t; }
  return Date.UTC(y, m - 1, d) - 11 * HOUR;
}

export default {
  id: "timesheet-fixes", title: "Timesheet fixes: break once a day (never below 5h, rounded once), overlaps, fixes 1-5, TF-001..012",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/dayHours.ts") || "needs the once-a-day break rule",
  async run(t, c) {
    const db = c.db, today = c.today, tag = Date.now().toString(36);
    t.note(`approved timesheet weeks in 2026 on the snapshot: ${await db.timesheetWeek.count({ where: { weekStart: { gte: "2026-01-01", lte: "2026-12-31" } } })}`);
    const people = await db.resource.findMany({ where: { type: "PERSONNEL", active: true, attendances: { none: { date: today } }, siteLinks: { none: { kind: "SUPERVISOR", revokedAt: null } } }, select: { id: true, name: true }, take: 14 });
    if (people.length < 14) return t.block("fewer than 14 active Labour-register people without a sign-in today or a supervisor link on the snapshot");
    const [P, P2, A, A2, B, C, D, E, F, S, G, H, J, K] = people;
    const proj = (name, brk = 30) => db.project.create({ data: { name: `RC ${name} ${tag}`, status: "ACTIVE", unpaidBreakMinutes: brk } });
    const job = (p, date, extra = {}) => db.job.create({ data: { projectId: p.id, title: p.name, date: new Date(`${date}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", ...extra } });
    const add = (data) => db.siteAttendance.create({ data: { status: "CONFIRMED", signInMethod: "OFFICE", ...data } });
    const office = { place: "OFFICE", placeLabel: "Office" };
    const rowsOf = (b) => [...(b?.jobs ?? []), ...(b?.points ?? [])].flatMap((j) => j.rows ?? []);

    // (1) The break rule, on a week after 26 Oct 2026 (15-21 Feb 2027).
    const W = "2027-02-15";
    const pA = await proj("rule"), pB = await proj("rule45", 45);
    const jobOn = {};
    for (const d of ["2027-02-15", "2027-02-16", "2027-02-17", "2027-02-19"]) jobOn[d] = await job(pA, d);
    const j45 = await job(pB, "2027-02-20"), night = await job(pA, "2027-02-21", { shift: "NIGHT" });
    const truck = { place: "VEHICLE", vehicleId: `rc-truck-${tag}`, placeLabel: "RC Tipper", signInMethod: "POINT" };
    const me = (d) => ({ date: d, resourceId: P.id, workerName: P.name });
    await add({ ...truck, ...me("2027-02-15"), signInAt: aedt("2027-02-15", "05:27"), signOutAt: aedt("2027-02-15", "18:04") });
    await add({ jobId: jobOn["2027-02-15"].id, ...me("2027-02-15"), signInAt: aedt("2027-02-15", "05:58"), signOutAt: aedt("2027-02-15", "17:21"), signInMethod: "MANUAL" });
    await add({ jobId: jobOn["2027-02-16"].id, ...me("2027-02-16"), signInAt: aedt("2027-02-16", "07:00"), signOutAt: aedt("2027-02-16", "11:30") });
    await add({ ...truck, ...me("2027-02-17"), signInAt: aedt("2027-02-17", "06:00"), signOutAt: aedt("2027-02-17", "07:07") });
    await add({ jobId: jobOn["2027-02-17"].id, ...me("2027-02-17"), signInAt: aedt("2027-02-17", "07:10"), signOutAt: aedt("2027-02-17", "15:30") });
    for (let i = 0; i < 20; i++) { const h = 6 + Math.floor(i / 2), m = i % 2 ? 30 : 0; await add({ ...office, ...me("2027-02-18"), signInAt: aedt("2027-02-18", `${h}:${m}`), signOutAt: aedt("2027-02-18", `${h}:${m + 8}`) }); }
    await add({ jobId: jobOn["2027-02-19"].id, ...me("2027-02-19"), signInAt: aedt("2027-02-19", "06:00"), signOutAt: aedt("2027-02-19", "16:00") });
    await add({ ...office, ...me("2027-02-19"), signInAt: aedt("2027-02-19", "08:00"), signOutAt: aedt("2027-02-19", "09:00") });
    await add({ ...office, ...me("2027-02-20"), signInAt: aedt("2027-02-20", "06:00"), signOutAt: aedt("2027-02-20", "10:00") });
    await add({ jobId: j45.id, ...me("2027-02-20"), signInAt: aedt("2027-02-20", "10:30"), signOutAt: aedt("2027-02-20", "16:00") });
    await add({ jobId: night.id, ...me("2027-02-21"), signInAt: aedt("2027-02-21", "20:00"), signOutAt: aedt("2027-02-22", "04:30") });
    // TF-011 on someone else: 5:10 -> 5.0, 6:00 -> 5.5.
    await add({ ...office, date: "2027-02-15", resourceId: P2.id, workerName: P2.name, signInAt: aedt("2027-02-15", "07:00"), signOutAt: aedt("2027-02-15", "12:10") });
    await add({ ...office, date: "2027-02-16", resourceId: P2.id, workerName: P2.name, signInAt: aedt("2027-02-16", "07:00"), signOutAt: aedt("2027-02-16", "13:00") });
    // TF-005: two hire workers who typed the same name, on two phones, at the same time.
    for (const dev of ["rc-phone-1", "rc-phone-2"]) await add({ ...office, date: "2027-02-15", workerName: `RC Sam ${tag}`, company: "RC Labour", deviceId: `${dev}-${tag}`, signInAt: aedt("2027-02-15", "07:00"), signOutAt: aedt("2027-02-15", "15:30"), signInMethod: "POINT" });

    const w = (await c.json(`/api/timesheets?week=${W}`, "MANAGER")).body;
    const p = w?.people?.find((x) => x.resourceId === P.id), p2 = w?.people?.find((x) => x.resourceId === P2.id);
    const dayTotal = (pp, d) => (pp?.days?.[d] ?? []).reduce((n, l) => n + (l.hours ?? 0), 0);
    t.ok(dayTotal(p, "2027-02-15") === 12 && (p?.days?.["2027-02-15"] ?? []).every((l) => l.overlap), "Carlos's Monday: truck + site overlapping count once = 12h, both 'overlap'", JSON.stringify((p?.days?.["2027-02-15"] ?? []).map((l) => [l.site, l.hours])));
    t.ok(dayTotal(p, "2027-02-16") === 4.5, "a 4.5h day gets no break");
    t.ok(dayTotal(p, "2027-02-17") === 9 && (p?.days?.["2027-02-17"] ?? []).reduce((n, l) => n + l.breakMinutes, 0) === 30, "truck + site on one day: ONE break, the day rounded once (537 min -> 9.0h)", String(dayTotal(p, "2027-02-17")));
    t.ok(dayTotal(p, "2027-02-18") === 2.75, "TF-001: 20 x 8 min = 2.75h (not 0)", String(dayTotal(p, "2027-02-18")));
    t.ok(dayTotal(p, "2027-02-19") === 9.5, "nested lines count once (06:00-16:00 with 08:00-09:00 inside = 9.5h)", String(dayTotal(p, "2027-02-19")));
    t.ok(dayTotal(p, "2027-02-20") === 8.75 && (p?.days?.["2027-02-20"] ?? []).some((l) => l.breakMinutes === 45), "differing breaks: the largest (45 min) comes off once", String(dayTotal(p, "2027-02-20")));
    t.ok(dayTotal(p, "2027-02-21") === 8, "a night shift 20:00-04:30 stays on its start date: 8h", String(dayTotal(p, "2027-02-21")));
    t.ok(p?.total === 54.5, "the week: 12 + 4.5 + 9 + 2.75 + 9.5 + 8.75 + 8 = 54.5h", p?.total);
    t.ok(dayTotal(p2, "2027-02-15") === 5 && dayTotal(p2, "2027-02-16") === 5.5, "TF-011 'never below 5': 5:10 -> 5.0h, 6:00 -> 5.5h", `${dayTotal(p2, "2027-02-15")} / ${dayTotal(p2, "2027-02-16")}`);
    const pay = (await c.json(`/api/accounts/payroll?week=${W}`, "ACCOUNTS")).body;
    t.ok(pay?.people?.find((x) => x.personKey === P.id)?.hours === 54.5, "Accounts payroll: the same 54.5h", pay?.people?.find((x) => x.personKey === P.id)?.hours);
    const sam = pay?.people?.find((x) => x.name === `RC Sam ${tag}`);
    t.ok(sam?.hours === 16, "TF-005: same-name hire workers on two phones keep their own hours (8 + 8)", sam?.hours);
    const att = (await c.json("/api/attendance?date=2027-02-15", "MANAGER")).body;
    t.ok(rowsOf(att).filter((r) => r.resourceId === P.id).every((r) => r.flags.includes("OVERLAP")), "Sign-ins page flags both Monday lines OVERLAP");
    t.ok(/Overlap - counted once/.test((await c.text(`/api/timesheets/export?week=${W}`, "MANAGER")).text), "the timesheet CSV says 'Overlap - counted once'");

    // (2) TF-007c: a locked week's totals never change, whatever the live sign-ins do.
    const LW = "2020-01-13";
    await db.timesheetWeek.create({ data: { weekStart: LW, approvedBy: "Release check", totalHours: 7.5, people: 1, snapshot: JSON.stringify({ weekStart: LW, lines: [{ attendanceId: `rc-locked-${tag}`, date: "2020-01-14", resourceId: K.id, name: K.name, role: null, site: "Office", in: "7:00 am", out: "3:00 pm", breakMinutes: 30, hours: 7.5, status: "CONFIRMED", allocated: true, changedByOffice: null }], travel: [] }) } });
    const before = (await c.json(`/api/timesheets?week=${LW}`, "MANAGER")).body?.totalHours;
    await add({ ...office, date: "2020-01-15", resourceId: K.id, workerName: K.name, signInAt: aedt("2020-01-15", "07:00"), signOutAt: aedt("2020-01-15", "17:00") });
    const after = (await c.json(`/api/timesheets?week=${LW}`, "MANAGER")).body;
    const acct = (await c.json(`/api/accounts/timesheets?week=${LW}`, "ACCOUNTS")).body;
    t.ok(before === 7.5 && after?.totalHours === 7.5 && acct?.totalHours === 7.5 && after?.changedSinceApproval > 0, "TF-007c: a locked week's total stays 7.5h after a new live sign-in (the change is only counted)", `${before} / ${after?.totalHours} / ${acct?.totalHours}`);

    // Today's jobs.
    const pT = await proj("today"), pT2 = await proj("other"), pT3 = await proj("third");
    const T = await job(pT, today), T2 = await job(pT2, today), T3 = await job(pT3, today);
    for (const r of [A, A2, S, C]) await db.assignment.create({ data: { jobId: T.id, resourceId: r.id } });
    const sup = await makeLink(db, "SUPERVISOR", S.id);
    const officePoint = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const sitePoster = await makeLink(db, "POSTER", null, { projectId: pT.id });
    const now = Date.now();
    const midnight = sydMidnight(today);
    const sinceMidnight = Math.floor((now - midnight) / MIN);
    const supPost = (body) => c.post(c.site(sup, "/signin"), null, body);

    // (3) Fix 1 + TF-002: tick-in ends the crew's other open line; never pulls a non-crew person off another site.
    const scan = await c.json(`/api/site/in/${officePoint.secret}`, null);
    await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId: officePoint.id, action: "IN", resourceId: A.id, deviceId: `rc67-${tag}` });
    t.status(await supPost({ action: "MANUAL_IN", jobId: T.id, resourceId: A.id }), 200, "the supervisor ticks crew member A in");
    const aOffice = await db.siteAttendance.findFirst({ where: { resourceId: A.id, date: today, place: "OFFICE" }, include: { edits: true } });
    t.ok(aOffice?.signOutAt && aOffice.signOutMethod === "MOVED" && aOffice.edits.some((e) => /counted once/.test(e.reason)), "fix 1: A's open office sign-in ended at the tick-in, with a note");
    await c.post("/api/attendance", "MANAGER", { jobId: T2.id, resourceId: A2.id, signInAt: new Date(now - 2 * HOUR).toISOString(), reason: "RC A2 at T2" });
    t.status(await supPost({ action: "MANUAL_IN", jobId: T.id, resourceId: A2.id }), 200, "an allocated crew member signed in at another site is ticked in");
    const a2Other = await db.siteAttendance.findFirst({ where: { resourceId: A2.id, jobId: T2.id } });
    t.ok(a2Other?.signOutAt && a2Other.status === "TO_CONFIRM", "TF-002: their other site line is ended and sent to its supervisor to confirm");
    await c.post("/api/attendance", "MANAGER", { jobId: T2.id, resourceId: H.id, signInAt: new Date(now - 2 * HOUR).toISOString(), reason: "RC H at T2" });
    const hTick = await supPost({ action: "MANUAL_IN", jobId: T.id, resourceId: H.id });
    t.ok(hTick.status === 400 && /signed in at/.test((await hTick.json().catch(() => ({}))).error ?? ""), "TF-002: ticking in someone NOT on this crew who's signed in elsewhere is refused", hTick.status);
    t.ok(!(await db.siteAttendance.findFirst({ where: { resourceId: H.id, jobId: T2.id } }))?.signOutAt, "...and their line elsewhere stays open");

    // (4) TF-006: a filled-in office add ends another open line only when asked (endOpen).
    t.status(await c.post("/api/attendance", "MANAGER", { place: "OFFICE", resourceId: B.id, signInAt: new Date(now - 3 * HOUR).toISOString(), reason: "RC B office open" }), 201, "office adds B at the office, still on site today");
    t.status(await c.post("/api/attendance", "MANAGER", { jobId: T3.id, resourceId: B.id, signInAt: new Date(now - 2 * HOUR).toISOString(), signOutAt: new Date(now - 90 * MIN).toISOString(), reason: "RC B site, filled in" }), 201, "office fills in B's site line (with a sign-out)");
    t.ok(!(await db.siteAttendance.findFirst({ where: { resourceId: B.id, date: today, place: "OFFICE" } }))?.signOutAt, "TF-006: without 'end their other open sign-in' the office line stays open");
    const withEnd = await c.post("/api/attendance", "MANAGER", { jobId: T3.id, resourceId: B.id, signInAt: new Date(now - HOUR).toISOString(), signOutAt: new Date(now - 30 * MIN).toISOString(), reason: "RC B site again", endOpen: true });
    const withEndB = await withEnd.json().catch(() => ({}));
    const bOffice = await db.siteAttendance.findFirst({ where: { resourceId: B.id, date: today, place: "OFFICE" } });
    t.ok(withEnd.status === 201 && withEndB.ended === 1 && bOffice?.signOutAt && Math.abs(bOffice.signOutAt.getTime() - (now - HOUR)) < MIN, "TF-006: with endOpen the office line ends at the new sign-in time, and the answer says 1 ended", `${withEnd.status} ${JSON.stringify(withEndB)}`);

    // (5) Fix 2a: an earlier day needs a sign-out.
    const past = { place: "OFFICE", resourceId: G.id, signInAt: aedt("2020-02-20", "07:00").toISOString(), reason: "RC past add" };
    const noOut = await c.post("/api/attendance", "MANAGER", past);
    t.ok(noOut.status === 400 && /sign-out/i.test((await noOut.json().catch(() => ({}))).error ?? ""), "fix 2a: adding an earlier day's sign-in with no sign-out is refused", noOut.status);
    t.status(await c.post("/api/attendance", "MANAGER", { ...past, signOutAt: aedt("2020-02-20", "15:30").toISOString() }), 201, "with its sign-out it's added");

    // (6) Fix 2b + TF-003: the supervisor's sign-out at a time today, and its limits. All times stay inside today.
    const room = Math.max(2, Math.min(120, sinceMidnight - 1));
    const cIn = new Date(now - room * MIN);
    await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: C.id, signInAt: cIn.toISOString(), reason: "RC C on site" });
    const cRow = await db.siteAttendance.findFirst({ where: { resourceId: C.id, jobId: T.id } });
    const future = new Date(Math.min(now + 30 * MIN, midnight + (24 * 60 - 1) * MIN));
    if (hhmm24(future) > hhmm24(new Date(now))) t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: cRow.id, time: hhmm24(future) }), 400, "fix 2b: a sign-out time later than now is refused");
    else t.note("it's 11:59pm - the later-than-now refusal can't be asked today");
    t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: cRow.id, time: hhmm24(new Date(cIn.getTime() - MIN)) }), 400, "fix 2b: a time before they signed in is refused");
    const t3Line = await db.siteAttendance.findFirst({ where: { resourceId: B.id, jobId: T3.id } });
    t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: t3Line.id, time: hhmm24(new Date(now)) }), 400, "TF-003: a sign-in on another job is refused");
    await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: S.id, signInAt: cIn.toISOString(), reason: "RC S on site" });
    const sRow = await db.siteAttendance.findFirst({ where: { resourceId: S.id, jobId: T.id } });
    t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: sRow.id, time: hhmm24(new Date(now)) }), 400, "TF-003: their own sign-out time is the office's");
    const yesterday = sydDate(new Date(midnight - 12 * HOUR));
    const N = await job(pT, yesterday, { shift: "NIGHT" });
    await db.assignment.create({ data: { jobId: N.id, resourceId: S.id } });
    await db.assignment.create({ data: { jobId: N.id, resourceId: J.id } });
    const jRow = await add({ jobId: N.id, date: yesterday, resourceId: J.id, workerName: J.name, signInAt: new Date(now - 17 * HOUR), signInMethod: "MANUAL" });
    t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: jRow.id, time: hhmm24(new Date(now)) }), 400, "TF-003: yesterday's night line over 16 h is refused (chosen time)");
    t.status(await supPost({ action: "MANUAL_OUT", attendanceId: jRow.id }), 400, "TF-003: ...and the same cap applies to 'sign out now'");
    t.status(await supPost({ action: "MANUAL_OUT_MANY", attendanceIds: [jRow.id] }), 400, "TF-003: ...and to 'sign all out'");
    const mid = new Date(cIn.getTime() + Math.floor((now - cIn.getTime()) / 2));
    t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: cRow.id, time: hhmm24(mid) }), 200, "fix 2b: the supervisor signs C out at the time they left");
    const cAfter = await db.siteAttendance.findUnique({ where: { id: cRow.id }, include: { edits: true } });
    t.ok(cAfter?.signOutAt && cAfter.edits.some((e) => /set by .* on their link/.test(e.reason)), "the chosen time is kept with a note");

    // (7) Fix 5b: signed in but not on the board -> flagged on Approve hours.
    await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: D.id, signInAt: cIn.toISOString(), signOutAt: new Date(now).toISOString(), reason: "RC D not on board" });
    const hours = (await c.json(c.site(sup, `/hours?date=${today}`), null)).body;
    t.ok(hours?.jobs?.flatMap((j) => j.crew).find((x) => x.name === D.name)?.notOnBoard === true, "fix 5b: 'not on the board - confirm they worked' on Approve hours");
    t.ok(noMoney(JSON.stringify(hours ?? {})), "Approve hours: no $");

    // (8) Fix 2c: yesterday's open sign-in on today's banner.
    const yOpen = await add({ ...office, date: yesterday, resourceId: E.id, workerName: E.name, signInAt: new Date(midnight - 10 * HOUR) });
    t.ok((await c.json(`/api/attendance?date=${today}`, "MANAGER")).body?.gaps?.noSignOutYesterday?.some((o) => o.id === yOpen.id), "fix 2c: yesterday's open sign-in is on the Sign-ins banner");

    // (9) Fix 5a: allocated, not signed in, 90 min after the start - the job dated on the start's own day (after
    // midnight that's yesterday's job, which the check includes).
    const start = new Date(now - 90 * MIN);
    const pLate = await proj("late");
    const U = await job(pLate, sydDate(start), { startTime: ampm(start), endTime: "11:59pm" });
    await db.assignment.create({ data: { jobId: U.id, resourceId: F.id } });
    const g2 = (await c.json(`/api/attendance?date=${today}`, "MANAGER")).body?.gaps;
    t.ok(g2?.notSignedIn?.some((j) => j.jobId === U.id && j.names.includes(F.name)), "fix 5a: allocated but not signed in 90 min after the start is on the banner", JSON.stringify(g2?.notSignedIn ?? []).slice(0, 200));

    // (10) Fix 3: tomorrow's job with crew and no way to sign in; a poster fixes it.
    const tomorrow = sydDate(new Date(midnight + 36 * HOUR));
    const pHills = await proj("hills");
    const V = await job(pHills, tomorrow);
    await db.assignment.create({ data: { jobId: V.id, resourceId: G.id } });
    t.ok(((await c.json(`/api/jobs?date=${tomorrow}`, "VIEWER")).body ?? []).find((j) => j.id === V.id)?.noSignInWay === true, "fix 3: 'No way to sign in' on tomorrow's board row");
    await makeLink(db, "POSTER", null, { projectId: pHills.id });
    t.ok(!((await c.json(`/api/jobs?date=${tomorrow}`, "VIEWER")).body ?? []).find((j) => j.id === V.id)?.noSignInWay, "with a site poster it has a way to sign in");

    // (11) Fix 4 + TF-008/009: staff signed in as hire.
    const pScan = await c.json(`/api/site/in/${sitePoster.secret}`, null);
    const lobos = await c.post("/api/site/in/sign", null, { ticket: pScan.body?.ticket, jobId: T.id, action: "IN", hire: { name: P.name, company: "Lobos Civil" }, deviceId: `rc67h-${tag}` });
    t.ok(lobos.status === 400 && /Lobos staff/.test((await lobos.json().catch(() => ({}))).error ?? ""), "TF-008: a phone hire sign-in with company 'Lobos Civil' is refused", lobos.status);
    const hireAdd = await c.post("/api/attendance", "MANAGER", { jobId: T.id, hire: { name: P.name, company: "Lobos" }, signInAt: cIn.toISOString(), signOutAt: new Date(now).toISOString(), reason: "RC hire as staff" });
    const hireId = (await hireAdd.json().catch(() => ({}))).id;
    const hr = rowsOf((await c.json(`/api/attendance?date=${today}`, "MANAGER")).body).find((r) => r.id === hireId);
    t.ok(hr?.flags?.includes("LOOKS_LIKE_STAFF") && hr.staffLike?.some((s) => s.id === P.id && s.exact), "fix 4: a hire 'name / Lobos' added by the office is flagged, the staff member suggested (full name: exact)");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "VIEWER", { resourceId: P.id, reason: "rc" }), 403, "a Viewer can't move it");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "ACCOUNTS", { resourceId: P.id, reason: "rc move" }), 403, "ACCOUNTS can't move it");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "MANAGER", { resourceId: P.id }), 400, "moving needs a reason");
    const inactive = await db.resource.findFirst({ where: { type: "PERSONNEL", active: false }, select: { id: true } });
    if (inactive) t.status(await c.post(`/api/attendance/${hireId}/person`, "MANAGER", { resourceId: inactive.id, reason: "Release check" }), 400, "TF-009: moving onto an inactive person is refused");
    else t.note("no inactive person on the snapshot - the inactive-person refusal wasn't exercised");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "MANAGER", { resourceId: P.id, reason: "Release check - signed in as hire, is staff" }), 200, "a Manager moves it onto the staff member");
    const moved = await db.siteAttendance.findUnique({ where: { id: hireId }, include: { edits: true } });
    t.ok(moved?.resourceId === P.id && moved.company === null && moved.edits.some((e) => e.field === "person"), "it's theirs now, and the change is kept");
    await db.timesheetWeek.create({ data: { weekStart: "2020-03-09", approvedBy: "Release check", snapshot: JSON.stringify({ weekStart: "2020-03-09", lines: [] }), totalHours: 0, people: 0 } });
    const lockedHire = await add({ ...office, date: "2020-03-10", workerName: P.name, company: "Lobos", signInAt: aedt("2020-03-10", "07:00"), signOutAt: aedt("2020-03-10", "15:00") });
    t.status(await c.post(`/api/attendance/${lockedHire.id}/person`, "MANAGER", { resourceId: P.id, reason: "Release check" }), 400, "a locked week refuses the move");

    // (12) Payroll files with "$" names and a worker called "Aba" (week of 24 Feb 2020): made, $-free, "Name to check".
    await add({ ...office, date: "2020-02-25", resourceId: G.id, workerName: G.name, signInAt: aedt("2020-02-25", "07:00"), signOutAt: aedt("2020-02-25", "15:30") });
    await add({ ...office, date: "2020-02-25", workerName: "Hire Worker $40", company: "$5 Labour", signInAt: aedt("2020-02-25", "07:00"), signOutAt: aedt("2020-02-25", "15:30") });
    await add({ ...office, date: "2020-02-26", workerName: "Aba", company: "RC Hire", signInAt: aedt("2020-02-26", "07:00"), signOutAt: aedt("2020-02-26", "15:30") });
    for (const f of ["payrun", "summary"]) {
      const r = await c.text(`/api/accounts/payroll/export?week=2020-02-24&file=${f}`, "ACCOUNTS");
      t.ok(r.status === 200 && noMoney(r.text) && !/\$/.test(r.text) && !/\baba\b/i.test(r.text), `payroll ${f} file with "$" names and "Aba": 200, $-free, no bank-file word`, `${r.status} ${r.text.slice(0, 160)}`);
      if (f === "summary") t.ok(/Name to check \(Sign-ins 2020-02-26\)/.test(r.text) && /Hire Worker/.test(r.text), "TF-004: 'Aba' shows as 'Name to check (Sign-ins 2020-02-26)'; the $ name keeps its words");
    }
    const payW = (await c.json("/api/accounts/payroll?week=2020-02-24", "ACCOUNTS")).body;
    t.ok(payW?.namesToCheck?.some((n) => n.date === "2020-02-26"), "TF-004: the Payroll screen lists it for the office");

    // (13) TF-003: a locked week refuses the supervisor's sign-out (this week, locked here and reopened straight after).
    await db.assignment.create({ data: { jobId: T.id, resourceId: K.id } });
    await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: K.id, signInAt: cIn.toISOString(), reason: "RC K on site" });
    const kRow = await db.siteAttendance.findFirst({ where: { resourceId: K.id, jobId: T.id } });
    const lock = await db.timesheetWeek.create({ data: { weekStart: c.thisWeek, approvedBy: "Release check", snapshot: JSON.stringify({ weekStart: c.thisWeek, lines: [] }), totalHours: 0, people: 0 } });
    t.status(await supPost({ action: "MANUAL_OUT_AT", attendanceId: kRow.id, time: hhmm24(mid) }), 400, "TF-003: a locked week refuses the supervisor's sign-out");
    await db.timesheetWeek.update({ where: { id: lock.id }, data: { reopenedAt: new Date(), reopenedBy: "Release check", reopenReason: "release check lock test" } });
  },
};
