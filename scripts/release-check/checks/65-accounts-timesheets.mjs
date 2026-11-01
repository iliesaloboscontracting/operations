// Timesheets on the Accounts screen (2 Nov 2026, Ilies: "accounts dash needs access to the time sheets no changes
// just export button for her pay roll" + a one-time "how timesheets work" notice). ACCOUNTS reads and exports the
// week through /api/accounts/timesheets*; every timesheet / sign-in write refuses it; the notice is recorded once,
// server side; Managers and the TIMESHEETS login are unchanged.
// WRITES: one NoticeSeen row for the throwaway ACCOUNTS login on the test copy.
import { noMoney } from "../lib/context.mjs";

const unsafe = (s) => !noMoney(s) || /\b(rate \$|bsb|account number|tfn|tax file|aba)\b/i.test(s); // lib/payroll/rules.ts fileIsSafe

export default {
  id: "accounts-timesheets", title: "Accounts timesheets: view + export only, writes refused, notice once, others unchanged",
  writes: true,
  applies: (c) => c.hasPath("src/app/api/accounts/timesheets/route.ts") || "needs the Accounts timesheets routes",
  async run(t, c) {
    const week = c.lastWeek;

    // (1) ACCOUNTS (and Admins) read the week; Managers, Viewers, TIMESHEETS and no login are refused there.
    const mine = await c.json(`/api/accounts/timesheets?week=${week}`, "ACCOUNTS");
    t.ok(mine.status === 200 && Array.isArray(mine.body?.people) && mine.body?.weekStart === week, "ACCOUNTS reads the week", mine.status);
    t.ok(Array.isArray(mine.body?.explainer?.sections) && mine.body.explainer.sections.length > 0, "the how-it-works text comes with it");
    t.ok(noMoney(JSON.stringify(mine.body ?? {})), "no dollar figure in the accounts timesheet week");
    t.status(await c.get(`/api/accounts/timesheets?week=${week}`, "ADMIN"), 200, "an Admin reads it too");
    for (const [who, want] of [["MANAGER", 403], ["VIEWER", 403], ["TIMESHEETS", 403], ["DIRECTOR", 403], [null, 401]]) {
      t.status(await c.get(`/api/accounts/timesheets?week=${week}`, who), want, `accounts timesheets as ${who ?? "no login"}`);
      t.status(await c.get(`/api/accounts/timesheets/export?week=${week}`, who), want, `accounts timesheet export as ${who ?? "no login"}`);
    }
    const page = await c.text("/accounts/timesheets", "ACCOUNTS");
    t.ok(page.status === 200 && !/Application error/.test(page.text), "page /accounts/timesheets as accounts", page.status);

    // (2) Same hours as the Managers' screen.
    const ops = await c.json(`/api/timesheets?week=${week}`, "MANAGER");
    t.ok(ops.status === 200 && ops.body?.totalHours === mine.body?.totalHours && ops.body?.people?.length === mine.body?.people?.length,
      "same people and total hours as /timesheets", `${ops.body?.people?.length}/${ops.body?.totalHours} vs ${mine.body?.people?.length}/${mine.body?.totalHours}`);
    t.note(`week ${week}: ${mine.body?.people?.length ?? 0} people, ${mine.body?.totalHours ?? 0}h, ${mine.body?.approval ? "locked" : "draft"}`);

    // (3) The export: a CSV, hours only, the same file as the Managers' export.
    const ex = await c.get(`/api/accounts/timesheets/export?week=${week}`, "ACCOUNTS");
    const csv = await ex.text();
    t.ok(ex.status === 200 && /text\/csv/.test(ex.headers.get("content-type") ?? "") && /attachment/.test(ex.headers.get("content-disposition") ?? ""), "ACCOUNTS downloads the CSV", ex.status);
    t.ok(!unsafe(csv), "export passes the payroll file check (no $, BSB, TFN, ABA, rates)");
    t.ok(csv.includes("Employee,Role,Date,Day,Site / place,Sign in,Sign out,Unpaid break (min),Hours,Status,Notes"), "the timesheet export's columns");
    const opsCsv = await (await c.get(`/api/timesheets/export?week=${week}`, "MANAGER")).text();
    t.ok(opsCsv.split("\n").length === csv.split("\n").length, "same rows as the Managers' export", `${opsCsv.split("\n").length} vs ${csv.split("\n").length}`);
    if (opsCsv !== csv) t.note("the accounts export differs from the Managers' (a $ amount was taken out of a note)");

    // (4) Every timesheet / sign-in write refuses ACCOUNTS (the guard runs before any lookup, so made-up ids are fine).
    t.status(await c.post("/api/timesheets", "ACCOUNTS", { week, action: "approve" }), 403, "ACCOUNTS can't approve / lock a week");
    t.status(await c.post("/api/timesheets", "ACCOUNTS", { week, action: "reopen", reason: "release check" }), 403, "ACCOUNTS can't reopen a week");
    t.status(await c.patch("/api/attendance/rc-none", "ACCOUNTS", { signOutAt: new Date().toISOString(), reason: "release check" }), 403, "ACCOUNTS can't change a sign-in");
    t.status(await c.del("/api/attendance/rc-none", "ACCOUNTS", { reason: "release check" }), 403, "ACCOUNTS can't remove a sign-in");
    for (const p of ["/api/attendance", "/api/attendance/poster", "/api/attendance/sign-out"])
      t.status(await c.post(p, "ACCOUNTS", {}), 403, `ACCOUNTS POST ${p}`);
    t.status(await c.get(`/api/timesheets?week=${week}`, "ACCOUNTS"), 403, "the Operations timesheets route still refuses ACCOUNTS");
    t.status(await c.get(`/api/timesheets/export?week=${week}`, "ACCOUNTS"), 403, "the Operations export still refuses ACCOUNTS");
    for (const m of ["post", "put", "patch", "del"])
      t.status(await c[m](`/api/accounts/timesheets?week=${week}`, "ACCOUNTS", {}), 405, `${m.toUpperCase()} /api/accounts/timesheets is not a route`);

    // (5) The notice: unseen for a fresh login, recorded once on "Got it", never changed after.
    t.ok(mine.body?.explainerSeen === false, "a fresh accounts login hasn't seen the notice");
    const g1 = await c.post("/api/accounts/timesheets/explainer", "ACCOUNTS", {});
    const b1 = await g1.json().catch(() => ({}));
    t.ok(g1.status === 200 && b1.seenAt, "Got it is recorded", g1.status);
    const b2 = await (await c.post("/api/accounts/timesheets/explainer", "ACCOUNTS", {})).json().catch(() => ({}));
    t.ok(b2.seenAt === b1.seenAt, "pressing it again changes nothing", `${b1.seenAt} / ${b2.seenAt}`);
    t.ok((await c.json(`/api/accounts/timesheets?week=${week}`, "ACCOUNTS")).body?.explainerSeen === true, "it doesn't come up again");
    t.ok((await c.db.noticeSeen.count({ where: { userId: c.users.ACCOUNTS.id } })) === 1, "one NoticeSeen row for the login");
    for (const who of ["MANAGER", "TIMESHEETS"]) t.status(await c.post("/api/accounts/timesheets/explainer", who, {}), 403, `${who} can't record the accounts notice`);

    // (6) Managers and TIMESHEETS unchanged.
    t.status(await c.get(`/api/timesheets/export?week=${week}`, "MANAGER"), 200, "a Manager still exports");
    t.status(await c.get(`/api/timesheets?week=${week}`, "TIMESHEETS"), 200, "TIMESHEETS still reads /api/timesheets");
    t.status(await c.get(`/api/timesheets/export?week=${week}`, "TIMESHEETS"), 403, "TIMESHEETS still can't export");
    t.status(await c.post("/api/timesheets", "TIMESHEETS", { week, action: "approve" }), 403, "TIMESHEETS still can't approve");
    const tsPage = await c.text("/timesheets", "MANAGER");
    t.ok(tsPage.status === 200 && !/Application error/.test(tsPage.text), "page /timesheets as Manager", tsPage.status);
  },
};
