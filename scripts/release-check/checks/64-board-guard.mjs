// Allocation guard (2 Nov 2026): who may ask the board check / record a send, the 1 Nov slip asked about ("Monday's
// sheet went out - now you're changing Sunday"), a change after a send is listed, every board change is recorded, no
// dollar figure anywhere. WRITES: one send, one assignment added and removed again, on the test copy.
import { noMoney } from "../lib/context.mjs";

const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default {
  id: "board-guard", title: "Allocation guard: did-you-mean-another-day, sends recorded, changes since a send",
  writes: true,
  applies: (c) => c.hasPath("src/lib/boardGuard/rules.ts") || "the candidate has no allocation guard",
  async run(t, c) {
    const today = c.today, tomorrow = addDays(today, 1);
    for (const [who, want] of [["MANAGER", 200], ["ADMIN", 200], ["VIEWER", 200], ["TIMESHEETS", 403], ["DIRECTOR", 403], ["ACCOUNTS", 403], [null, 401]])
      t.status(await c.get(`/api/board/check?date=${today}&purpose=edit`, who), want, `GET /api/board/check as ${who ?? "no login"}`);
    for (const [who, want] of [["DIRECTOR", 403], ["ACCOUNTS", 403], ["TIMESHEETS", 403], [null, 401]])
      t.status(await c.post("/api/board/sends", who, { date: tomorrow, how: "COPY" }), want, `POST /api/board/sends as ${who ?? "no login"}`);
    t.status(await c.get("/api/board/check?date=junk", "MANAGER"), 400, "a bad date is refused");
    t.status(await c.post("/api/board/sends", "MANAGER", { date: tomorrow, how: "FAX" }), 400, "a bad 'how' is refused");

    // Tomorrow's sheet goes out: recorded, nothing changed since.
    const sr = await c.post("/api/board/sends", "MANAGER", { date: tomorrow, how: "COPY" });
    const sb = await sr.json().catch(() => ({}));
    t.ok(sr.status === 201 && sb.sent && Array.isArray(sb.sent.changes) && sb.sent.changes.length === 0, "a send is recorded with no changes since", `${sr.status} ${JSON.stringify(sb).slice(0, 160)}`);
    // The 1 Nov slip: now changing today (or sending today's sheet) asks "did you mean tomorrow?".
    const ce = (await c.json(`/api/board/check?date=${today}&purpose=edit`, "MANAGER")).body;
    t.ok(ce?.prompt?.reason === "SENT_LATER" && ce.prompt.suggest === tomorrow, "changing today after tomorrow's sheet went out asks 'did you mean tomorrow?'", JSON.stringify(ce?.prompt ?? null));
    const cs = (await c.json(`/api/board/check?date=${today}&purpose=send`, "MANAGER")).body;
    t.ok(cs?.prompt?.suggest === tomorrow, "sending today's sheet after that asks too", JSON.stringify(cs?.prompt ?? null));
    const ct = (await c.json(`/api/board/check?date=${tomorrow}&purpose=edit`, "MANAGER")).body;
    t.ok(ct && ct.prompt === null, "changing tomorrow itself asks nothing", JSON.stringify(ct?.prompt ?? null));

    // A change to tomorrow after the send shows up in "changes since", and the change is recorded.
    const jobs = (await c.json(`/api/jobs?date=${tomorrow}`, "MANAGER")).body;
    const job = Array.isArray(jobs) ? jobs.find((j) => !j.notRunning) : null;
    if (!job) { t.note(`no running job on ${tomorrow} in the snapshot - the change-since part wasn't exercised`); return; }
    const res = (await c.json("/api/resources", "MANAGER")).body;
    const busy = new Set((Array.isArray(jobs) ? jobs : []).flatMap((j) => j.assignments.map((a) => a.resourceId)));
    const free = Array.isArray(res) ? res.find((r) => r.type === "PERSONNEL" && r.role !== "Office" && !busy.has(r.id)) : null;
    if (!free) { t.note("no free person to add on the snapshot - the change-since part wasn't exercised"); return; }
    const ar = await c.post("/api/assignments", "MANAGER", { jobId: job.id, resourceId: free.id });
    const a = await ar.json().catch(() => ({}));
    t.status(ar, 201, "add someone to tomorrow after the send");
    const after = (await c.json(`/api/board/check?date=${tomorrow}&purpose=edit`, "MANAGER")).body;
    t.ok(after?.sent?.changes?.some((l) => l.includes(free.name)), "the board lists the change since the sheet went out", JSON.stringify(after?.sent?.changes ?? null).slice(0, 200));
    t.ok(noMoney(JSON.stringify(after)), "no dollar figure in the check");
    const logged = c.db?.boardEdit ? await c.db.boardEdit.findMany({ where: { date: tomorrow, action: "ASSIGN" }, orderBy: { at: "desc" }, take: 1 }) : null;
    t.ok(!c.db?.boardEdit || (logged?.length === 1 && logged[0].detail?.includes(free.name)), "the change is recorded (who, which day, what)");
    if (a.id) t.status(await c.del(`/api/assignments/${a.id}`, "MANAGER"), 200, "and taken off again");
  },
};
