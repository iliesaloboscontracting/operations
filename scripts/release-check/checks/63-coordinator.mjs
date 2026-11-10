// The COORDINATOR login (Alex, project coordinator - Ilies "approve phase 1", 2 Nov 2026, and his answers the same day):
// lands on /coordinator; views timesheets, sign-ins, Day Review (+ site logs, daily site report) and the calendar;
// works the Tools register (add, edit, move, delete, faults, toolbox checks - but never creates, renames,
// re-supervises or retires a toolbox) and Hire (add, edit, extend, off-hire - no money in or out, no archiving);
// raises his own purchase requests (never approves); office chat; site & safety documents. Every write he must not
// do is refused, the ones he may do work, and none of his replies carries a "$" + digit.
// WRITES a hire item, a tool (deleted again), a fault, a purchase request and a chat thread to the copy.
import { noMoney } from "../lib/context.mjs";
import { AMOUNT as ACCOUNTS_AMOUNT } from "./52-purchases-s6.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  id: "coordinator", title: "Coordinator login: own screen, view-only areas, tools & hire work, no dollar figures",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/coordinatorHire.ts") || "needs the COORDINATOR role (lib/coordinatorHire.ts)",
  async run(t, c) {
    const U = c.users, C = "COORDINATOR";
    if (!U.COORDINATOR) return t.block("no COORDINATOR test login (lib/setup.mjs TEST_ROLES)");
    const plusDays = (n) => { const d = new Date(c.today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const seen = []; // every reply body he got - scanned for "$" + digit at the end
    const read = async (pth) => { const r = await c.get(pth, C); const text = await r.text().catch(() => ""); seen.push([pth, text]); let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body, text }; };
    const send = async (method, pth, body) => { const r = await c.req(method, pth, C, body); const text = await r.text().catch(() => ""); seen.push([`${method} ${pth}`, text]); let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j }; };

    // (1) Sign-in, home, who he is.
    const s = await c.login(C);
    t.ok(s.body.home === "/coordinator", "COORDINATOR lands on /coordinator", JSON.stringify(s.body));
    const me = (await c.json("/api/auth/me", C)).body;
    const u = me?.user ?? me;
    t.ok(u?.role === C && u?.directorAccess === false, "me: role COORDINATOR, no director access");
    for (const pg of ["/coordinator", "/timesheets", "/attendance", "/day-review", "/calendar", "/tools", "/tools/toolboxes", "/tools/faults", "/hire", "/purchases", "/messages", "/documents"]) {
      const r = await c.text(pg, C);
      t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${pg}`, r.status);
    }

    // (2) What he may look at.
    const q = { week: c.lastWeek, date: c.today };
    for (const pth of [`/api/timesheets?week=${q.week}`, `/api/attendance?date=${q.date}`, `/api/day-review?date=${q.date}`, `/api/day-review/site-logs?date=${q.date}`,
      `/api/day-review/dockets?date=${q.date}`, `/api/calendar?from=${c.lastWeek}&to=${c.today}`, "/api/projects", "/api/resources?type=HIRE", "/api/hire-alerts", "/api/hire-checks",
      "/api/tools", "/api/toolboxes", "/api/tool-issues", "/api/purchases", "/api/messages", "/api/documents/status"]) t.status(await read(pth), 200, `view ${pth.split("?")[0]}`);
    const att = await read(`/api/attendance?date=${q.date}`);
    t.ok(!/"gps/i.test(att.text), "sign-ins carry no GPS position");
    const projects = (await read("/api/projects")).body ?? [];
    t.ok(Array.isArray(projects) && projects.every((p) => !("contractValue" in p) && !("costToDate" in p && p.costToDate != null)), "the project list has no contract value or cost");
    const st = (await read("/api/documents/status")).body;
    t.ok(st && st.canRefresh === false && st.unreadable === undefined, "documents: no Refresh now, no Admin detail");
    t.status(await send("POST", "/api/documents/refresh"), 403, "documents: Refresh now refused");
    const log = await c.db.dailyLog.findFirst({ select: { jobId: true }, orderBy: { date: "desc" } }).catch(() => null);
    if (log) {
      const rep = await read(`/api/daily-report/${log.jobId}`);
      t.status(rep, 200, "the daily site report from Day Review");
    } else t.note("no daily log on the copy - the daily site report read isn't exercised");

    // (3) What he may NOT read: other registers, Tracking, the rest of Operations.
    for (const pth of ["/api/resources?type=PERSONNEL", "/api/resources", "/api/resources?type=HIRE,PERSONNEL", "/api/resources?type=EQUIPMENT", `/api/timesheets/export?week=${q.week}`,
      "/api/tracking", "/api/jobs", "/api/users", "/api/directors/overview", "/api/accounts/purchases", `/api/daily-report?projectId=${projects[0]?.id ?? "x"}`, "/api/changes", "/api/requests"])
      t.status(await c.get(pth, C), 403, `refused ${pth}`);
    t.status(await send("POST", "/api/assistant/chat", { messages: [{ role: "user", content: "hi" }] }), 403, "the Assistant is refused");

    // (4) View-only areas: every write refused.
    t.status(await send("POST", "/api/timesheets", { week: q.week, action: "approve" }), 403, "timesheets: approve refused");
    t.status(await send("POST", "/api/timesheets", { week: q.week, action: "reopen", reason: "rc" }), 403, "timesheets: reopen refused");
    const a = await c.db.siteAttendance.findFirst({ select: { id: true } });
    t.status(await send("POST", "/api/attendance", { place: "OFFICE", signInAt: `${c.today}T07:00`, reason: "rc", hire: { name: "RC Person", company: "RC Co" } }), 403, "sign-ins: add refused");
    if (a) {
      t.status(await send("PATCH", `/api/attendance/${a.id}`, { signInAt: `${c.today}T06:00`, reason: "rc" }), 403, "sign-ins: change a time refused");
      t.status(await send("DELETE", `/api/attendance/${a.id}`, { reason: "rc" }), 403, "sign-ins: delete refused");
    }
    t.status(await send("POST", "/api/attendance/sign-out", { id: a?.id ?? "x" }), 403, "sign-ins: sign out refused");
    t.status(await send("POST", "/api/attendance/poster", { projectId: projects[0]?.id ?? "x" }), 403, "sign-ins: poster refused");
    t.status(await send("POST", "/api/day-review/actual", { jobId: "x", resourceId: "x", actualHours: 8 }), 403, "Day Review: saving hours refused");
    t.status(await send("DELETE", "/api/day-review/actual?jobId=x&resourceId=x"), 403, "Day Review: removing a row refused");
    t.status(await send("POST", "/api/day-close", { date: q.date, action: "close" }), 403, "Day Review: closing the day refused");
    t.status(await send("POST", "/api/jobs", { title: "rc", date: q.date }), 403, "the board: a new job refused");
    if (projects[0]) t.status(await send("PATCH", `/api/projects/${projects[0].id}`, { notes: "rc" }), 403, "a project change refused");

    // (5) Tools: register, edit, move, fault, delete - yes. Toolboxes: contents and checks only.
    const ph = await send("POST", "/api/tools/photos", { kind: "PLATE", dataUrl: PNG });
    t.status(ph, 201, "tools: a plate photo is stored");
    if (ph.body?.id) t.ok(![401, 403].includes((await send("POST", "/api/tools/read", { platePhotoId: ph.body.id })).status), "tools: plate reading is open to him (no AI key on the copy, so it can't finish)");
    const tool = await send("POST", "/api/tools", { name: "RC coordinator drill", serialNumber: `RC-COORD-${Date.now()}`, condition: "Good", ownership: "OWNED", heldBy: "Yard" });
    t.status(tool, 201, "tools: a new tool is registered");
    const toolId = tool.body?.id;
    const box = await c.db.toolbox.findFirst({ where: { active: true }, select: { id: true, name: true, supervisorId: true, notes: true } });
    if (toolId) {
      t.status(await send("PATCH", `/api/tools/${toolId}`, { notes: "checked by rc", condition: "Good" }), 200, "tools: edit a tool");
      // 4 Nov 2026 (the Hire rule on Tools, where the build has it): a note with an amount he only sees stripped is
      // kept when he saves the form, and he can't change it (409).
      if (c.hasPath("src/lib/toolTextWrite.ts")) {
        t.status(await c.patch(`/api/tools/${toolId}`, "MANAGER", { notes: "Repair quote $450 from Hilti" }), 200, "a Manager adds a tool note with an amount");
        const shown = (await read(`/api/tools/${toolId}`)).body?.notes;
        t.status(await send("PATCH", `/api/tools/${toolId}`, { notes: shown, condition: "Good" }), 200, "tools: the note sent back as shown is a normal save");
        t.status(await send("PATCH", `/api/tools/${toolId}`, { notes: "Sent to Hilti" }), 409, "tools: changing a note holding an amount he can't see is refused");
        t.ok((await c.db.tool.findUnique({ where: { id: toolId }, select: { notes: true } }))?.notes === "Repair quote $450 from Hilti", "the Manager's tool note is untouched");
      }
      if (box) {
        t.status(await send("PATCH", `/api/tools/${toolId}`, { toolboxId: box.id, moveReason: "rc move in" }), 200, "toolboxes: move a tool in");
        t.status(await send("PATCH", `/api/tools/${toolId}`, { toolboxId: null, moveReason: "rc move out" }), 200, "toolboxes: move it back out");
      }
      const issue = await send("POST", `/api/tools/${toolId}/issues`, { description: "rc fault" });
      t.status(issue, 201, "faults: report one");
      const issueId = issue.body?.id ?? (await c.db.toolIssue.findFirst({ where: { toolId }, select: { id: true } }))?.id;
      if (issueId) t.status(await send("PATCH", `/api/tool-issues/${issueId}`, { status: "CLOSED", resolution: "rc closed" }), 200, "faults: close it");
      t.status(await send("DELETE", `/api/tools/${toolId}`), 200, "tools: delete (= retire, keep forever) a tool (Ilies: allowed)");
      t.ok(!!(await c.db.tool.findUnique({ where: { id: toolId } }))?.retiredAt, "the tool is retired - kept, off the register (keep forever, 10 Nov 2026)");
    }
    t.status(await send("POST", "/api/toolboxes", { name: "RC coordinator box" }), 403, "toolboxes: create refused");
    if (box) {
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { name: "RC renamed" }), 403, "toolboxes: rename refused");
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { supervisorId: null }), 403, "toolboxes: change supervisor refused");
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { notes: "rc" }), 403, "toolboxes: notes refused");
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { active: false, toolsToYard: true }), 403, "toolboxes: remove / retire refused");
      const still = await c.db.toolbox.findUnique({ where: { id: box.id }, select: { name: true, active: true, supervisorId: true, notes: true } });
      t.ok(still && still.name === box.name && still.active && still.supervisorId === box.supervisorId && still.notes === box.notes, "the toolbox is unchanged");
      t.status(await send("POST", `/api/toolboxes/${box.id}/check`, { photoIds: [] }), 400, "toolboxes: a check by photo reaches its own rules (not refused)");
    } else t.note("no active toolbox on the copy - toolbox refusals not exercised");

    // (6) Hire: add, extend, off-hire - no money in or out, no archiving, no other register.
    const MONEY = ["hireRate", "hireRateUnit", "hireDeliveryCost", "hireCollectionCost", "rate", "dailyRateExGst", "ordinaryRate", "payRateNotes"];
    t.status(await send("POST", "/api/resources", { type: "HIRE", category: "PLANT", ownership: "HIRED", name: "RC rated", hireRate: 450, hireRateUnit: "DAY" }), 400, "hire: adding with a rate refused");
    t.status(await send("POST", "/api/resources", { type: "PERSONNEL", name: "RC person", category: "Labourer" }), 403, "hire: adding to another register refused");
    t.status(await send("POST", "/api/resources", { type: "HIRE", category: "PLANT", ownership: "HIRED", name: "RC note", notes: "$300 delivery" }), 400, "hire: an amount in the notes refused");
    const add = await send("POST", "/api/resources", { type: "HIRE", category: "PLANT", ownership: "HIRED", name: `RC coordinator excavator ${Date.now() % 100000}`, agency: "RC Hire", hireStatus: "BOOKED", onHireDate: c.today, offHireDate: plusDays(5) });
    t.status(add, 201, "hire: a new hire item");
    const hid = add.body?.id;
    t.ok(hid && MONEY.every((f) => !(f in add.body)), "hire: the reply has no money field");
    if (hid) {
      t.status(await send("PATCH", `/api/resources/${hid}`, { offHireDate: plusDays(12), hireStatus: "ON_HIRE" }), 200, "hire: extend it");
      t.status(await c.patch(`/api/resources/${hid}`, "MANAGER", { hireRate: 450, hireRateUnit: "DAY", hireDeliveryCost: 120, notes: "Delivery $120, keys in the box" }), 200, "a Manager adds the rate and a note with an amount");
      for (const [f, v] of [["hireRate", 1], ["hireRate", null], ["hireDeliveryCost", 0], ["rate", "$1/day"], ["hireRateUnit", "WEEK"], ["dailyRateExGst", 1], ["ordinaryRate", 1]])
        t.status(await send("PATCH", `/api/resources/${hid}`, { [f]: v }), 400, `hire: changing ${f} refused`);
      t.status(await send("PATCH", `/api/resources/${hid}`, { active: false }), 403, "hire: archiving by PATCH refused");
      t.status(await send("DELETE", `/api/resources/${hid}`), 403, "hire: archiving (DELETE) refused");
      t.status(await send("PATCH", `/api/resources/${hid}`, { type: "VEHICLE" }), 400, "hire: moving it to another register refused");
      t.status(await send("PATCH", `/api/resources/${hid}`, { notes: "Keys at the gate" }), 409, "hire: a note holding an amount he can't see stays the office's");
      const list = await read("/api/resources?type=HIRE&category=PLANT");
      const row = (list.body ?? []).find((r) => r.id === hid);
      t.ok(row && MONEY.every((f) => !(f in row)) && /amount not recorded/.test(row.notes ?? ""), "hire: he sees it with no rate and the amount taken out of the note", JSON.stringify(row ?? null).slice(0, 200));
      if (row) t.status(await send("PATCH", `/api/resources/${hid}`, { ...row, hireStatus: "RETURNED", offHireDate: c.today }), 200, "hire: off-hire it, sending the whole form back");
      const db = await c.db.resource.findUnique({ where: { id: hid } });
      t.ok(db && db.hireRate === 450 && db.hireDeliveryCost === 120 && db.notes === "Delivery $120, keys in the box" && db.hireStatus === "RETURNED" && db.active,
        "hire: the Manager's rate and note are untouched; status Returned; still active", JSON.stringify({ r: db?.hireRate, s: db?.hireStatus }));
      const other = await c.db.resource.findFirst({ where: { type: "PERSONNEL", active: true }, select: { id: true } });
      if (other) t.status(await send("PATCH", `/api/resources/${other.id}`, { notes: "rc" }), 403, "hire: a Personnel-register entry can't be changed");
      t.status(await c.del(`/api/resources/${hid}`, "MANAGER"), 200, "a Manager archives the test item (clean-up)");
    }

    // (7) Purchases: raise and see his own; never approve.
    const WHAT = `RC coordinator - ladder ${Date.now() % 100000}`;
    t.status(await send("POST", "/api/purchases", { what: WHAT, why: "release check", qty: "1" }), 201, "purchases: he raises one");
    const mine = await read("/api/purchases");
    const pr = (mine.body?.requests ?? []).find((r) => r.what === WHAT);
    // PQ-005: no silent passes - his own request, its quotes and everyone else's list must all be there.
    // Accounts' own amount and note never reach him - not the field names, and not the amount 52-purchases-s6 set.
    t.ok(!/amountExGst|accountsNote/.test(mine.text) && !mine.text.includes(String(ACCOUNTS_AMOUNT)), "purchases: no accounts' amount or note anywhere in his list");
    if (t.ok(!!pr && Array.isArray(pr.quotes), "purchases: he sees his own, with its quotes")) {
      t.status(await send("POST", `/api/directors/purchases/${pr.id}`, { action: "APPROVE", version: pr.version }), 403, "purchases: he can't approve");
      t.status(await send("POST", `/api/accounts/purchases/${pr.id}`, { action: "ORDERED" }), 403, "purchases: he can't mark it ordered");
      // 2 Nov 2026 (Ilies): his own can take another supplier's quote, prices and all, while it's with the approvers.
      t.status(await send("POST", `/api/purchases/${pr.id}`, { action: "ADD_QUOTE", quote: { supplier: "RC Ladders", priceExGst: 289, details: "Includes delivery $25" }, version: pr.version }), 200, "purchases: he adds a supplier's quote to his own");
    }
    // Everyone's requests, read-only (Ilies, 2 Nov 2026) - with their prices, never accounts' own amount or note.
    const others = mine.body?.others;
    if (t.ok(Array.isArray(others) && others.length > 0, "purchases: he sees everyone else's requests (52-purchases-s6 made some)")) {
      t.ok(others.every((r) => r.canEdit === false && Array.isArray(r.quotes)), "purchases: everyone else's requests are read-only for him, with their quotes");
      t.status(await send("POST", `/api/purchases/${others[0].id}`, { action: "EDIT", why: "rc", version: others[0].version }), 404, "purchases: he can't change someone else's");
    }

    // (8) Office chat, same rules as every office login.
    const th = await send("POST", "/api/messages", { toUserId: U.MANAGER.id, body: "Release check coordinator message" });
    t.status(th, 201, "messages: he starts a one-to-one with a Manager");
    t.status(await send("POST", "/api/messages", { toUserId: U.MANAGER.id, body: "his TFN is 123 456 782" }), 400, "messages: a TFN is refused");
    const dir = await read("/api/messages/directory");
    t.ok(dir.status === 200, "messages: the directory");

    // (9) Users: only the owner gives, takes away or creates COORDINATOR (Ilies, 2 Nov 2026: "Only you (the owner)");
    // director access never goes with it; other logins unchanged.
    const newLogin = (who) => c.post("/api/users", who, { name: `RC coordinator ${who} ${Date.now()}`, email: `rc-coord-${who.toLowerCase()}-${Date.now()}@release-check.test`, role: C, password: "Release-check-pass-1" });
    t.status(await newLogin("ADMIN_PLAIN"), 403, "a non-owner Admin can't create a COORDINATOR login");
    t.status(await c.patch(`/api/users/${U.VIEWER.id}`, "ADMIN_PLAIN", { role: C }), 403, "a non-owner Admin can't make a login a COORDINATOR");
    t.status(await c.patch(`/api/users/${U.COORDINATOR.id}`, "ADMIN_PLAIN", { role: "VIEWER" }), 403, "a non-owner Admin can't take COORDINATOR away");
    t.ok((await c.db.user.findUnique({ where: { id: U.VIEWER.id }, select: { role: true } }))?.role === "VIEWER" && (await c.db.user.findUnique({ where: { id: U.COORDINATOR.id }, select: { role: true } }))?.role === C, "both logins are unchanged");
    if (U.OWNER) {
      const made = await newLogin("OWNER");
      t.status(made, 201, "the owner creates a COORDINATOR login");
      const madeId = (await made.json().catch(() => ({}))).id;
      if (madeId) t.status(await c.patch(`/api/users/${madeId}`, "OWNER", { role: "VIEWER" }), 200, "the owner takes COORDINATOR away");
      t.status(await c.patch(`/api/users/${U.COORDINATOR.id}`, "OWNER", { directorAccess: true }), 400, "even the owner can't give a COORDINATOR login director access");
    } else t.note("no owner login on the copy - the owner's COORDINATOR changes aren't exercised");
    t.status(await c.get("/api/hire-alerts", "TIMESHEETS"), 403, "a TIMESHEETS login is still refused Hire");
    t.status(await c.get(`/api/timesheets?week=${q.week}`, "TIMESHEETS"), 200, "a TIMESHEETS login still reviews timesheets");
    if (c.links.office) t.status(await c.get(c.site(c.links.office, "/todo"), null), 200, "an OFFICE link's to-do still works");

    // (10) No dollar figure in anything he received - except office chat, where amounts are allowed for every office
    // login (Ilies, 27 Oct 2026: "DOLLAR VALUES ARE APPROVED WITHIN THE OFFICE CHATS AND MESSAGES"), and purchase
    // requests, whose quotes and prices he sees like a Manager (Ilies, 2 Nov 2026 - unlike Hire's rates, on purpose).
    const scanned = seen.filter(([p]) => !/\/api\/messages|\/api\/purchases/.test(p));
    const leaks = scanned.filter(([, text]) => !noMoney(text)).map(([p]) => p);
    t.ok(leaks.length === 0, `no "$" + digit in any of his ${scanned.length} replies (office chat and purchase requests aside)`, leaks.join(", "));
  },
};
