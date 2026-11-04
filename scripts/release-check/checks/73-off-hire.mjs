// Off-hire (Ilies, 5 Nov 2026: "off hire should stop the cost and hire gear ... more automated"). The office taps
// Off-hired with the day it was called off and the supplier's off-hire number: the hire estimate stops on that day,
// the item can't go on the board after it, its off-hire request closes with the day for the supervisor. Who may do
// it (Managers, Admins, the coordinator), the refusals, a stale form that can't undo it, "Put back on hire", and the
// Status box recording the day by itself.
// WRITES on the test copy: a project, a hire item (archived again), an off-hire request, a job (removed again).
import { noMoney } from "../lib/context.mjs";

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdays = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) n++; } return n; };

export default {
  id: "off-hire", title: "Off-hire: the cost stops on the call-off day, off the board after it, request closed",
  writes: true,
  applies: (c) => c.hasPath("src/lib/offHire/rules.ts") || "the candidate has no off-hire button",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const tag = Date.now().toString(36);
    const onHire = addDays(c.today, -14);
    const offDay = addDays(c.today, -3);
    const project = await db.project.create({ data: { name: `RC off-hire ${tag}`, status: "ACTIVE" } });
    const add = await c.post("/api/resources", "MANAGER", {
      type: "HIRE", category: "PLANT", ownership: "HIRED", name: `RC off-hire excavator ${tag}`, agency: "RC Hire",
      hireStatus: "ON_HIRE", hireProjectId: project.id, onHireDate: onHire, offHireDate: addDays(c.today, 5), hireRate: 100, hireRateUnit: "DAY",
    });
    const item = await add.json().catch(() => ({}));
    if (!t.status(add, 201, "a Manager adds a hire item for the project") || !item?.id) return;
    const base = `/api/resources/${item.id}/off-hire`;

    // The supervisor's "Finished" (as the hire check makes it): the item waits to be called off, with a request.
    const last = await db.siteRequest.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
    const reqRow = await db.siteRequest.create({ data: {
      number: (last?.number ?? 0) + 1, kind: "OFF_HIRE", priority: "HIGH", neededBy: new Date(), projectId: project.id, siteLabel: project.name,
      summary: `Call off hire: ${item.name}`, details: JSON.stringify({ item: item.name }), requestedBy: "RC Supervisor", hireResourceId: item.id,
      remindAt: new Date(Date.now() + 86_400_000), remindNote: "rc",
    } });
    await db.resource.update({ where: { id: item.id }, data: { hireStatus: "OFF_HIRE_REQUESTED" } });
    const al = await c.json("/api/hire-alerts", "MANAGER");
    t.ok(al.status === 200 && (al.body?.callOff ?? []).some((x) => x.id === item.id), "the Hire page lists it under 'Finished on site - call these off'", al.status);
    t.ok(noMoney(JSON.stringify(al.body ?? {})), "no dollar figure in the hire alerts");
    const ca = await c.json("/api/hire-alerts", "COORDINATOR");
    t.ok(ca.status === 200 && (ca.body?.callOff ?? []).some((x) => x.id === item.id), "the coordinator sees it too", ca.status);

    // Who may off-hire, and the refusals.
    t.status(await c.post(base, null, { date: offDay }), 401, "no login can't off-hire");
    for (const who of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"]) t.status(await c.post(base, who, { date: offDay }), 403, `${who} can't off-hire`);
    t.status(await c.post(base, "MANAGER", { date: addDays(onHire, -1) }), 400, "a day before it went on hire is refused");
    t.status(await c.post(base, "MANAGER", { date: addDays(c.today, 15) }), 400, "more than two weeks ahead is refused");
    t.status(await c.post(base, "MANAGER", { date: "not a day" }), 400, "no real day is refused");
    t.status(await c.post(base, "MANAGER", { date: offDay, ref: "$450 credit" }), 400, "an amount as the off-hire number is refused");
    t.ok((await db.resource.findUnique({ where: { id: item.id } }))?.offHiredOn == null, "after the refusals nothing is recorded");

    // The coordinator taps Off-hired.
    const off = await c.post(base, "COORDINATOR", { date: offDay, ref: "RC-OH-1" });
    const offBody = await off.json().catch(() => ({}));
    t.ok(off.status === 200 && offBody.closed === 1, "the coordinator off-hires it; one request closed", `${off.status} ${offBody.closed}`);
    const row = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(row?.hireStatus === "RETURNED" && row.offHiredOn === offDay && row.offHireRef === "RC-OH-1" && !!row.offHiredBy && !!row.offHiredAt,
      "the item: Off-hired, the day, the number, who and when");
    const req = await db.siteRequest.findUnique({ where: { id: reqRow.id }, include: { events: true } });
    t.ok(req?.status === "DONE" && /Off-hired/.test(req.outcome ?? "") && /RC-OH-1/.test(req.outcome ?? "") && req.events.some((e) => e.action === "DONE"),
      "the request is done, the supervisor reads the day and number, the history has it");
    t.ok(noMoney(req?.outcome ?? ""), "no dollar figure in what the supervisor reads");

    // Tracking: the estimate stops on the call-off day.
    const tr = await c.json("/api/tracking", "MANAGER");
    const h = (tr.body?.projects ?? []).find((p) => p.id === project.id)?.hireItems?.find((x) => x.id === item.id);
    const want = 100 * weekdays(onHire, offDay);
    t.ok(tr.status === 200 && h && h.costToDate === want && h.costTotal === want, "Tracking: its cost runs to the call-off day and stops", JSON.stringify({ got: h?.costToDate, total: h?.costTotal }));
    t.ok(!((await c.json("/api/hire-alerts", "MANAGER")).body?.callOff ?? []).some((x) => x.id === item.id), "it's gone from 'call these off'");

    // The board: it can't go on a day after the call-off.
    const jobDay = addDays(c.today, 3);
    const job = await db.job.create({ data: { title: project.name, projectId: project.id, date: new Date(`${jobDay}T00:00:00Z`), shift: "DAY" } });
    const as = await c.post("/api/assignments", "MANAGER", { jobId: job.id, resourceId: item.id });
    const asBody = await as.json().catch(() => ({}));
    t.ok(as.status === 400 && /off-hired/.test(asBody.error ?? ""), "the board refuses it on a later day, saying it's off-hired", as.status);

    // A stale edit form can't put it back on hire; "Put back on hire" does.
    t.status(await c.patch(`/api/resources/${item.id}`, "MANAGER", { hireStatus: "ON_HIRE" }), 400, "a form still showing On hire, saved afterwards, is refused");
    t.ok((await db.resource.findUnique({ where: { id: item.id } }))?.offHiredOn === offDay, "and the off-hire is kept");
    t.status(await c.del(base, "VIEWER"), 403, "a Viewer can't put it back on hire");
    t.status(await c.del(base, "MANAGER"), 200, "a Manager puts it back on hire");
    const back = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(back?.hireStatus === "ON_HIRE" && back.offHiredOn == null && back.offHireRef == null, "back on hire: status and off-hire cleared");
    const as2 = await c.post("/api/assignments", "MANAGER", { jobId: job.id, resourceId: item.id });
    t.status(as2, 201, "back on hire, the board takes it again");

    // The Status box: Off-hired records the day by itself (today - the expected finish is still ahead).
    await db.assignment.deleteMany({ where: { jobId: job.id } });
    t.status(await c.patch(`/api/resources/${item.id}`, "MANAGER", { hireStatus: "RETURNED" }), 200, "Off-hired from the Status box");
    const box = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(box?.hireStatus === "RETURNED" && box.offHiredOn === c.today && !!box.offHiredBy, "it records today as the off-hire day, and who");

    await db.job.delete({ where: { id: job.id } }).catch(() => {});
    await c.del(`/api/resources/${item.id}`, "MANAGER");
  },
};
