// Project pickers (2 Nov 2026, Ilies: "these lists need to include the jobs that are inactive and completed. if the
// completed one is selected then it needs the question to be asked if the job is active or completed").
// The office pickers read lists that include Inactive and Completed projects (the Hire form and the job form read
// /api/projects; in-app purchases read /api/purchases); a site link's purchases picker stays active-only; records
// can be attached to an Inactive or Completed project; "Active again" is the ordinary project PATCH - Manager+ only;
// a new job on a still-Completed project keeps its existing date-check warning.
// WRITES on the test copy: three projects (active / inactive / completed), a hire item (archived again), a job
// (removed again), one purchase request.
import { noMoney } from "../lib/context.mjs";

export default {
  id: "project-pickers", title: "Project pickers: inactive + completed listed, attach allowed, reactivate Manager+ only",
  writes: true,
  applies: (c) => c.hasPath("src/lib/projectPicker.ts") || "the candidate has no shared project picker",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const act = await db.project.create({ data: { name: `RC pick active ${tag}`, status: "ACTIVE" } });
    const ina = await db.project.create({ data: { name: `RC pick inactive ${tag}`, status: "INACTIVE" } });
    const com = await db.project.create({ data: { name: `RC pick completed ${tag}`, status: "COMPLETED" } });
    const ids = (list) => new Map((Array.isArray(list) ? list : []).map((p) => [p.id, p.status]));

    // (1) The list the Hire form and the job form read: every status, with the status, for the office logins.
    for (const who of ["MANAGER", "ADMIN", "COORDINATOR"]) {
      const r = await c.json("/api/projects", who);
      const m = ids(r.body);
      t.ok(r.status === 200 && m.get(act.id) === "ACTIVE" && m.get(ina.id) === "INACTIVE" && m.get(com.id) === "COMPLETED",
        `GET /api/projects as ${who} lists active, inactive and completed projects with their status`, r.status);
    }

    // (2) In-app purchases: every status; a site link's purchases picker stays active-only.
    const pr = await c.json("/api/purchases", "MANAGER");
    const pm = ids(pr.body?.projects);
    t.ok(pr.status === 200 && pm.get(act.id) === "ACTIVE" && pm.get(ina.id) === "INACTIVE" && pm.get(com.id) === "COMPLETED",
      "GET /api/purchases (in-app) lists inactive and completed projects", pr.status);
    t.ok(noMoney(JSON.stringify(pr.body?.projects ?? [])), "no dollar figure in the purchases project list");
    if (c.links.office) {
      const lr = await c.json(c.site(c.links.office, "/purchases"), null);
      const lm = ids(lr.body?.projects);
      t.ok(lr.status === 200 && lm.has(act.id) && !lm.has(ina.id) && !lm.has(com.id), "the OFFICE link's purchases picker stays active-only", lr.status);
    } else t.note("no OFFICE link on the snapshot - the link picker wasn't checked");

    // (3) Attaching records to an Inactive or Completed project is accepted.
    const hr = await c.post("/api/resources", "MANAGER", { type: "HIRE", category: "EQUIPMENT", ownership: "HIRED", name: `RC late hire ${tag}`, agency: "RC Hire", hireStatus: "RETURNED", hireProjectId: com.id });
    const hire = await hr.json().catch(() => ({}));
    t.status(hr, [200, 201], "a hire item can go on a Completed project (a late item for a finished job)");
    const ch = await c.post("/api/resources", "COORDINATOR", { type: "HIRE", category: "EQUIPMENT", ownership: "HIRED", name: `RC coord hire ${tag}`, agency: "RC Hire", hireStatus: "BOOKED", hireProjectId: ina.id });
    const chire = await ch.json().catch(() => ({}));
    t.status(ch, [200, 201], "the coordinator can put a hire item on an Inactive project");
    for (const h of [hire, chire]) if (h?.id) await c.del(`/api/resources/${h.id}`, "MANAGER");
    t.status(await c.post("/api/purchases", "MANAGER", { what: `RC pick purchase ${tag}`, projectId: com.id }), [200, 201], "a purchase request can be for a Completed project");

    // (4) A new job on a still-Completed project: the existing date check warns (unchanged); with a reason it saves.
    const d = new Date(`${c.today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 9); // a day that can't be closed yet
    const date = d.toISOString().slice(0, 10);
    const j1 = await c.post("/api/jobs", "MANAGER", { title: com.name, projectId: com.id, date, shift: "DAY", status: "ACTIVE" });
    const w = await j1.json().catch(() => ({}));
    t.ok(j1.status === 409 && w.code === "DATE_WARNING" && (w.warnings ?? []).some((x) => /marked Completed/.test(x)),
      "a job on a Completed project still gets the 'marked Completed' date check", j1.status);
    const j2 = await c.post("/api/jobs", "MANAGER", { title: com.name, projectId: com.id, date, shift: "DAY", status: "ACTIVE", dateCheckNote: "Release check - late job" });
    const job = await j2.json().catch(() => ({}));
    t.status(j2, [200, 201], "with a reason it saves (Still completed)");
    if (job?.id) await db.job.delete({ where: { id: job.id } }).catch(() => {});

    // (5) "Active again" = PATCH /api/projects/:id { status: "ACTIVE" }: refused below Manager, done by a Manager.
    for (const who of ["VIEWER", "COORDINATOR", "ACCOUNTS", "DIRECTOR", "TIMESHEETS"])
      t.status(await c.patch(`/api/projects/${com.id}`, who, { status: "ACTIVE" }), 403, `${who} can't set a Completed project back to Active`);
    t.status(await c.patch(`/api/projects/${com.id}`, null, { status: "ACTIVE" }), 401, "no login can't either");
    t.ok((await db.project.findUnique({ where: { id: com.id } }))?.status === "COMPLETED", "after the refusals it's still Completed");
    t.status(await c.patch(`/api/projects/${com.id}`, "MANAGER", { status: "ACTIVE" }), 200, "a Manager sets it back to Active");
    t.ok((await db.project.findUnique({ where: { id: com.id } }))?.status === "ACTIVE", "it's Active now");
    const after = ids((await c.json("/api/projects", "MANAGER")).body);
    t.ok(after.get(com.id) === "ACTIVE", "the picker list shows it Active");
  },
};
