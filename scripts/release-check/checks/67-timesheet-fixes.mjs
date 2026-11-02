// Timesheet fixes (Ilies, 2 Nov 2026: "build fixes 1-5, break once per day over 5h" + "yes fix the payroll $ names"),
// from the week of 26 Oct review. The once-a-day break and overlaps counted once (timesheets, payroll, Sign-ins page);
// fix 1 (any sign-in path ends another open one); fix 2 (office add needs a sign-out; Approve hours sign-out; the
// 7am list); fix 3 (no way to sign in tomorrow, on the board); fix 4 (staff signed in as hire, "Move to staff"); fix 5
// (not signed in an hour after the start; not on the board on Approve hours); the payroll files with "$" names.
// WRITES on the test copy: projects, jobs, allocations, links, sign-ins and one approved far-past week.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const HOUR = 3_600_000;
const aedt = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 11, m)); }; // Jan-Mar 2020 = AEDT
const sydney = (d, o) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", ...o }).format(d);
const ampm = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hourCycle: "h12" }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase().replace(/\./g, "")}`; };
const hhmm24 = (d) => sydney(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default {
  id: "timesheet-fixes", title: "Timesheet fixes: break once a day over 5h, overlaps once, fixes 1-5, payroll $ names",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/lib/dayHours.ts") || "needs the once-a-day break rule",
  async run(t, c) {
    const db = c.db, today = c.today, tag = Date.now().toString(36);
    t.note(`approved timesheet weeks on the snapshot before this check: ${await db.timesheetWeek.count()}`);
    const people = await db.resource.findMany({ where: { type: "PERSONNEL", active: true, attendances: { none: { date: today } } }, select: { id: true, name: true }, take: 9 });
    if (people.length < 9) return t.block("fewer than 9 active Labour-register people without a sign-in today on the snapshot");
    const [P, A, B, C, D, E, F, S, G] = people;
    const proj = (name) => db.project.create({ data: { name: `RC ${name} ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 30 } });
    const job = (p, date, extra = {}) => db.job.create({ data: { projectId: p.id, title: p.name, date: new Date(`${date}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", ...extra } });
    const add = (data) => db.siteAttendance.create({ data: { status: "CONFIRMED", signInMethod: "OFFICE", ...data } });

    // (1) The break rule and overlaps, on a far-past week (17 Feb 2020).
    const pPast = await proj("past");
    const mon = await job(pPast, "2020-02-17"), tue = await job(pPast, "2020-02-18"), wed = await job(pPast, "2020-02-19");
    const truck = { place: "VEHICLE", vehicleId: `rc-truck-${tag}`, placeLabel: "RC Tipper" };
    await add({ ...truck, date: "2020-02-17", resourceId: P.id, workerName: P.name, signInAt: aedt("2020-02-17", "05:27"), signOutAt: aedt("2020-02-17", "18:04"), signInMethod: "POINT" });
    await add({ jobId: mon.id, date: "2020-02-17", resourceId: P.id, workerName: P.name, signInAt: aedt("2020-02-17", "05:58"), signOutAt: aedt("2020-02-17", "17:21"), signInMethod: "MANUAL" });
    await add({ jobId: tue.id, date: "2020-02-18", resourceId: P.id, workerName: P.name, signInAt: aedt("2020-02-18", "07:00"), signOutAt: aedt("2020-02-18", "11:30") });
    await add({ ...truck, date: "2020-02-19", resourceId: P.id, workerName: P.name, signInAt: aedt("2020-02-19", "06:00"), signOutAt: aedt("2020-02-19", "07:07"), signInMethod: "POINT" });
    await add({ jobId: wed.id, date: "2020-02-19", resourceId: P.id, workerName: P.name, signInAt: aedt("2020-02-19", "07:10"), signOutAt: aedt("2020-02-19", "15:30") });
    const w = (await c.json("/api/timesheets?week=2020-02-17", "MANAGER")).body;
    const p = w?.people?.find((x) => x.resourceId === P.id);
    const day = (d) => p?.days?.[d] ?? [];
    t.ok(day("2020-02-17").reduce((n, l) => n + (l.hours ?? 0), 0) === 12 && day("2020-02-17").every((l) => l.overlap), "Carlos's Monday: truck 05:27-18:04 + site 05:58-17:21 count once = 12h, both 'overlap'", JSON.stringify(day("2020-02-17").map((l) => [l.site, l.hours, l.overlap])));
    t.ok(day("2020-02-18")[0]?.hours === 4.5 && day("2020-02-18")[0]?.breakMinutes === 0, "a 4.5h day gets no break");
    const wedL = day("2020-02-19");
    t.ok(wedL.reduce((n, l) => n + l.breakMinutes, 0) === 30 && wedL.reduce((n, l) => n + (l.hours ?? 0), 0) === 8.75, "truck + site on one day: ONE 30 min break (1h + 7.75h)", JSON.stringify(wedL.map((l) => [l.site, l.hours, l.breakMinutes])));
    t.ok(p?.total === 25.25, "the week: 12 + 4.5 + 8.75 = 25.25h", p?.total);
    const pay = (await c.json("/api/accounts/payroll?week=2020-02-17", "ACCOUNTS")).body;
    t.ok(pay?.people?.find((x) => x.personKey === P.id)?.hours === 25.25, "Accounts payroll: the same 25.25h", pay?.people?.find((x) => x.personKey === P.id)?.hours);
    const att = (await c.json("/api/attendance?date=2020-02-17", "MANAGER")).body;
    const rowsOf = (b) => [...(b?.jobs ?? []), ...(b?.points ?? [])].flatMap((j) => j.rows ?? []);
    t.ok(rowsOf(att).filter((r) => r.resourceId === P.id).every((r) => r.flags.includes("OVERLAP")), "Sign-ins page flags both Monday lines OVERLAP");
    const csv = (await c.text("/api/timesheets/export?week=2020-02-17", "MANAGER")).text;
    t.ok(/Overlap - counted once/.test(csv), "the timesheet CSV says 'Overlap - counted once'");

    // Today's jobs for fixes 1, 2, 4, 5.
    const pToday = await proj("today");
    const T = await job(pToday, today);
    for (const r of [A, S, C]) await db.assignment.create({ data: { jobId: T.id, resourceId: r.id } });
    const sup = await makeLink(db, "SUPERVISOR", S.id);
    const officePoint = await makeLink(db, "POSTER", null, { place: "OFFICE" });
    const now = Date.now();

    // (2) Fix 1: ticking someone in ends their open sign-in elsewhere; so does an office add.
    const scan = await c.json(`/api/site/in/${officePoint.secret}`, null);
    await c.post("/api/site/in/sign", null, { ticket: scan.body?.ticket, jobId: officePoint.id, action: "IN", resourceId: A.id, deviceId: `rc67-${tag}` });
    const tick = await c.post(c.site(sup, "/signin"), null, { action: "MANUAL_IN", jobId: T.id, resourceId: A.id });
    t.status(tick, 200, "the supervisor ticks A in on site");
    const aOffice = await db.siteAttendance.findFirst({ where: { resourceId: A.id, date: today, place: "OFFICE" }, include: { edits: true } });
    t.ok(aOffice?.signOutAt && aOffice.signOutMethod === "MOVED" && aOffice.edits.some((e) => /counted once/.test(e.reason)), "fix 1: A's open office sign-in ended at the tick-in, with a note");
    t.status(await c.post("/api/attendance", "MANAGER", { place: "OFFICE", resourceId: B.id, signInAt: new Date(now - 3 * HOUR).toISOString(), reason: "RC office open" }), 201, "office adds B at the office, still on site today");
    t.status(await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: B.id, signInAt: new Date(now - HOUR).toISOString(), signOutAt: new Date(now - 30 * 60_000).toISOString(), reason: "RC moved to site" }), 201, "office adds B on site an hour ago");
    const bOffice = await db.siteAttendance.findFirst({ where: { resourceId: B.id, date: today, place: "OFFICE" } });
    t.ok(bOffice?.signOutAt && Math.abs(bOffice.signOutAt.getTime() - (now - HOUR)) < 60_000, "fix 1: the office add ended B's open office line at the new sign-in time");

    // (3) Fix 2a: an earlier day needs a sign-out; fix 2b: the supervisor signs someone out at a time today.
    const past = { place: "OFFICE", resourceId: G.id, signInAt: aedt("2020-02-20", "07:00").toISOString(), reason: "RC past add" };
    const noOut = await c.post("/api/attendance", "MANAGER", past);
    const noOutB = await noOut.json().catch(() => ({}));
    t.ok(noOut.status === 400 && /sign-out/i.test(noOutB.error ?? ""), "fix 2a: adding an earlier day's sign-in with no sign-out is refused", `${noOut.status} ${noOutB.error ?? ""}`);
    t.status(await c.post("/api/attendance", "MANAGER", { ...past, signOutAt: aedt("2020-02-20", "15:30").toISOString() }), 201, "with its sign-out it's added");
    const cIn = new Date(now - 2 * HOUR);
    if (sydney(cIn, { day: "2-digit" }) === sydney(new Date(now), { day: "2-digit" })) {
      await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: C.id, signInAt: cIn.toISOString(), reason: "RC C on site" });
      const cRow = await db.siteAttendance.findFirst({ where: { resourceId: C.id, jobId: T.id } });
      t.status(await c.post(c.site(sup, "/signin"), null, { action: "MANUAL_OUT_AT", attendanceId: cRow.id, time: hhmm24(new Date(now + 2 * HOUR)) }), 400, "fix 2b: a sign-out time in the future is refused");
      t.status(await c.post(c.site(sup, "/signin"), null, { action: "MANUAL_OUT_AT", attendanceId: cRow.id, time: hhmm24(new Date(now - 3 * HOUR)) }), 400, "fix 2b: a time before they signed in is refused");
      t.status(await c.post(c.site(sup, "/signin"), null, { action: "MANUAL_OUT_AT", attendanceId: cRow.id, time: hhmm24(new Date(now - HOUR)) }), 200, "fix 2b: the supervisor signs C out at the time they left");
      const cAfter = await db.siteAttendance.findUnique({ where: { id: cRow.id }, include: { edits: true } });
      t.ok(cAfter?.signOutAt && cAfter.edits.some((e) => /set by .* on their link/.test(e.reason)), "the chosen time is kept with a note");
    } else t.note("too close to midnight for the sign-out-at-a-time checks - skipped");

    // (4) Fix 5b: someone signed in but not on the board shows on Approve hours, flagged.
    await c.post("/api/attendance", "MANAGER", { jobId: T.id, resourceId: D.id, signInAt: new Date(now - HOUR).toISOString(), signOutAt: new Date(now - 10 * 60_000).toISOString(), reason: "RC D not on board" });
    const hours = (await c.json(c.site(sup, `/hours?date=${today}`), null)).body;
    const dRow = hours?.jobs?.flatMap((j) => j.crew).find((x) => x.name === D.name);
    t.ok(dRow?.notOnBoard === true, "fix 5b: 'not on the board - confirm they worked' on Approve hours");
    t.ok(noMoney(JSON.stringify(hours ?? {})), "Approve hours: no $");

    // (5) Fix 2c: yesterday's open sign-in is in today's banner list.
    const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const yOpen = await add({ place: "OFFICE", placeLabel: "Office", date: yesterday, resourceId: E.id, workerName: E.name, signInAt: new Date(now - 26 * HOUR) });
    const gaps = (await c.json(`/api/attendance?date=${today}`, "MANAGER")).body?.gaps;
    t.ok(gaps?.noSignOutYesterday?.some((o) => o.id === yOpen.id), "fix 2c: yesterday's open sign-in is on the Sign-ins banner");

    // (6) Fix 5a: allocated, not signed in, an hour and a half after the start.
    const start = new Date(now - 90 * 60_000);
    if (sydney(start, { day: "2-digit" }) === sydney(new Date(now), { day: "2-digit" })) {
      const pLate = await proj("late");
      const U = await job(pLate, today, { startTime: ampm(start), endTime: "11:59pm" });
      await db.assignment.create({ data: { jobId: U.id, resourceId: F.id } });
      const g2 = (await c.json(`/api/attendance?date=${today}`, "MANAGER")).body?.gaps;
      t.ok(g2?.notSignedIn?.some((j) => j.jobId === U.id && j.names.includes(F.name)), "fix 5a: allocated but not signed in an hour after the start is on the banner", JSON.stringify(g2?.notSignedIn ?? []).slice(0, 200));
    } else t.note("too close to midnight for the not-signed-in check - skipped");

    // (7) Fix 3: tomorrow's job with crew and no way to sign in shows on the board; a poster fixes it.
    const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    const pHills = await proj("hills");
    const V = await job(pHills, tomorrow);
    // Someone with no supervisor link of their own (live data has plenty of supervisors with links).
    const noLink = await db.resource.findFirst({ where: { type: "PERSONNEL", active: true, siteLinks: { none: { kind: "SUPERVISOR", revokedAt: null } } }, select: { id: true } });
    if (!noLink) return t.block("every active person has a supervisor link on the snapshot - fix 3 can't be checked");
    await db.assignment.create({ data: { jobId: V.id, resourceId: noLink.id } });
    const j1 = (await c.json(`/api/jobs?date=${tomorrow}`, "VIEWER")).body ?? [];
    t.ok(j1.find((j) => j.id === V.id)?.noSignInWay === true, "fix 3: 'No way to sign in' on tomorrow's board row");
    await makeLink(db, "POSTER", null, { projectId: pHills.id });
    const j2 = (await c.json(`/api/jobs?date=${tomorrow}`, "VIEWER")).body ?? [];
    t.ok(!j2.find((j) => j.id === V.id)?.noSignInWay, "with a site poster it has a way to sign in");

    // (8) Fix 4: "Ratu / Lobos" signed in as hire - flagged, moved onto the staff member with a reason.
    const hireAdd = await c.post("/api/attendance", "MANAGER", { jobId: T.id, hire: { name: P.name, company: "Lobos" }, signInAt: new Date(now - HOUR).toISOString(), signOutAt: new Date(now - 5 * 60_000).toISOString(), reason: "RC hire as staff" });
    const hireId = (await hireAdd.json().catch(() => ({}))).id;
    const rowsToday = rowsOf((await c.json(`/api/attendance?date=${today}`, "MANAGER")).body);
    const hr = rowsToday.find((r) => r.id === hireId);
    t.ok(hr?.flags?.includes("LOOKS_LIKE_STAFF") && hr.staffLike?.some((s) => s.id === P.id), "fix 4: a hire sign-in 'name / Lobos' is flagged, with the staff member suggested");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "VIEWER", { resourceId: P.id, reason: "rc" }), 403, "a Viewer can't move it");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "ACCOUNTS", { resourceId: P.id, reason: "rc move" }), 403, "ACCOUNTS can't move it");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "MANAGER", { resourceId: P.id }), 400, "moving needs a reason");
    t.status(await c.post(`/api/attendance/${hireId}/person`, "MANAGER", { resourceId: P.id, reason: "Release check - signed in as hire, is staff" }), 200, "a Manager moves it onto the staff member");
    const moved = await db.siteAttendance.findUnique({ where: { id: hireId }, include: { edits: true } });
    t.ok(moved?.resourceId === P.id && moved.company === null && moved.edits.some((e) => e.field === "person"), "it's theirs now, and the change is kept");
    await db.timesheetWeek.create({ data: { weekStart: "2020-03-09", approvedBy: "Release check", snapshot: JSON.stringify({ weekStart: "2020-03-09", lines: [] }), totalHours: 0, people: 0 } });
    const lockedHire = await add({ place: "OFFICE", placeLabel: "Office", date: "2020-03-10", workerName: P.name, company: "Lobos", signInAt: aedt("2020-03-10", "07:00"), signOutAt: aedt("2020-03-10", "15:00") });
    t.status(await c.post(`/api/attendance/${lockedHire.id}/person`, "MANAGER", { resourceId: P.id, reason: "Release check" }), 400, "a locked week refuses the move");

    // (9) Payroll files with "$" names (week of 24 Feb 2020): made, and $-free.
    await add({ place: "OFFICE", placeLabel: "Office", date: "2020-02-25", resourceId: G.id, workerName: G.name, signInAt: aedt("2020-02-25", "07:00"), signOutAt: aedt("2020-02-25", "15:30") });
    await add({ place: "OFFICE", placeLabel: "Office", date: "2020-02-25", workerName: "Hire Worker $40", company: "$5 Labour", signInAt: aedt("2020-02-25", "07:00"), signOutAt: aedt("2020-02-25", "15:30") });
    for (const f of ["payrun", "summary"]) {
      const r = await c.text(`/api/accounts/payroll/export?week=2020-02-24&file=${f}`, "ACCOUNTS");
      t.ok(r.status === 200 && noMoney(r.text) && !/\$/.test(r.text), `payroll ${f} file for a week with "$" names: 200 and $-free`, `${r.status} ${r.text.slice(0, 160)}`);
    }
    const sum = (await c.text("/api/accounts/payroll/export?week=2020-02-24&file=summary", "ACCOUNTS")).text;
    t.ok(/Hire Worker/.test(sum) && /Labour/.test(sum), "the hire worker is still in the summary, amounts taken out");
  },
};
