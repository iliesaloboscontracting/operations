// PP-005 (Ilies, 3 Nov 2026, option 1): a project's notes are a scratchpad that can carry $ figures, so the
// projects list never sends them to a Viewer - the same as GET /api/projects/[id]. Managers and Admins see them as
// typed; the coordinator sees them with every amount taken out.
// WRITES on the test copy: one project.
import { noMoney } from "../lib/context.mjs";

export default {
  id: "project-notes", title: "Project notes: never sent to a Viewer (PP-005)",
  writes: true,
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const notes = `RC note ${tag} - rate agreed $1,234.50 per day`;
    const p = await db.project.create({ data: { name: `RC notes ${tag}`, status: "ACTIVE", notes } });
    const find = (r) => (Array.isArray(r.body) ? r.body : []).find((x) => x.id === p.id);

    const v = await c.json("/api/projects", "VIEWER");
    const vp = find(v);
    t.ok(v.status === 200 && vp && !("notes" in vp), "GET /api/projects as VIEWER lists the project without its notes", v.status);
    t.ok(!JSON.stringify(v.body ?? []).includes(`RC note ${tag}`), "the note text is nowhere in the Viewer's reply");
    const vo = await c.json(`/api/projects/${p.id}`, "VIEWER");
    t.ok(vo.status === 200 && !("notes" in (vo.body ?? {})), "GET /api/projects/:id as VIEWER has no notes either", vo.status);

    for (const who of ["MANAGER", "ADMIN"]) {
      const r = await c.json("/api/projects", who);
      t.ok(r.status === 200 && find(r)?.notes === notes, `${who} still sees the notes as typed`, r.status);
    }
    const co = await c.json("/api/projects", "COORDINATOR");
    const cp = find(co);
    t.ok(co.status === 200 && typeof cp?.notes === "string" && cp.notes.includes(`RC note ${tag}`) && noMoney(cp.notes),
      "the coordinator still sees the notes, with the amount taken out", co.status);
  },
};
