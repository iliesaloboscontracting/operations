// Directors "Claimed (Xero)" (30 Oct 2026, stages 1-3; director-insights-plan/CLAIMED-PLAN.md): the overview and the
// director job page carry claims for director access only; Managers, Accounts and an Admin without the director tick
// are refused; the per-job, other-job, not-tied and not-a-job amounts add up to the company total (asserted, never
// printed); Tracking and the Operations job page never carry claims; nothing calls it margin or profit.
// Read-only.
const near = (a, b) => Math.abs(a - b) < 0.05;

export default {
  id: "directors-claimed", title: "Directors claimed (Xero): director access only, adds up, never on Tracking",
  async run(t, c) {
    const o = await c.json("/api/directors/overview", "DIRECTOR");
    t.status({ status: o.status }, 200, "DIRECTOR: the overview opens");
    t.ok(o.body && "claims" in o.body, "...and carries a claims field (null when no Xero sales are read)");
    for (const who of ["MANAGER", "ACCOUNTS", "ADMIN_PLAIN", "VIEWER", "TIMESHEETS"]) t.status(await c.get("/api/directors/overview", who), [401, 403], `${who}: the overview (and its claims) is refused`);

    const cl = o.body?.claims;
    if (!cl) t.note("no Xero sales on the copy - the adding-up cases didn't run");
    else {
      const jobs = (cl.jobs ?? []).reduce((n, j) => n + j.claimed, 0);
      t.ok(near(jobs + cl.otherJobs + cl.totals.notTied + cl.totals.notAJob, cl.totals.total), "per job + other jobs + not tied + not a job = the company total (not printed)");
      t.ok(near(cl.totals.tied + cl.totals.notTied + cl.totals.notAJob, cl.totals.total), "tied + not tied + not a job = the company total");
      t.ok(near(jobs + cl.otherJobs, cl.totals.tied), "per job + other jobs = tied");
      const months = (cl.months ?? []);
      t.ok(months.length === 15 && months[months.length - 1].partial === true, "15 months, this month so far last", months.length);
      t.ok(cl.jobs.every((j) => j.leftToClaim == null || j.leftToClaim >= 0), "left to claim is never negative (over the contract value is said in words)");
      t.ok(cl.jobs.filter((j) => j.over).every((j) => /Claimed more than the contract value/.test(j.overText ?? "")), "...and says so in words when it's over");
      t.ok(cl.jobs.every((j) => ["HIGH", "MEDIUM", "LOW"].includes(j.confidence)), "every job row has a confidence");
      t.ok(typeof cl.drafts === "number" && typeof cl.notTiedInvoices === "number", "draft and not-tied counts are there");
      t.ok((o.body.dataQuality ?? []).some((d) => d.id === "xeroDrafts") && (o.body.dataQuality ?? []).some((d) => d.id === "xeroNotTied"), "the data-quality list has the Xero rows");
    }
    t.ok(!/margin|profit/i.test(JSON.stringify(cl ?? {})), "the claims payload never says margin or profit");

    // Tracking (Operations) never carries claims - the list and the job page's source.
    const tr = await c.json("/api/tracking", "MANAGER");
    t.status({ status: tr.status }, 200, "Tracking opens as a Manager");
    const trText = JSON.stringify(tr.body ?? {});
    t.ok(!("claims" in (tr.body ?? {})) && !/"claims"\s*:/.test(trText) && !/"leftToClaim"|"lessCost"/.test(trText), "Tracking has no claims field, anywhere");
    const proj = (tr.body?.projects ?? []).find((p) => p.status === "ACTIVE") ?? tr.body?.projects?.[0];
    if (!proj) return t.block("no project in Tracking on the snapshot");

    t.status(await c.get(`/tracking/${proj.id}`, "MANAGER"), 200, "the Operations job page opens as a Manager");
    // JobView shows claims only in director mode - checked in src/lib/insights/claims.test.ts (the page source).
  },
};
