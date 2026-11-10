// Sign-in flags + the supervisor's "confirm your poster sign-ins" reminder (Ilies, 10 Nov 2026: "do A and B").
// Seeds a 7am-3:30pm job on Mon 23 Mar 2020 (AEDT, far from any live day, so the test server's own minute tick never
// picks it up): two poster sign-ins at 3:05pm still TO_CONFIRM, four crew signed out together at 10:47pm by the
// supervisor, an allocated staff member with no sign-in anywhere, and a night job with a poster sign-in to confirm.
// Then: the flags, notes and summary for a MANAGER (and the week's counts on Timesheets); VIEWER / TIMESHEETS /
// ACCOUNTS see what they saw before; hours unchanged; the reminder run directly (through tsx) with a fake 3:30pm -
// exactly one reminder for the day job, none on a second run, none with the kill switch, the night job only after its
// finish; no money on the link. WRITES on the test copy: a project, two jobs, allocations, a link, sign-ins, reminders.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const D = "2020-03-23", NEXT = "2020-03-24"; // a Monday in AEDT (UTC+11), in a week no other check locks (67 locks 9 Mar 2020)
const aedt = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 11, m)); };
const KEYS = ["toConfirm", "late", "longDay", "noSignIn"];
const diff = (a, b) => Object.fromEntries(KEYS.map((k) => [k, (a?.[k] ?? NaN) - (b?.[k] ?? NaN)]));

export default {
  id: "signin-flags", title: "Sign-in flags (late, long day, together, no sign-in) + the 3:30pm confirm reminder",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/signinFlags.ts") || "needs lib/signinFlags.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    const people = await db.resource.findMany({
      where: { type: "PERSONNEL", active: true, attendances: { none: { date: { in: [D, NEXT] } } }, siteLinks: { none: { kind: "SUPERVISOR", revokedAt: null } } },
      select: { id: true, name: true }, take: 9,
    });
    if (people.length < 9) return t.block("fewer than 9 active Labour-register people without a supervisor link on the snapshot");
    const [S, L1, L2, W1, W2, W3, W4, N, NS] = people;

    // Before: what the day and the week already show (the snapshot may hold something on that day).
    const before = (await c.json(`/api/attendance?date=${D}`, "MANAGER")).body;
    const tsBefore = (await c.json(`/api/timesheets?week=${D}`, "MANAGER")).body;
    if (tsBefore?.approval) return t.block(`the week of ${D} is approved on this copy - Timesheets would show its locked lines`);
    t.ok(before?.summary && KEYS.every((k) => typeof before.summary[k] === "number"), "the Sign-ins answer carries the summary strip's counts", JSON.stringify(before?.summary ?? null));

    // Seed.
    const project = await db.project.create({ data: { name: `RC Flags ${tag}`, status: "ACTIVE", unpaidBreakMinutes: 30 } });
    const job = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${D}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    const night = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${D}T00:00:00.000Z`), shift: "NIGHT", status: "ACTIVE", startTime: "10pm", endTime: "6am" } });
    await db.assignment.create({ data: { jobId: job.id, resourceId: S.id, role: "Supervisor" } });
    for (const r of [L1, L2, W1, W2, W3, W4, N]) await db.assignment.create({ data: { jobId: job.id, resourceId: r.id } });
    await db.assignment.create({ data: { jobId: night.id, resourceId: NS.id, role: "Supervisor" } });
    await makeLink(db, "SUPERVISOR", S.id);
    const sup = await makeLink(db, "SUPERVISOR", NS.id);
    const att = (r, o) => db.siteAttendance.create({ data: { jobId: job.id, date: D, resourceId: r.id, workerName: r.name, allocated: true, status: "CONFIRMED", signInMethod: "SUPERVISOR_QR", ...o } });
    await att(S, { signInAt: aedt(D, "06:55"), signOutAt: aedt(D, "15:30"), signOutMethod: "SUPERVISOR_QR" });
    for (const r of [L1, L2]) await att(r, { signInAt: aedt(D, "15:05"), signOutAt: aedt(D, "15:30"), signInMethod: "POSTER", signOutMethod: "POSTER", status: "TO_CONFIRM" });
    let s = 0;
    for (const r of [W1, W2, W3, W4]) await att(r, { signInAt: aedt(D, "07:00"), signOutAt: new Date(aedt(D, "22:47").getTime() + (s++) * 9_000), signOutMethod: "MANUAL" });
    await db.siteAttendance.create({ data: { jobId: night.id, date: D, resourceId: NS.id, workerName: NS.name, allocated: true, status: "TO_CONFIRM", signInMethod: "POSTER", signInAt: aedt(D, "21:58") } });

    // (1) A MANAGER sees the flags, the words and the summary.
    const res = await c.json(`/api/attendance?date=${D}`, "MANAGER");
    const g = res.body?.jobs?.find((j) => j.id === job.id);
    const rowOf = (r) => g?.rows?.find((x) => x.resourceId === r.id);
    t.ok(res.status === 200 && !!g, "the seeded job is on the Sign-ins page for that day", res.status);
    t.ok([L1, L2].every((r) => rowOf(r)?.flags?.includes("TO_CONFIRM") && rowOf(r)?.flags?.includes("LATE_IN") && rowOf(r)?.notes?.LATE_IN === "Signed in 3:05pm – job starts 7am"),
      "3:05pm poster sign-ins: 'to confirm' + LATE_IN 'Signed in 3:05pm – job starts 7am'", JSON.stringify(rowOf(L1)?.notes ?? null));
    t.ok([W1, W2, W3, W4].every((r) => rowOf(r)?.flags?.includes("LONG_SHIFT") && rowOf(r)?.notes?.LONG_SHIFT === "Signed out 10:47pm – job ends 3:30pm"),
      "10:47pm sign-outs: LONG_SHIFT 'Signed out 10:47pm – job ends 3:30pm'", JSON.stringify(rowOf(W1)?.notes ?? null));
    t.ok([W1, W2, W3, W4].every((r) => rowOf(r)?.flags?.includes("BULK_OUT") && /^4 signed out together at 10:47pm by the supervisor$/.test(rowOf(r)?.notes?.BULK_OUT ?? "")),
      "...noted as 4 signed out together by the supervisor");
    t.ok(!rowOf(S)?.flags?.some((f) => ["LATE_IN", "LONG_SHIFT", "BULK_OUT"].includes(f)), "the supervisor's own 6:55am-3:30pm line has none of them");
    const ns = g?.noShows?.find((x) => x.id === N.id);
    t.ok(ns?.staff === true && ns?.nowhere === true, "the allocated staff member with no sign-in anywhere is marked 'no sign-in anywhere'", JSON.stringify(ns ?? null));
    t.ok(!g?.noShows?.some((x) => [S, L1, L2, W1].some((r) => r.id === x.id)), "people who signed in aren't no-shows");
    t.ok(JSON.stringify(diff(res.body?.summary, before?.summary)) === JSON.stringify({ toConfirm: 3, late: 2, longDay: 4, noSignIn: 1 }),
      "the summary strip: +3 to confirm (2 day + the night one), +2 late, +4 long day, +1 no sign-in", JSON.stringify(diff(res.body?.summary, before?.summary)));
    t.ok(noMoney(JSON.stringify(res.body ?? {})), "no dollar figure in the Sign-ins answer");

    // (2) Hours unchanged by any of it: 7:00-22:47 less the 30 min break = 15.25h; and the same hours on Timesheets.
    t.ok([W1, W2, W3, W4].every((r) => rowOf(r)?.hours === 15.25), "a flagged long day still counts its signed hours (15.25h) - flags never change hours", rowOf(W1)?.hours);
    const ts = await c.json(`/api/timesheets?week=${D}`, "MANAGER");
    const lines = (ts.body?.people ?? []).flatMap((p) => Object.values(p.days ?? {}).flat());
    const mine = g?.rows ?? [];
    const same = mine.filter((r) => r.resourceId).every((r) => { const l = lines.find((x) => x.attendanceId === r.id); return l && l.hours === r.hours; });
    t.ok(ts.status === 200 && same, "every seeded line has the same hours on Timesheets as on Sign-ins", ts.status);
    t.ok(JSON.stringify(diff(ts.body?.signInFlags, tsBefore?.signInFlags)) === JSON.stringify({ toConfirm: 3, late: 2, longDay: 4, noSignIn: 1 }),
      "Timesheets (Manager): the week's counts in the 'need sorting' banner", JSON.stringify(ts.body?.signInFlags ?? null));
    t.ok(ts.body?.issues >= 3, "the approval rule is unchanged: the unconfirmed / open lines still count as issues", ts.body?.issues);

    // (3) Nobody new sees any of it.
    for (const who of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"])
      t.status(await c.get(`/api/attendance?date=${D}`, who), 403, `Sign-ins still refused for ${who}`);
    t.status(await c.get(`/api/attendance?date=${D}`, null), 401, "Sign-ins still refused with no login");
    const tsT = await c.json(`/api/timesheets?week=${D}`, "TIMESHEETS");
    t.ok(tsT.status === 200 && !("signInFlags" in (tsT.body ?? {})) && !/LATE_IN|LONG_SHIFT|BULK_OUT/.test(JSON.stringify(tsT.body ?? {})), "TIMESHEETS: the week as before, no flag counts", tsT.status);
    for (const who of ["VIEWER", "ACCOUNTS"]) t.status(await c.get(`/api/timesheets?week=${D}`, who), 403, `Operations timesheets still refused for ${who}`);
    const acc = await c.json(`/api/accounts/timesheets?week=${D}`, "ACCOUNTS");
    t.ok(acc.status === 200 && !("signInFlags" in (acc.body ?? {})) && !/LATE_IN|LONG_SHIFT|BULK_OUT/.test(JSON.stringify(acc.body ?? {})), "ACCOUNTS' timesheets: as before, no flags", acc.status);
    const co = await c.json(`/api/attendance?date=${D}`, "COORDINATOR");
    t.ok(co.status === 200 && noMoney(JSON.stringify(co.body ?? {})), "the coordinator (views Sign-ins) sees the same flags, no dollar figure", co.status);

    // (4) The reminder, run directly (through tsx) with a fake clock.
    const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (!existsSync(tsxCli)) return t.block("no tsx in the candidate - the reminder can't be run directly");
    const store = "file:///" + path.join(c.p.appDir, "src", "lib", "confirmReminders.ts").split(path.sep).join("/");
    const remind = (atIso, extra = {}) => {
      const script = path.join(c.p.files, `rc77-remind-${tag}-${Math.random().toString(36).slice(2, 8)}.mts`);
      writeFileSync(script, `import { remindUnconfirmedPosters } from ${JSON.stringify(store)};\nconst r = await remindUnconfirmedPosters(new Date(${JSON.stringify(atIso)}));\nconsole.log("RESULT " + JSON.stringify(r));\nprocess.exit(0);\n`);
      const childEnv = { ...process.env, ...env, ...extra };
      if (!("CONFIRM_REMINDER" in extra)) delete childEnv.CONFIRM_REMINDER;
      let out = "";
      try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 120_000 }); } catch (e) { out = String(e?.stdout ?? ""); }
      try { return JSON.parse(out.match(/RESULT (.*)/)?.[1] ?? "null"); } catch { return null; }
    };
    const rows = (jobId) => db.shiftReminder.findMany({ where: { jobId, kind: "CONFIRM_POSTER" } });
    const at330 = aedt(D, "15:31").toISOString();
    t.ok((await rows(job.id)).length === 0, "no reminder before the run");
    const offRun = remind(at330, { CONFIRM_REMINDER: "off" });
    t.ok(offRun && offRun.sent.length === 0 && (await rows(job.id)).length === 0, "CONFIRM_REMINDER=off: nothing sent, nothing recorded", JSON.stringify(offRun));
    const early = remind(aedt(D, "15:29").toISOString());
    t.ok(early && !early.sent.includes(job.id) && (await rows(job.id)).length === 0, "3:29pm: not yet", JSON.stringify(early));
    const first = remind(at330);
    const r1 = await rows(job.id);
    t.ok(first?.sent?.includes(job.id) && r1.length === 1 && r1[0].people === 2, "3:31pm: exactly one reminder recorded for the job (2 waiting)", JSON.stringify({ sent: first?.sent?.length, rows: r1.length, people: r1[0]?.people }));
    t.ok(!first?.sent?.includes(night.id) && (await rows(night.id)).length === 0, "the night job isn't reminded at 3:30pm");
    const second = remind(aedt(D, "15:45").toISOString());
    t.ok(second && second.sent.length === 0 && (await rows(job.id)).length === 1, "a second run records none (once per job per day)", JSON.stringify(second));
    const morning = remind(aedt(NEXT, "06:31").toISOString());
    t.ok(morning?.sent?.includes(night.id) && (await rows(night.id)).length === 1 && !morning.sent.includes(job.id), "the night job (10pm-6am) is reminded 30 min after its finish, the next morning", JSON.stringify(morning));
    t.ok((await db.siteAttendance.count({ where: { jobId: job.id, status: "TO_CONFIRM" } })) === 2, "the reminder changes nothing - the sign-ins are still waiting for the supervisor");

    // (5) The supervisor's link: no money; "Confirm all" on the screen (the same CONFIRM, one at a time).
    const link = await c.json(c.site(sup, "/signin"), null);
    t.ok(link.status === 200 && noMoney(JSON.stringify(link.body ?? {})), "the supervisor's sign-in screen answers with no dollar figure", link.status);
    let src = "";
    try { src = readFileSync(path.join(c.p.appDir, "src", "components", "site", "SignInCrew.tsx"), "utf8"); } catch { /* missing */ }
    t.ok(/Confirm all/.test(src) && /action: "CONFIRM"/.test(src), "the link's sign-in screen has a one-tap 'Confirm all' that sends the ordinary CONFIRM");
  },
};
