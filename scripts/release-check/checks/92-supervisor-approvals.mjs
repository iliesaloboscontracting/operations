// Sign-ins and Timesheets show the supervisors' "Approve hours" (18 Nov 2026, Ilies: "B, build it" - Managers and Admins
// see it; not the coordinator, not the review-only logins). Information only: nothing is blocked or changed by it.
// WRITES on the test copy: one HoursApproval for a past job/day, then one office change to a sign-out on it.
import { noMoney } from "../lib/context.mjs";

const weekStartOf = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };

export default {
  id: "supervisor-approvals", title: "Sign-ins / Timesheets: supervisors' hour approvals shown to Managers and Admins only",
  writes: true, timeoutMs: 120_000,
  applies: (c) => c.hasPath("src/lib/payroll/store.ts") || "needs payroll/store.ts",
  async run(t, c) {
    const db = c.db;
    // A past, signed-out, confirmed staff sign-in on a job, in a week that isn't locked (office changes are refused there).
    const locked = new Set((await db.timesheetWeek.findMany({ where: { reopenedAt: null }, select: { weekStart: true } })).map((w) => w.weekStart));
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    const cands = await db.siteAttendance.findMany({
      where: { jobId: { not: null }, resourceId: { not: null }, signOutAt: { not: null }, status: "CONFIRMED", removedAt: null, date: { lt: today }, resource: { type: "PERSONNEL" } },
      orderBy: { signInAt: "desc" }, take: 400, select: { id: true, jobId: true, date: true },
    });
    const pick = cands.find((a) => !locked.has(weekStartOf(a.date)));
    if (!pick) return t.block("no past signed-out staff sign-in in an unlocked week on the snapshot");
    const D = pick.date, J = pick.jobId;

    const before = await c.json(`/api/attendance?date=${D}`, "MANAGER");
    if (before.status !== 200) return t.block(`/api/attendance -> ${before.status}`);
    t.ok(!!before.body?.supervisor, "a Manager gets the supervisor approvals on Sign-ins");
    const job = (before.body?.jobs ?? []).find((j) => j.id === J);
    if (!job) return t.block("the picked job isn't on that day's Sign-ins");
    const rows = job.rows.filter((r) => r.status !== "REJECTED");

    // The supervisor approves the day exactly as it stands (what their link's "Approve hours" saves).
    await db.hoursApproval.create({ data: {
      jobId: J, date: D, siteLinkId: "release-check", approvedBy: "RC Supervisor",
      snapshot: JSON.stringify(rows.map((r) => ({ attendanceId: r.id, name: r.name, company: r.company, in: r.in, out: r.out, hours: r.hours }))),
    } });

    const after = await c.json(`/api/attendance?date=${D}`, "MANAGER");
    const day = after.body?.supervisor?.byJobDay?.[`${J}|${D}`];
    t.ok(day?.by === "RC Supervisor" && day.changed === 0 && day.notIn === 0, "the job's day shows approved by the supervisor, nothing changed since", JSON.stringify(day));
    t.ok(after.body?.supervisor?.byLine?.[pick.id]?.state === "APPROVED", "the line shows approved", JSON.stringify(after.body?.supervisor?.byLine?.[pick.id]));
    t.ok(noMoney(JSON.stringify(after.body?.supervisor ?? {})), "no money in the approvals");
    for (const who of ["OWNER", "ADMIN_PLAIN"]) {
      const r = await c.json(`/api/attendance?date=${D}`, who);
      t.ok(r.status === 200 && !!r.body?.supervisor?.byJobDay?.[`${J}|${D}`], `${who} sees it on Sign-ins`);
    }
    const co = await c.json(`/api/attendance?date=${D}`, "COORDINATOR");
    t.ok(co.status === 200 && co.body?.supervisor === undefined, "the coordinator's Sign-ins carry no approvals (Ilies: B)", co.status);

    const ts = await c.json(`/api/timesheets?week=${D}`, "MANAGER");
    t.ok(ts.status === 200 && ts.body?.supervisor?.[pick.id]?.state === "APPROVED", "a Manager's Timesheets show the line approved", JSON.stringify(ts.body?.supervisor?.[pick.id]));
    for (const who of ["COORDINATOR", "TIMESHEETS"]) {
      const r = await c.json(`/api/timesheets?week=${D}`, who);
      t.ok(r.status === 200 && r.body?.supervisor === undefined, `${who}'s Timesheets carry no approvals`, r.status);
    }
    const acc = await c.json(`/api/accounts/timesheets?week=${D}`, "ACCOUNTS");
    t.ok(acc.status !== 200 || acc.body?.supervisor === undefined, "the accounts timesheet copy is unchanged");

    // An office change after the approval shows as "changed since".
    const a = await db.siteAttendance.findUnique({ where: { id: pick.id }, select: { signOutAt: true } });
    const ch = await c.patch(`/api/attendance/${pick.id}`, "MANAGER", { signOutAt: new Date(a.signOutAt.getTime() + 15 * 60_000).toISOString(), reason: "Release check" });
    t.ok(ch.status === 200, "the office changes the sign-out", ch.status);
    const later = await c.json(`/api/attendance?date=${D}`, "MANAGER");
    t.ok(later.body?.supervisor?.byLine?.[pick.id]?.state === "CHANGED", "the line now shows changed since the supervisor approved", JSON.stringify(later.body?.supervisor?.byLine?.[pick.id]));
    t.ok(later.body?.supervisor?.byJobDay?.[`${J}|${D}`]?.changed === 1, "the job's strip counts 1 changed since");
    const ts2 = await c.json(`/api/timesheets?week=${D}`, "MANAGER");
    t.ok(ts2.body?.supervisor?.[pick.id]?.state === "CHANGED", "Timesheets show it changed too");
  },
};
