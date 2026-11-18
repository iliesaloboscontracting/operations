// One list per project (18 Nov 2026, Ilies "approve all" - the project-lists review). Checks, with the app's own rules
// (src/lib/projectLists.ts, loaded through tsx) on the live-data copy: every non-archived project is on exactly one of
// Current / Stand down / Completed and every archived one on Archived; the Completed page lists no project twice; every
// stood-down project with no job that day gets a board placeholder (Mammoth-style future start: "Starts <date>"); a
// status outside ACTIVE | INACTIVE | COMPLETED is refused. Then: completing a project with bookings ahead -> 409
// has-bookings; "stand down" -> INACTIVE, bookings kept; "complete and cancel" -> COMPLETED, bookings cancelled except
// one with a sign-in; a loose job attached to a project; a clash -> merge moves allocations + sign-ins and cancels the
// loose job; a closed day refused; a job never moved between two projects; a cancelled target refused; different
// shifts never merged.
// WRITES on the test copy: projects, jobs, one throwaway Personnel resource, sign-ins and one closed day (re-opened at
// the end); the projects are archived at the end. Nothing is deleted.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const D = (iso) => new Date(`${iso}T00:00:00.000Z`);

export default {
  id: "project-lists", title: "Projects: one list per project, Stand down, completing with bookings, attach / merge loose jobs",
  writes: true, timeoutMs: 180_000,
  applies: (c) => c.hasPath("src/lib/projectLists.ts") || "needs lib/projectLists.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36), today = c.today;
    let L;
    try {
      const { tsImport } = await import("tsx/esm/api");
      L = await tsImport(pathToFileURL(path.join(c.p.appDir, "src", "lib", "projectLists.ts")).href, import.meta.url);
    } catch (e) {
      return t.block(`couldn't load src/lib/projectLists.ts through tsx: ${e?.message ?? e}`);
    }
    const src = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    const made = { projects: [], jobs: [] };
    const project = async (name, data = {}) => { const p = await db.project.create({ data: { name: `RC lists ${name} ${tag}`, ...data } }); made.projects.push(p.id); return p; };
    const job = async (data) => { const j = await db.job.create({ data: { title: data.title ?? `RC lists job ${tag}`, shift: "DAY", status: "ACTIVE", ...data } }); made.jobs.push(j.id); return j; };

    // A completed project with two completed days and an archived Completed one - the lists must hold them right.
    const done = await project("completed", { status: "COMPLETED" });
    await job({ projectId: done.id, date: D(addDays(today, -10)), status: "COMPLETED" });
    await job({ projectId: done.id, date: D(addDays(today, -9)), status: "COMPLETED" });
    const archDone = await project("archived completed", { status: "COMPLETED", archived: true });
    const mammoth = await project("future stand down", { status: "INACTIVE", startDate: addDays(today, 20) });

    // (1) One list per project.
    const live = await c.json(`/api/projects?date=${today}`, "MANAGER");
    const arch = await c.json(`/api/projects?date=${today}&archived=1`, "MANAGER");
    if (live.status !== 200 || arch.status !== 200) return t.block(`/api/projects -> ${live.status} / ${arch.status}`);
    const three = ["CURRENT", "STAND_DOWN", "COMPLETED"];
    const badLive = live.body.filter((p) => three.filter((l) => L.listOf(p) === l).length !== 1);
    t.ok(badLive.length === 0, `every non-archived project (${live.body.length}) is on exactly one of Current / Stand down / Completed`, badLive.map((p) => p.name).join(", "));
    const badArch = arch.body.filter((p) => L.listOf(p) !== "ARCHIVED");
    t.ok(badArch.length === 0 && arch.body.some((p) => p.id === archDone.id), `every archived project (${arch.body.length}) is on Archived, a Completed one included`, badArch.map((p) => p.name).join(", "));
    const odd = await db.project.findMany({ where: { status: { notIn: ["ACTIVE", "INACTIVE", "COMPLETED"] } }, select: { name: true, status: true } });
    t.ok(odd.length === 0, "no stored project status outside ACTIVE | INACTIVE | COMPLETED", odd.map((p) => `${p.name}=${p.status}`).join(", "));
    const pp = src("src/app/projects/page.tsx");
    t.ok(/listOf\(p\)/.test(pp) && pp.includes("STAND_DOWN") && !/\["inactive", "Inactive"\]/.test(pp), "the Projects page tabs use listOf (Current / Stand down / Archived)");

    // (2) The Completed page: one row per project.
    const cj = await c.json("/api/jobs/completed", "MANAGER");
    t.status(cj, 200, "GET /api/jobs/completed");
    t.ok((cj.body ?? []).every((j) => "projectStatus" in j), "completed jobs carry their project's status");
    const page = L.completedPageRows(live.body, cj.body ?? []);
    const ids = page.projects.map((r) => r.project.id);
    t.ok(new Set(ids).size === ids.length, `the Completed page lists no project twice (${ids.length} projects)`);
    t.ok(page.jobs.every((j) => !j.projectId || j.projectStatus !== "COMPLETED"), "a completed project's days aren't listed again as loose days");
    const row = page.projects.find((r) => r.project.id === done.id);
    t.ok(row?.completedDays === 2, "a completed project shows its count of completed days", JSON.stringify(row ?? null));
    t.ok(!ids.includes(archDone.id), "an archived Completed project is on Archived, not the Completed page");
    t.ok(/completedPageRows\(/.test(src("src/app/completed/page.tsx")), "the Completed page uses completedPageRows");

    // (3) The board: every stood-down project with no job that day gets a placeholder; a future start says so.
    const bj = await c.json(`/api/jobs?date=${today}`, "MANAGER");
    t.status(bj, 200, "GET /api/jobs (board)");
    const withJob = new Set((bj.body ?? []).map((j) => j.projectId).filter(Boolean));
    const missing = live.body.filter((p) => L.listOf(p) === "STAND_DOWN" && !withJob.has(p.id) && !L.boardPlaceholder(p, today));
    t.ok(missing.length === 0, "every stood-down project with no job today gets a board placeholder", missing.map((p) => p.name).join(", "));
    const m = live.body.find((p) => p.id === mammoth.id);
    t.ok(L.boardPlaceholder(m, today)?.startsOn === addDays(today, 20), "a stood-down project starting later shows on the board with its start date");
    const realMammoth = live.body.find((p) => p.jobNo === "26_164");
    if (realMammoth) t.ok(!!L.boardPlaceholder(realMammoth, today) || withJob.has(realMammoth.id), "Mammoth (26_164) is on the board's Stand down list");
    t.ok(/boardPlaceholder\(/.test(src("src/components/Board.tsx")), "Board.tsx uses boardPlaceholder");

    // (4) Status on save.
    t.status(await c.post("/api/projects", "MANAGER", { name: `RC lists bad ${tag}`, status: "ON_HOLD" }), 400, "a new project with status ON_HOLD is refused");
    t.status(await c.patch(`/api/projects/${mammoth.id}`, "MANAGER", { status: "STAND_DOWN" }), 400, "PATCH status STAND_DOWN is refused");
    t.status(await c.patch(`/api/projects/${mammoth.id}`, "MANAGER", { status: "INACTIVE" }), 200, "PATCH status INACTIVE is saved");

    // (5) Completing a project with bookings ahead.
    const P = await project("bookings", { status: "ACTIVE" });
    const b1 = await job({ projectId: P.id, date: D(addDays(today, 1)) });
    const b2 = await job({ projectId: P.id, date: D(addDays(today, 2)), shift: "NIGHT" });
    const b3 = await job({ projectId: P.id, date: D(addDays(today, 3)) });
    await db.siteAttendance.create({ data: { jobId: b3.id, date: addDays(today, 3), workerName: `RC Worker ${tag}`, company: "RC Co", signInAt: new Date(), signInMethod: "MANUAL", status: "CONFIRMED" } });
    const ask = await c.patch(`/api/projects/${P.id}`, "MANAGER", { status: "COMPLETED" });
    const askBody = await ask.json().catch(() => null);
    t.ok(ask.status === 409 && askBody?.code === "has-bookings" && askBody?.bookings?.length === 3, "Completed with 3 bookings ahead -> 409 has-bookings with the list", `${ask.status} ${JSON.stringify(askBody)?.slice(0, 160)}`);
    t.ok((await db.project.findUnique({ where: { id: P.id } })).status === "ACTIVE", "...and nothing changed");
    const sd = await c.patch(`/api/projects/${P.id}`, "MANAGER", { status: "COMPLETED", bookings: "STAND_DOWN" });
    t.ok(sd.status === 200 && (await sd.json().catch(() => null))?.status === "INACTIVE", "'Stand down for now' -> the project is INACTIVE", sd.status);
    t.ok((await db.job.count({ where: { id: { in: [b1.id, b2.id, b3.id] }, cancelledAt: null } })) === 3, "...and every booking is kept");
    const cc = await c.patch(`/api/projects/${P.id}`, "MANAGER", { status: "COMPLETED", bookings: "CANCEL_BOOKINGS" });
    const ccBody = await cc.json().catch(() => null);
    t.ok(cc.status === 200 && ccBody?.status === "COMPLETED", "'Complete it and cancel' -> the project is COMPLETED", cc.status);
    const after = await db.job.findMany({ where: { id: { in: [b1.id, b2.id, b3.id] } } });
    const by = Object.fromEntries(after.map((j) => [j.id, j]));
    t.ok(!!by[b1.id].cancelledAt && !!by[b2.id].cancelledAt && by[b1.id].cancelReason === "project completed", "the bookings nobody signed in on are cancelled (kept, reason 'project completed')");
    t.ok(!by[b3.id].cancelledAt && ccBody?.bookings?.kept?.length === 1, "the booking with a sign-in is left and listed back", JSON.stringify(ccBody?.bookings ?? null));
    const flagged = await c.json(`/api/jobs?date=${addDays(today, 3)}`, "MANAGER");
    t.ok((flagged.body ?? []).find((j) => j.id === b3.id)?.projectStatus === "COMPLETED", "the board's job carries projectStatus COMPLETED (the 'Project completed' flag)");
    const quiet = await project("no bookings", { status: "ACTIVE" });
    t.status(await c.patch(`/api/projects/${quiet.id}`, "MANAGER", { status: "COMPLETED" }), 200, "Completed with nothing booked ahead saves straight away");

    // (6) Attach a loose job; a clash merges; the rules around it.
    const person = await db.resource.create({ data: { name: `RC Lists Person ${tag}`, type: "PERSONNEL", active: true } });
    const Q = await project("attach", { status: "ACTIVE" });
    const loose1 = await job({ projectId: null, date: D(addDays(today, 4)), title: `RC loose one ${tag}` });
    const at = await c.patch(`/api/jobs/${loose1.id}`, "MANAGER", { projectId: Q.id });
    t.ok(at.status === 200 && (await db.job.findUnique({ where: { id: loose1.id } })).projectId === Q.id, "a loose job is attached to a project -> 200", at.status);
    t.status(await c.patch(`/api/jobs/${loose1.id}`, "MANAGER", { projectId: P.id }), 400, "a job is never moved from one project to another");
    t.status(await c.patch(`/api/jobs/${loose1.id}`, "VIEWER", { projectId: P.id }), [401, 403], "a Viewer can't attach");

    const qDay = addDays(today, 5);
    const qJob = await job({ projectId: Q.id, date: D(qDay) });
    const loose2 = await job({ projectId: null, date: D(qDay), title: `RC loose two ${tag}` });
    const asg = await db.assignment.create({ data: { jobId: loose2.id, resourceId: person.id } });
    const att = await db.siteAttendance.create({ data: { jobId: loose2.id, date: qDay, resourceId: person.id, workerName: person.name, signInAt: new Date(), signInMethod: "MANUAL", status: "CONFIRMED" } });
    const clash = await c.patch(`/api/jobs/${loose2.id}`, "MANAGER", { projectId: Q.id });
    const clashBody = await clash.json().catch(() => null);
    t.ok(clash.status === 409 && clashBody?.code === "job-clash" && clashBody?.targetJobId === qJob.id && /merge into it/.test(clashBody?.error ?? ""), "a clash -> 409 'already has a day job on <date> - merge into it?'", `${clash.status} ${JSON.stringify(clashBody)}`);
    const night = await job({ projectId: null, date: D(qDay), shift: "NIGHT", title: `RC loose night ${tag}` });
    t.status(await c.post(`/api/jobs/${night.id}/merge-into`, "MANAGER", { targetJobId: qJob.id, reason: "Release check" }), 400, "a night job is never merged into a day job");
    const mg = await c.post(`/api/jobs/${loose2.id}/merge-into`, "MANAGER", { targetJobId: qJob.id, reason: "Release check merge" });
    t.status(mg, 200, "merge into the project's job");
    const [asgAfter, attAfter, l2After, edit] = await Promise.all([
      db.assignment.findUnique({ where: { id: asg.id } }),
      db.siteAttendance.findUnique({ where: { id: att.id } }),
      db.job.findUnique({ where: { id: loose2.id } }),
      db.attendanceEdit.findFirst({ where: { attendanceId: att.id, field: "job" } }),
    ]);
    t.ok(asgAfter?.jobId === qJob.id, "the allocation moved onto the project's job");
    t.ok(attAfter?.jobId === qJob.id && !!edit, "the sign-in moved, with a line in its edit log");
    t.ok(!!l2After?.cancelledAt && l2After?.cancelReason === "Release check merge", "the loose job is cancelled (kept, with the reason)");
    t.ok((await db.recordChange.count({ where: { recordId: loose2.id } })) > 0, "the cancel is in the job's history");

    // A cancelled job in the slot: attach refused with a clear message, merge into it refused.
    const R = await project("cancelled slot", { status: "ACTIVE" });
    const rDay = addDays(today, 6);
    const rJob = await job({ projectId: R.id, date: D(rDay), status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "RC", cancelReason: "Release check" });
    const loose3 = await job({ projectId: null, date: D(rDay), title: `RC loose three ${tag}` });
    const cr = await c.patch(`/api/jobs/${loose3.id}`, "MANAGER", { projectId: R.id });
    t.ok(cr.status === 409 && (await cr.json().catch(() => null))?.code === "job-clash-cancelled", "a cancelled job in that slot refuses the attach (never brought back by a merge)", cr.status);
    t.status(await c.post(`/api/jobs/${loose3.id}/merge-into`, "MANAGER", { targetJobId: rJob.id, reason: "Release check" }), 409, "merging into a cancelled job is refused");

    // A closed day: attach and merge both refused.
    const closedDay = addDays(today, 61);
    const existing = await db.dayClose.findUnique({ where: { date: closedDay } });
    await db.dayClose.upsert({ where: { date: closedDay }, create: { date: closedDay, status: "CLOSED", closedBy: "RC", closedAt: new Date() }, update: { status: "CLOSED" } });
    const cJob = await job({ projectId: Q.id, date: D(closedDay) });
    const loose4 = await job({ projectId: null, date: D(closedDay), title: `RC loose four ${tag}` });
    t.status(await c.patch(`/api/jobs/${loose4.id}`, "MANAGER", { projectId: Q.id }), 409, "attaching on a closed day is refused");
    t.status(await c.post(`/api/jobs/${loose4.id}/merge-into`, "MANAGER", { targetJobId: cJob.id, reason: "Release check" }), 409, "merging on a closed day is refused");
    await db.dayClose.update({ where: { date: closedDay }, data: { status: existing?.status ?? "OPEN" } });

    // Tidy (nothing deleted): the test projects archived, the person switched off.
    await db.project.updateMany({ where: { id: { in: made.projects } }, data: { archived: true } });
    await db.resource.update({ where: { id: person.id }, data: { active: false } });
  },
};
