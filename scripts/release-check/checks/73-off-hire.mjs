// Off-hire (Ilies, 5 Nov 2026: "off hire should stop the cost and hire gear ... more automated"). The office taps
// Off-hired with the day it was called off and the supplier's off-hire number: the hire estimate stops on that day,
// the item can't go on (or be moved onto) the board after it, its off-hire request closes with the day for the
// supervisor - except one waiting on the supervisor's answer (noted, left open) or one with the yard (untouched)
// (OH-001). Who may do it (Managers, Admins, the coordinator), the refusals and the items it refuses (OH-004), a
// second off-hire refused and every off-hire / put-back kept in the history (OH-002), a stale form that can't undo
// it, the new fields never settable from a form, and the Status box recording the day by itself.
// WRITES on the test copy: a project, hire items (archived again), three off-hire requests, two jobs (removed again).
import { noMoney } from "../lib/context.mjs";

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdays = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) n++; } return n; };
const NOT_ALLOWED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];

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
    const history = () => db.hireOffHireEvent.findMany({ where: { resourceId: item.id }, orderBy: { at: "asc" } });

    // The supervisor's "Finished" (as the hire check makes it), plus one off-hire request the office asked the
    // supervisor about (NEEDS_INFO) and one with the yard (YARD).
    let number = ((await db.siteRequest.findFirst({ orderBy: { number: "desc" }, select: { number: true } }))?.number ?? 0);
    const mkReq = (status) => db.siteRequest.create({ data: {
      number: ++number, kind: "OFF_HIRE", priority: "HIGH", neededBy: new Date(), projectId: project.id, siteLabel: project.name, status,
      summary: `Call off hire: ${item.name}`, details: JSON.stringify({ item: item.name }), requestedBy: "RC Supervisor", hireResourceId: item.id,
      remindAt: new Date(Date.now() + 86_400_000), remindNote: "rc",
    } });
    const reqA = await mkReq("SENT"), reqQ = await mkReq("NEEDS_INFO"), reqY = await mkReq("YARD");
    await db.resource.update({ where: { id: item.id }, data: { hireStatus: "OFF_HIRE_REQUESTED" } });
    const al = await c.json("/api/hire-alerts", "MANAGER");
    t.ok(al.status === 200 && (al.body?.callOff ?? []).some((x) => x.id === item.id), "the Hire page lists it under 'Finished on site - call these off'", al.status);
    t.ok(noMoney(JSON.stringify(al.body ?? {})), "no dollar figure in the hire alerts");
    const ca = await c.json("/api/hire-alerts", "COORDINATOR");
    t.ok(ca.status === 200 && (ca.body?.callOff ?? []).some((x) => x.id === item.id), "the coordinator sees it too", ca.status);

    // Booked on the board on a later day before the off-hire (jobA); another later day to try after it (jobB).
    const jobA = await db.job.create({ data: { title: project.name, projectId: project.id, date: new Date(`${addDays(c.today, 3)}T00:00:00Z`), shift: "DAY" } });
    const jobB = await db.job.create({ data: { title: project.name, projectId: project.id, date: new Date(`${addDays(c.today, 4)}T00:00:00Z`), shift: "DAY" } });
    const asA = await c.post("/api/assignments", "MANAGER", { jobId: jobA.id, resourceId: item.id });
    const asAId = (await asA.json().catch(() => ({})))?.id;
    t.status(asA, 201, "before the off-hire it can be booked on a later day");

    // Who may off-hire, and the refusals.
    t.status(await c.post(base, null, { date: offDay }), 401, "no login can't off-hire");
    for (const who of NOT_ALLOWED) t.status(await c.post(base, who, { date: offDay }), 403, `${who} can't off-hire`);
    t.status(await c.post(base, "MANAGER", { date: addDays(onHire, -1) }), 400, "a day before it went on hire is refused");
    t.status(await c.post(base, "MANAGER", { date: addDays(c.today, 15) }), 400, "more than two weeks ahead is refused");
    t.status(await c.post(base, "MANAGER", { date: "not a day" }), 400, "no real day is refused");
    t.status(await c.post(base, "MANAGER", { date: offDay, ref: "$450 credit" }), 400, "an amount as the off-hire number is refused");
    t.ok((await db.resource.findUnique({ where: { id: item.id } }))?.offHiredOn == null, "after the refusals nothing is recorded");

    // OH-004: only active hire gear - not a person, our own plant, labour hire or an archived item.
    const person = await db.resource.findFirst({ where: { type: "PERSONNEL", active: true }, select: { id: true } });
    const owned = await db.resource.findFirst({ where: { type: "EQUIPMENT" }, select: { id: true } });
    const labour = await db.resource.create({ data: { type: "HIRE", category: "LABOUR", ownership: "HIRED", name: `RC labour hire ${tag}` } });
    const gone = await db.resource.create({ data: { type: "HIRE", category: "PLANT", ownership: "HIRED", name: `RC archived hire ${tag}`, active: false, hireStatus: "RETURNED" } });
    for (const [what, r] of [["a person", person], ["our own plant", owned], ["labour hire", labour], ["an archived item", gone]]) {
      if (!r) { t.note(`no ${what} on the snapshot - not checked`); continue; }
      const p = await c.post(`/api/resources/${r.id}/off-hire`, "MANAGER", { date: offDay });
      t.ok([400, 404].includes(p.status), `off-hiring ${what} is refused`, p.status);
      const d = await c.del(`/api/resources/${r.id}/off-hire`, "MANAGER");
      t.ok([400, 404].includes(d.status), `'put back on hire' on ${what} is refused`, d.status);
      t.ok((await db.resource.findUnique({ where: { id: r.id } }))?.offHiredOn == null, `${what}: nothing recorded`);
    }
    t.ok((await db.resource.findUnique({ where: { id: gone.id } }))?.hireStatus === "RETURNED", "the archived item wasn't flipped back on hire");

    // The coordinator taps Off-hired.
    const off = await c.post(base, "COORDINATOR", { date: offDay, ref: "RC-OH-1" });
    const offBody = await off.json().catch(() => ({}));
    t.ok(off.status === 200 && offBody.closed === 1 && offBody.later === 1, "the coordinator off-hires it; one request closed; one later booking reported", `${off.status} ${offBody.closed} ${offBody.later}`);
    const row = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(row?.hireStatus === "RETURNED" && row.offHiredOn === offDay && row.offHireRef === "RC-OH-1" && !!row.offHiredBy && !!row.offHiredAt,
      "the item: Off-hired, the day, the number, who and when");
    const rA = await db.siteRequest.findUnique({ where: { id: reqA.id }, include: { events: true } });
    t.ok(rA?.status === "DONE" && /Off-hired/.test(rA.outcome ?? "") && /RC-OH-1/.test(rA.outcome ?? "") && rA.events.some((e) => e.action === "DONE"),
      "the request is done, the supervisor reads the day and number, the history has it");
    t.ok(noMoney(rA?.outcome ?? ""), "no dollar figure in what the supervisor reads");
    const rQ = await db.siteRequest.findUnique({ where: { id: reqQ.id }, include: { events: true } });
    t.ok(rQ?.status === "NEEDS_INFO" && rQ.events.some((e) => e.action === "UPDATE" && /Off-hired/.test(e.note ?? "")), "OH-001: one waiting on the supervisor's answer stays open, with the off-hire noted");
    const rY = await db.siteRequest.findUnique({ where: { id: reqY.id }, include: { events: true } });
    t.ok(rY?.status === "YARD" && rY.events.length === 0, "one with the yard is left untouched");
    let h = await history();
    t.ok(h.length === 1 && h[0].action === "OFF_HIRED" && h[0].day === offDay && h[0].ref === "RC-OH-1" && h[0].via === "BUTTON" && !!h[0].by, "OH-002: the off-hire is in its history");

    // OH-002: a second off-hire is refused - nothing is quietly replaced.
    t.status(await c.post(base, "MANAGER", { date: addDays(offDay, 1), ref: "RC-OH-2" }), 409, "a second off-hire is refused (put it back on hire first)");
    t.ok((await db.resource.findUnique({ where: { id: item.id } }))?.offHireRef === "RC-OH-1", "the first off-hire is kept");

    // The new fields can't be set from a form, by the coordinator or a Manager.
    for (const who of ["COORDINATOR", "MANAGER"]) await c.patch(`/api/resources/${item.id}`, who, { offHiredOn: "2020-01-01", offHireRef: "RC-FORGED", offHiredBy: "Someone" });
    const after = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(after?.offHiredOn === offDay && after.offHireRef === "RC-OH-1" && after.offHiredBy !== "Someone", "a form sending the off-hire fields changes none of them");

    // Tracking: the estimate stops on the call-off day.
    const tr = await c.json("/api/tracking", "MANAGER");
    const hi = (tr.body?.projects ?? []).find((p) => p.id === project.id)?.hireItems?.find((x) => x.id === item.id);
    const want = 100 * weekdays(onHire, offDay);
    t.ok(tr.status === 200 && hi && hi.costToDate === want && hi.costTotal === want, "Tracking: its cost runs to the call-off day and stops", JSON.stringify({ got: hi?.costToDate, total: hi?.costTotal }));
    t.ok(!((await c.json("/api/hire-alerts", "MANAGER")).body?.callOff ?? []).some((x) => x.id === item.id), "it's gone from 'call these off'");

    // The board: it can't be put on, or moved onto, a day after the call-off (OH-005).
    const as = await c.post("/api/assignments", "MANAGER", { jobId: jobB.id, resourceId: item.id });
    const asBody = await as.json().catch(() => ({}));
    t.ok(as.status === 400 && /off-hired/.test(asBody.error ?? ""), "the board refuses it on a later day, saying it's off-hired", as.status);
    if (asAId) t.status(await c.patch(`/api/assignments/${asAId}`, "MANAGER", { jobId: jobB.id }), 400, "OH-005: moving its tile to a later day is refused too");

    // A stale edit form can't put it back on hire; "Put back on hire" does, and is recorded.
    t.status(await c.patch(`/api/resources/${item.id}`, "MANAGER", { hireStatus: "ON_HIRE" }), 400, "a form still showing On hire, saved afterwards, is refused");
    t.ok((await db.resource.findUnique({ where: { id: item.id } }))?.offHiredOn === offDay, "and the off-hire is kept");
    t.status(await c.del(base, null), 401, "no login can't put it back on hire");
    for (const who of NOT_ALLOWED) t.status(await c.del(base, who), 403, `${who} can't put it back on hire`);
    t.status(await c.del(base, "MANAGER"), 200, "a Manager puts it back on hire");
    const back = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(back?.hireStatus === "ON_HIRE" && back.offHiredOn == null && back.offHireRef == null, "back on hire: status and off-hire cleared");
    h = await history();
    t.ok(h.length === 2 && h[1].action === "BACK_ON_HIRE" && h[1].day === offDay && h[1].ref === "RC-OH-1" && !!h[1].by, "OH-002: the put-back is in its history, with the old day, number and who");
    if (asAId) t.status(await c.patch(`/api/assignments/${asAId}`, "MANAGER", { jobId: jobB.id }), 200, "back on hire, the board moves it again");

    // The Status box: Off-hired records the day by itself (today - the expected finish is still ahead).
    await db.assignment.deleteMany({ where: { jobId: { in: [jobA.id, jobB.id] } } });
    t.status(await c.patch(`/api/resources/${item.id}`, "MANAGER", { hireStatus: "RETURNED" }), 200, "Off-hired from the Status box");
    const box = await db.resource.findUnique({ where: { id: item.id } });
    t.ok(box?.hireStatus === "RETURNED" && box.offHiredOn === c.today && !!box.offHiredBy, "it records today as the off-hire day, and who");
    h = await history();
    t.ok(h.length === 3 && h[2].via === "STATUS_BOX" && h[2].day === c.today, "and that's in its history too");

    await db.job.deleteMany({ where: { id: { in: [jobA.id, jobB.id] } } }).catch(() => {});
    await db.resource.update({ where: { id: labour.id }, data: { active: false } });
    await c.del(`/api/resources/${item.id}`, "MANAGER");
  },
};
