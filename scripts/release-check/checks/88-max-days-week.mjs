// Days-a-week limit (Ilies, 12 Nov 2026: "for darnell we need a new rule he is only allowed to work 3 days a week and
// no more"). A per-person setting on the Labour register (Resource.maxDaysPerWeek): only an Admin sets it (like
// engagement), Managers see it, VIEWER never does. The board REFUSES a 4th date in a Mon-Sun week (assign, move, a job
// moved to another day) with a plain message - an Admin may go over it with a reason, kept in BoardEdit; copy day skips
// the person and says so. Sign-ins are never refused: the 4th sign-in date is FLAGGED on Sign-ins and Timesheets, the
// Admins get one alert per person per day, approval isn't blocked. No money anywhere; people with no limit unaffected.
// Seeds the weeks of 1 and 8 Jun 2020 (AEST, far from any live day, weeks no other check uses).
// WRITES on the test copy: two people, projects, jobs, allocations, sign-ins, a week approved and reopened again.
import { noMoney } from "../lib/context.mjs";

const SIGN_WEEK = ["2020-06-01", "2020-06-02", "2020-06-03", "2020-06-04"]; // Mon-Thu, sign-ins
const BOARD = { mon: "2020-06-08", tue: "2020-06-09", wed: "2020-06-10", thu: "2020-06-11", fri: "2020-06-12", sat: "2020-06-13", prevSun: "2020-06-07" };
const aest = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 10, m)); };
const at = (date) => new Date(`${date}T00:00:00.000Z`);

export default {
  id: "max-days-week", title: "Days-a-week limit: Admin sets it, the board refuses the extra day (Admin override), copy skips, sign-ins flagged",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/dayLimit/rules.ts") || "needs lib/dayLimit/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const allDays = [...SIGN_WEEK, ...Object.values(BOARD)];
    const busy = await db.job.count({ where: { date: { in: allDays.map(at) }, cancelledAt: null } });
    if (busy) return t.block(`the snapshot already has ${busy} job(s) in the weeks of 1 / 8 Jun 2020`);
    if (await db.timesheetWeek.findFirst({ where: { weekStart: SIGN_WEEK[0], reopenedAt: null } })) return t.block("the week of 1 Jun 2020 is approved on this copy");

    // Seed: Darnell (limit to be set) and Una (no limit), two projects, jobs Mon-Thu (+ a night shift and a second
    // site on Wed), and the sign-in jobs of the week before.
    const mk = (name) => db.resource.create({ data: { name, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE" } });
    const D = await mk(`RC Darnell ${tag}`), U = await mk(`RC Una ${tag}`);
    const P = await db.project.create({ data: { name: `RC Limit ${tag}`, status: "ACTIVE" } });
    const Q = await db.project.create({ data: { name: `RC Limit B ${tag}`, status: "ACTIVE" } });
    const X = await db.project.create({ data: { name: `RC Limit X ${tag}`, status: "ACTIVE" } });
    const job = (p, date, shift = "DAY") => db.job.create({ data: { projectId: p.id, title: p.name, date: at(date), shift, status: "ACTIVE", startTime: shift === "DAY" ? "7am" : "10pm", endTime: shift === "DAY" ? "3:30pm" : "6am" } });
    const J = { mon: await job(P, BOARD.mon), tue: await job(P, BOARD.tue), wed: await job(P, BOARD.wed), wedNight: await job(P, BOARD.wed, "NIGHT"), wedB: await job(Q, BOARD.wed), thu: await job(P, BOARD.thu), fri: await job(Q, BOARD.fri) };

    // (1) Who may set it. A Manager is refused; an Admin sets it; the history keeps it; a bad value is refused.
    t.status(await c.patch(`/api/resources/${D.id}`, "MANAGER", { maxDaysPerWeek: 3 }), 403, "a Manager setting a days-a-week limit");
    t.status(await c.post("/api/resources", "MANAGER", { name: `RC New ${tag}`, type: "PERSONNEL", maxDaysPerWeek: 3 }), 403, "a Manager adding someone with a limit");
    t.status(await c.patch(`/api/resources/${D.id}`, "ADMIN", { maxDaysPerWeek: "9" }), 400, "an Admin setting 9 days a week (not 1-6)");
    const set = await c.patch(`/api/resources/${D.id}`, "ADMIN", { maxDaysPerWeek: "3" });
    t.status(set, 200, "an Admin sets Darnell's limit to 3");
    t.ok((await db.resource.findUnique({ where: { id: D.id } })).maxDaysPerWeek === 3, "the limit is saved as 3");
    const rc = await db.recordChange.findMany({ where: { model: "Resource", recordId: D.id, field: "maxDaysPerWeek" } });
    t.ok(rc.length === 1 && rc[0].after?.includes("3"), "the change is kept in the record's history (RecordChange)", JSON.stringify(rc.map((r) => [r.before, r.after])));
    // The Labour form sends the whole record back: a Manager saving Darnell with the limit unchanged is fine.
    t.status(await c.patch(`/api/resources/${D.id}`, "MANAGER", { name: D.name, maxDaysPerWeek: 3, notes: "RC resave" }), 200, "a Manager re-saving him with the limit unchanged");
    t.status(await c.patch(`/api/resources/${D.id}`, "MANAGER", { maxDaysPerWeek: null }), 403, "a Manager clearing the limit");
    // Who sees it: Managers / Admins on the register, the board and the history; VIEWER never.
    const reg = async (who) => (await c.json("/api/resources?type=PERSONNEL", who)).body?.find?.((r) => r.id === D.id);
    t.ok((await reg("MANAGER"))?.maxDaysPerWeek === 3, "a Manager sees the limit on the register");
    const vr = await reg("VIEWER");
    t.ok(vr && !("maxDaysPerWeek" in vr), "VIEWER never gets the limit on the register", JSON.stringify(vr ?? null).slice(0, 160));
    const hv = (await c.json(`/api/history?model=Resource&id=${D.id}`, "VIEWER")).body;
    t.ok(Array.isArray(hv?.changes) && !hv.changes.some((x) => x.field === "maxDaysPerWeek"), "VIEWER's history leaves the limit out", JSON.stringify(hv).slice(0, 160));
    const hm = (await c.json(`/api/history?model=Resource&id=${D.id}`, "MANAGER")).body;
    t.ok(hm?.changes?.some((x) => x.field === "maxDaysPerWeek"), "a Manager's history shows it");

    // (2) The board. Mon, Tue, Wed (+ a night shift and a second site the same Wed) are fine; Thu is refused.
    const assign = (who, j, r, extra = {}) => c.post("/api/assignments", who, { jobId: j.id, resourceId: r.id, ...extra });
    for (const k of ["mon", "tue", "wed"]) t.status(await assign("MANAGER", J[k], D), 201, `a Manager puts Darnell on ${k}`);
    t.status(await assign("MANAGER", J.wedNight, D), 201, "a second job (night shift) the same Wednesday is never refused");
    const want = `${D.name} is limited to 3 days a week – already on Mon 8, Tue 9, Wed 10.`;
    const r4 = await assign("MANAGER", J.thu, D);
    const b4 = await r4.json().catch(() => ({}));
    t.status(r4, 409, "a Manager putting Darnell on a 4th date (Thu)");
    t.ok(b4.error === want && b4.code === "DAY_LIMIT" && b4.canOverride === false, "the refusal says it plainly (no override for a Manager)", JSON.stringify(b4));
    t.ok(noMoney(JSON.stringify(b4)), "no dollar figure in the refusal");
    t.status(await assign("MANAGER", J.thu, D, { overrideReason: "RC manager tries" }), 403, "a Manager can't override it");
    t.ok(!(await db.assignment.findFirst({ where: { jobId: J.thu.id, resourceId: D.id } })), "nothing was put on Thursday");
    // People with no limit are unaffected.
    for (const k of ["mon", "tue", "wed", "thu"]) t.status(await assign("MANAGER", J[k], U), 201, `Una (no limit) on ${k}`);

    // Moves: within the same date fine; across dates as long as the count stays in; onto a new 4th date refused.
    const aOf = (j, r) => db.assignment.findFirst({ where: { jobId: j.id, resourceId: r.id } });
    const night = await aOf(J.wedNight, D);
    t.status(await c.patch(`/api/assignments/${night.id}`, "MANAGER", { jobId: J.wedB.id }), 200, "moving Darnell between jobs on the same Wednesday");
    const mon = await aOf(J.mon, D);
    t.status(await c.patch(`/api/assignments/${mon.id}`, "MANAGER", { jobId: J.thu.id }), 200, "moving his Monday to Thursday (still 3 days)");
    t.status(await c.patch(`/api/assignments/${mon.id}`, "MANAGER", { jobId: J.mon.id }), 200, "and back to Monday");
    const wed = await aOf(J.wed, D);
    const mv = await c.patch(`/api/assignments/${wed.id}`, "MANAGER", { jobId: J.fri.id });
    const mvb = await mv.json().catch(() => ({}));
    t.ok(mv.status === 409 && mvb.code === "DAY_LIMIT", "moving one of two Wednesday jobs onto Friday (a 4th date) is refused", `${mv.status} ${JSON.stringify(mvb)}`);

    // (3) Admin override: no reason -> asked (409, may override); blank reason -> 400; a reason -> allowed and recorded.
    const ra = await assign("ADMIN", J.thu, D);
    const rab = await ra.json().catch(() => ({}));
    t.ok(ra.status === 409 && rab.canOverride === true && rab.error === want, "an Admin is told too, and may go over it", `${ra.status} ${JSON.stringify(rab)}`);
    t.status(await assign("ADMIN", J.thu, D, { overrideReason: "  " }), 400, "an Admin override with no reason");
    t.status(await assign("ADMIN", J.thu, D, { overrideReason: "RC short-staffed" }), 201, "an Admin override with a reason");
    const ov = await db.boardEdit.findMany({ where: { date: BOARD.thu, action: "LIMIT_OVERRIDE" } });
    t.ok(ov.length === 1 && ov[0].detail === `${D.name}: 4th day Thu 11 (limit 3 d/wk) – reason: RC short-staffed` && ov[0].userId === c.users.ADMIN.id,
      "the override is recorded in the board history with the reason and who", JSON.stringify(ov.map((o) => o.detail)));

    // (4) Copy day Thu -> Fri: Darnell (now on 4 days) is left off and reported; Una is copied.
    const cp = await c.post("/api/jobs/copy", "MANAGER", { from: BOARD.thu, to: BOARD.fri });
    const cpb = await cp.json().catch(() => ({}));
    t.status(cp, 200, "copy Thursday to Friday");
    t.ok(Array.isArray(cpb.dayLimit) && cpb.dayLimit.includes(`${D.name} not copied to Fri 12 – 3-day limit`), "the copy reports who was left off and why", JSON.stringify(cpb.dayLimit ?? null));
    const friCrew = await db.assignment.findMany({ where: { job: { date: at(BOARD.fri), projectId: P.id } }, select: { resourceId: true } });
    t.ok(friCrew.some((a) => a.resourceId === U.id) && !friCrew.some((a) => a.resourceId === D.id), "Friday's copied job has Una, not Darnell", JSON.stringify(friCrew));
    t.ok(noMoney(JSON.stringify(cpb)), "no dollar figure in the copy reply");

    // (5) A job moved to another day carries its crew: refused for the person it would take over the limit.
    const jx = await job(X, BOARD.prevSun);
    await db.assignment.create({ data: { jobId: jx.id, resourceId: D.id } });
    await db.assignment.create({ data: { jobId: jx.id, resourceId: U.id } });
    const jm = await c.patch(`/api/jobs/${jx.id}`, "MANAGER", { date: BOARD.sat, dateCheckNote: "RC" });
    const jmb = await jm.json().catch(() => ({}));
    t.ok(jm.status === 409 && jmb.code === "DAY_LIMIT" && jmb.error?.startsWith(`${D.name} is limited to 3 days a week`) && !jmb.error.includes(U.name), "moving a job onto a 5th date for Darnell is refused (Una isn't mentioned)", `${jm.status} ${JSON.stringify(jmb)}`);
    t.ok(iso((await db.job.findUnique({ where: { id: jx.id } })).date) === BOARD.prevSun, "the job stayed on its day");

    // The board's data: Managers see the limit on the chip, VIEWER doesn't.
    const chip = async (who) => (await c.json(`/api/jobs?date=${BOARD.mon}`, who)).body?.find?.((j) => j.id === J.mon.id)?.assignments?.find((a) => a.resourceId === D.id)?.resource;
    t.ok((await chip("MANAGER"))?.maxDaysPerWeek === 3, "the board's chip carries the limit for a Manager (the \"3 d/wk\" tag)");
    const vc = await chip("VIEWER");
    t.ok(vc && !("maxDaysPerWeek" in vc), "the board's chip has no limit for VIEWER");

    // (6) Sign-ins: never refused. Darnell signs in Mon-Thu of the week before (the office adds them, as on Sign-ins);
    // Thursday is the 4th date -> flagged, one Admin alert even with a second sign-in that day; Una nothing.
    const sj = {};
    for (const d of SIGN_WEEK) sj[d] = await job(P, d);
    const signIn = (r, d, from, to) => c.post("/api/attendance", "MANAGER", { jobId: sj[d].id, resourceId: r.id, signInAt: aest(d, from).toISOString(), signOutAt: aest(d, to).toISOString(), reason: "RC limit" });
    for (const d of SIGN_WEEK.slice(0, 3)) t.status(await signIn(D, d, "07:00", "15:30"), 201, `Darnell signs in ${d}`);
    t.status(await signIn(D, SIGN_WEEK[3], "07:00", "11:00"), 201, "Darnell signs in on a 4th day - allowed");
    t.status(await signIn(D, SIGN_WEEK[3], "12:00", "15:30"), 201, "a second sign-in that day - allowed");
    for (const d of SIGN_WEEK) t.status(await signIn(U, d, "07:00", "15:30"), 201, `Una signs in ${d}`);
    const alerts = await db.shiftReminder.findMany({ where: { kind: "OVER_DAY_LIMIT", jobId: { in: [D.id, U.id].flatMap((id) => SIGN_WEEK.map((d) => `${id}|${d}`)) } } });
    t.ok(alerts.length === 1 && alerts[0].jobId === `${D.id}|${SIGN_WEEK[3]}`, "exactly one Admin alert: Darnell, Thursday", JSON.stringify(alerts.map((a) => a.jobId)));
    const hrs = await db.siteAttendance.findMany({ where: { resourceId: D.id, date: SIGN_WEEK[3] }, select: { signInAt: true, signOutAt: true, status: true } });
    t.ok(hrs.length === 2 && hrs.every((h) => h.status === "CONFIRMED" && h.signOutAt), "both Thursday sign-ins are kept as entered", JSON.stringify(hrs));

    const day = async (d, who = "MANAGER") => (await c.json(`/api/attendance?date=${d}`, who)).body;
    const rowsOf = (v, r) => (v?.jobs ?? []).flatMap((g) => g.rows).filter((x) => x.resourceId === r.id);
    const thu = await day(SIGN_WEEK[3]);
    const dThu = rowsOf(thu, D);
    t.ok(dThu.length === 2 && dThu.every((r) => r.flags.includes("OVER_DAY_LIMIT") && r.notes?.OVER_DAY_LIMIT === "Over 3-day limit (4th day this week)"), "Sign-ins flags Thursday: \"Over 3-day limit (4th day this week)\"", JSON.stringify(dThu.map((r) => [r.flags, r.notes])));
    t.ok(dThu.every((r) => typeof r.hours === "number" && r.hours > 0), "the hours are there as usual", JSON.stringify(dThu.map((r) => r.hours)));
    t.ok(rowsOf(thu, U).every((r) => !r.flags.includes("OVER_DAY_LIMIT")), "Una (no limit) isn't flagged");
    t.ok(rowsOf(await day(SIGN_WEEK[2]), D).every((r) => !r.flags.includes("OVER_DAY_LIMIT")), "Darnell's 3rd day isn't flagged");
    t.ok(noMoney(JSON.stringify(thu)), "no dollar figure on Sign-ins");

    const ts = (await c.json(`/api/timesheets?week=${SIGN_WEEK[0]}`, "MANAGER")).body;
    const tp = ts?.people?.find((p) => p.resourceId === D.id);
    t.ok(tp?.days?.[SIGN_WEEK[3]]?.length === 2 && tp.days[SIGN_WEEK[3]].every((l) => l.flagNotes?.includes("Over 3-day limit (4th day this week)")), "Timesheets shows it on Thursday's lines", JSON.stringify(tp?.days?.[SIGN_WEEK[3]]?.map((l) => l.flagNotes) ?? null));
    t.ok(SIGN_WEEK.slice(0, 3).every((d) => (tp?.days?.[d] ?? []).every((l) => !l.flagNotes?.length)), "and not on his first three days");
    t.ok((ts?.people?.find((p) => p.resourceId === U.id)?.days?.[SIGN_WEEK[3]] ?? []).every((l) => !l.flagNotes?.length), "Una's timesheet has no note");
    t.ok(noMoney(JSON.stringify(ts)), "no dollar figure on Timesheets");
    // Information only: approving the week isn't blocked (then reopened, so the copy is left as it was).
    const ap = await c.post("/api/timesheets", "MANAGER", { week: SIGN_WEEK[0], action: "approve" });
    const apb = await ap.json().catch(() => ({}));
    t.ok(ap.status === 200 || !(apb.error ?? "").includes(D.name), "the flag never blocks approving the week", `${ap.status} ${JSON.stringify(apb)}`);
    if (ap.status === 200) {
      const exp = await c.text(`/api/timesheets/export?week=${SIGN_WEEK[0]}`, "MANAGER");
      t.ok(exp.status === 200 && !exp.text.includes("3-day limit"), "the approved export is unchanged (no limit note)", `${exp.status}`);
      t.status(await c.post("/api/timesheets", "ADMIN", { week: SIGN_WEEK[0], action: "reopen", reason: "RC limit check - put back" }), 200, "the week reopened again");
    } else t.note(`the week of ${SIGN_WEEK[0]} couldn't be approved on this copy for another reason: ${apb.error ?? ap.status}`);
  },
};

function iso(d) { return d.toISOString().slice(0, 10); }
