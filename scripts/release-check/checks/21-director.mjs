// DIRECTOR logins (was dirtest.mjs): their screen works and matches Tracking; writes and Estimating refused; only
// the owner hands out DIRECTOR; the other one-page roles land where they should.
export default {
  id: "director-wall", title: "Director logins: own screen only, figures = Tracking, owner-only role changes",
  async run(t, c) {
    const tr = await c.json("/api/tracking", "MANAGER");
    t.status(tr.status, 200, "Tracking as Manager");
    const proj = (tr.body?.projects ?? []).find((x) => x.status === "ACTIVE") ?? tr.body?.projects?.[0];
    if (!proj) return t.block("no projects in Tracking on the snapshot");
    const s = await c.login("DIRECTOR");
    t.ok(s.body.home === "/directors", "DIRECTOR lands on /directors", JSON.stringify(s.body));
    const me = (await c.json("/api/auth/me", "DIRECTOR")).body;
    const u = me?.user ?? me;
    t.ok(u?.role === "DIRECTOR" && u?.directorAccess === true, "me: role DIRECTOR with director access");
    t.status(await c.get("/api/directors/overview", "DIRECTOR"), 200, "Directors overview");
    const job = await c.json(`/api/directors/jobs/${proj.id}`, "DIRECTOR");
    const jp = job.body?.project;
    t.ok(job.status === 200 && jp && jp.totalCost === proj.totalCost && jp.forecastCost === proj.forecastCost && jp.invoicedTotal === proj.invoicedTotal,
      "director job page figures = Tracking (same numbers, not printed)", job.status);
    t.ok(!JSON.stringify(jp?.labour ?? []).match(/"cost":\s*[1-9]/), "no per-person pay on the director job page");
    t.status(await c.get("/api/directors/jobs/nope", "DIRECTOR"), 404, "unknown job");
    t.status(await c.get("/estimating", "DIRECTOR"), 403, "Estimating refused to a Director");
    for (const pg of ["/directors", "/directors/kpis", `/directors/jobs/${proj.id}`]) t.status(await c.get(pg, "DIRECTOR"), 200, `page ${pg.replace(proj.id, ":id")}`);
    t.status(await c.patch(`/api/projects/${proj.id}`, "DIRECTOR", { notes: "release-check" }), 403, "a Director can't change a project");

    // Only the owner hands out / takes away DIRECTOR (the test Admins are not the owner).
    const viewer = c.users.VIEWER;
    t.status(await c.patch(`/api/users/${viewer.id}`, "ADMIN", { role: "DIRECTOR" }), 403, "non-owner Admin can't make a Director");
    t.status(await c.post("/api/users", "ADMIN", { name: "D", email: `rc-d-${Date.now()}@release-check.test`, role: "DIRECTOR", password: "longenough-123" }), 403, "non-owner Admin can't create a Director");
    t.status(await c.patch(`/api/users/${c.users.DIRECTOR.id}`, "ADMIN", { role: "VIEWER" }), 403, "non-owner Admin can't take Director away");
    t.status(await c.get("/api/tracking", "ADMIN_PLAIN"), 200, "Admin still sees Tracking");
    t.status(await c.get("/api/directors/overview", "ADMIN_PLAIN"), 403, "un-ticked Admin can't see Directors");
    t.ok((await c.login("ACCOUNTS")).body.home === "/accounts", "ACCOUNTS lands on /accounts");
    t.status(await c.get("/api/directors/overview", "ACCOUNTS"), 403, "Accounts can't see Directors");
    t.ok((await c.login("TIMESHEETS")).body.home === "/timesheets", "TIMESHEETS lands on /timesheets");
    t.status(await c.get("/api/tracking", "TIMESHEETS"), 403, "Timesheets can't see Tracking");
  },
};
