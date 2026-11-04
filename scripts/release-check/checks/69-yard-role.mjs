// The YARD login (Ilies, 4 Nov 2026: a dedicated computer downstairs in the yard, for organising tools and actioning
// yard requests). Lands on /yard (the yard jobs - built separately; its own checks look at them); works the Tools
// register, toolboxes and faults exactly as the coordinator does (add, edit, move, delete, faults, toolbox checks - never
// create / rename / re-supervise / retire a toolbox); its own phone / desktop alerts. Nothing else of Operations, never
// a dollar figure, never director access, and only the owner gives, takes away or creates it.
// WRITES a tool (deleted again), a fault and a plate photo to the copy; creates one YARD login as the owner (switched
// back to VIEWER).
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const YARD_PAGES = ["/yard", "/tools", "/tools/toolboxes", "/tools/faults"];

export default {
  id: "yard-role", title: "Yard login: own screen, tools work like the coordinator, refused everywhere else, no dollar figures",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/lib/yardRole.test.ts") || "needs the YARD role (lib/roles.ts YARD_PAGES, lib/yardRole.test.ts)",
  async run(t, c) {
    const U = c.users, Y = "YARD";
    if (!U.YARD) return t.block("no YARD test login (lib/setup.mjs TEST_ROLES)");
    const src = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
    const seen = []; // every reply body it got - scanned for "$" + digit at the end
    const read = async (pth) => { const r = await c.get(pth, Y); const text = await r.text().catch(() => ""); seen.push([pth, text]); let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body, text }; };
    const send = async (method, pth, body) => { const r = await c.req(method, pth, Y, body); const text = await r.text().catch(() => ""); seen.push([`${method} ${pth}`, text]); let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j }; };

    // (1) Sign-in, home, who it is.
    const s = await c.login(Y);
    t.ok(s.body.home === "/yard", "YARD lands on /yard", JSON.stringify(s.body));
    const me = (await c.json("/api/auth/me", Y)).body;
    const u = me?.user ?? me;
    t.ok(u?.role === Y && u?.directorAccess === false, "me: role YARD, no director access");

    // (2) Its pages load. Pages are client-gated (EXPECTED_NOTES): any other page is sent home to /yard by AppFrame -
    // checked here in the candidate's source, since a fetch can't run the page; the APIs behind them refuse it (3, 5).
    const pages = YARD_PAGES.filter((pg) => pg !== "/yard" || c.hasPath("src/app/yard/page.tsx"));
    if (!pages.includes("/yard")) t.note("no src/app/yard/page.tsx in the candidate (the yard jobs branch) - /yard not loaded");
    for (const pg of pages) {
      const r = await c.text(pg, Y);
      t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${pg}`, r.status);
    }
    const roles = src("src/lib/roles.ts");
    const listed = (roles.match(/export const YARD_PAGES = \[([^\]]*)\]/)?.[1] ?? "").match(/"[^"]+"/g)?.map((x) => x.slice(1, -1)) ?? [];
    t.ok(JSON.stringify(listed) === JSON.stringify(YARD_PAGES), "its pages are exactly /yard, /tools, /tools/toolboxes, /tools/faults (lib/roles.ts YARD_PAGES)", listed.join(", "));
    t.ok(/role === "YARD" \? "\/yard"/.test(roles), "homeFor(YARD) is /yard");
    const frame = src("src/components/AppFrame.tsx");
    t.ok(/yardOnly \? "\/yard"/.test(frame) && /!\(yardOnly && isYardPage\(path\)\)/.test(frame), "AppFrame sends it home from every other page");
    t.ok(/const YARD = \[\s*\{ href: "\/yard", label: "Yard jobs" \},\s*\{ href: "\/tools", label: "Tools" \},\s*\];/.test(src("src/components/TopNav.tsx")), "the nav shows only Yard jobs and Tools");

    // (3) What it may look at: the Tools register, toolboxes, faults, its own alerts.
    for (const pth of ["/api/tools", "/api/toolboxes", "/api/tool-issues"]) t.status(await read(pth), 200, `view ${pth}`);
    const anyTool = await c.db.tool.findFirst({ select: { id: true } });
    if (anyTool) t.status(await read(`/api/tools/${anyTool.id}`), 200, "view one tool with its history and faults");
    const photo = await c.db.toolPhoto.findFirst({ select: { id: true } });
    if (photo) t.ok((await c.get(`/api/tools/photos/${photo.id}`, Y)).status !== 403, "a tool photo is open to it (404 if the file isn't on the copy)");
    t.status(await read("/api/push"), 200, "its own phone / desktop alerts (GET /api/push)");

    // (4) Tools: register, edit, move, fault, delete - yes. Toolboxes: contents and checks only (as the coordinator).
    const ph = await send("POST", "/api/tools/photos", { kind: "PLATE", dataUrl: PNG });
    t.status(ph, 201, "tools: a plate photo is stored");
    if (ph.body?.id) t.ok(![401, 403].includes((await send("POST", "/api/tools/read", { platePhotoId: ph.body.id })).status), "tools: plate reading is open to it (no AI key on the copy, so it can't finish)");
    const tool = await send("POST", "/api/tools", { name: "RC yard grinder", serialNumber: `RC-YARD-${Date.now()}`, condition: "Good", ownership: "OWNED", heldBy: "Yard" });
    t.status(tool, 201, "tools: a new tool is registered");
    const toolId = tool.body?.id;
    const box = await c.db.toolbox.findFirst({ where: { active: true }, select: { id: true, name: true, supervisorId: true, notes: true } });
    if (toolId) {
      // A Manager's note with an amount: the yard never sees the figure, in a read or in a write's reply.
      t.status(await c.patch(`/api/tools/${toolId}`, "MANAGER", { notes: "Repair quote $450 from Hilti" }), 200, "a Manager adds a note with an amount");
      const one = await read(`/api/tools/${toolId}`);
      t.ok(one.status === 200 && !/\$\s?\d/.test(one.body?.notes ?? ""), "tools: it sees the note with the amount taken out", JSON.stringify(one.body?.notes ?? null));
      t.status(await send("PATCH", `/api/tools/${toolId}`, { condition: "Good" }), 200, "tools: edit a tool");
      if (box) {
        t.status(await send("PATCH", `/api/tools/${toolId}`, { toolboxId: box.id, moveReason: "rc yard move in" }), 200, "toolboxes: move a tool in");
        t.status(await send("PATCH", `/api/tools/${toolId}`, { toolboxId: null, moveReason: "rc yard move out" }), 200, "toolboxes: move it back out");
      }
      const issue = await send("POST", `/api/tools/${toolId}/issues`, { description: "rc yard fault" });
      t.status(issue, 201, "faults: report one");
      const issueId = issue.body?.id ?? (await c.db.toolIssue.findFirst({ where: { toolId }, select: { id: true } }))?.id;
      if (issueId) t.status(await send("PATCH", `/api/tool-issues/${issueId}`, { status: "CLOSED", resolution: "rc yard closed" }), 200, "faults: close it");
      t.status(await send("DELETE", `/api/tools/${toolId}`), 200, "tools: delete a tool (as the coordinator may)");
      t.ok(!(await c.db.tool.findUnique({ where: { id: toolId } })), "the tool is gone");
    }
    t.status(await send("POST", "/api/toolboxes", { name: "RC yard box" }), 403, "toolboxes: create refused");
    if (box) {
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { name: "RC yard renamed" }), 403, "toolboxes: rename refused");
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { supervisorId: null }), 403, "toolboxes: change supervisor refused");
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { notes: "rc" }), 403, "toolboxes: notes refused");
      t.status(await send("PATCH", `/api/toolboxes/${box.id}`, { active: false, toolsToYard: true }), 403, "toolboxes: remove / retire refused");
      const still = await c.db.toolbox.findUnique({ where: { id: box.id }, select: { name: true, active: true, supervisorId: true, notes: true } });
      t.ok(still && still.name === box.name && still.active && still.supervisorId === box.supervisorId && still.notes === box.notes, "the toolbox is unchanged");
      t.status(await send("POST", `/api/toolboxes/${box.id}/check`, { photoIds: [] }), 400, "toolboxes: a check by photo reaches its own rules (not refused)");
    } else t.note("no active toolbox on the copy - toolbox refusals not exercised");

    // (5) Nothing else of Operations: the board, Tracking, Hire, purchases, timesheets, sign-ins, chat, documents, the
    // Assistant, Directors, Accounts, Users, site links. (The access matrix sweeps every GET route too.)
    const q = { week: c.lastWeek, date: c.today };
    for (const pth of ["/api/jobs", `/api/calendar?from=${c.lastWeek}&to=${c.today}`, "/api/projects", "/api/tracking", "/api/resources", "/api/resources?type=HIRE",
      "/api/resources?type=PERSONNEL", "/api/hire-alerts", "/api/hire-checks", "/api/purchases", `/api/timesheets?week=${q.week}`, `/api/timesheets/export?week=${q.week}`,
      `/api/attendance?date=${q.date}`, `/api/day-review?date=${q.date}`, "/api/messages", "/api/messages/directory", "/api/documents/status", "/api/directors/overview",
      "/api/accounts/purchases", "/api/accounts/timesheets", "/api/invoice-inbox", "/api/users", "/api/changes", "/api/requests", "/api/site-links", "/api/site-submissions",
      "/api/findings", "/api/compliance/flags"])
      t.status(await c.get(pth, Y), [401, 403], `refused ${pth.split("?")[0]}`);
    t.status(await send("POST", "/api/assistant/chat", { messages: [{ role: "user", content: "hi" }] }), 403, "the Assistant is refused");
    t.status(await send("POST", "/api/jobs", { title: "rc", date: q.date }), 403, "the board: a new job refused");
    t.status(await send("POST", "/api/purchases", { what: "RC yard ladder", why: "rc", qty: "1" }), 403, "purchases: raising one refused");
    t.status(await send("POST", "/api/resources", { type: "HIRE", category: "PLANT", ownership: "HIRED", name: "RC yard hire", agency: "RC Hire" }), 403, "hire: adding refused");
    t.status(await send("POST", "/api/messages", { toUserId: U.MANAGER.id, body: "Release check yard message" }), 403, "messages: it doesn't chat");
    t.status(await send("POST", "/api/timesheets", { week: q.week, action: "approve" }), 403, "timesheets: approve refused");
    t.status(await send("POST", "/api/attendance", { place: "OFFICE", signInAt: `${c.today}T07:00`, reason: "rc", hire: { name: "RC Person", company: "RC Co" } }), 403, "sign-ins: add refused");
    t.status(await send("POST", "/api/push/test"), [200, 502, 503], "its own test alert is allowed (no keys on the copy: 503)");
    t.status(await c.get("/estimating", Y), [401, 403], "Estimating is refused");

    // (6) Users: only the owner gives, takes away or creates YARD; director access never goes with it.
    const newLogin = (who) => c.post("/api/users", who, { name: `RC yard ${who} ${Date.now()}`, email: `rc-yard-${who.toLowerCase()}-${Date.now()}@release-check.test`, role: Y, password: "Release-check-pass-1" });
    t.status(await newLogin("ADMIN_PLAIN"), 403, "a non-owner Admin can't create a YARD login");
    t.status(await c.patch(`/api/users/${U.VIEWER.id}`, "ADMIN_PLAIN", { role: Y }), 403, "a non-owner Admin can't make a login YARD");
    t.status(await c.patch(`/api/users/${U.YARD.id}`, "ADMIN_PLAIN", { role: "VIEWER" }), 403, "a non-owner Admin can't take YARD away");
    t.status(await c.patch(`/api/users/${U.YARD.id}`, "ADMIN_PLAIN", { role: "COORDINATOR" }), 403, "a non-owner Admin can't move YARD to COORDINATOR");
    t.ok((await c.db.user.findUnique({ where: { id: U.VIEWER.id }, select: { role: true } }))?.role === "VIEWER" && (await c.db.user.findUnique({ where: { id: U.YARD.id }, select: { role: true } }))?.role === Y, "both logins are unchanged");
    t.status(await c.get("/api/auth/me", Y), 200, "the YARD session still works (no revocation from refused changes)");
    if (U.OWNER) {
      const made = await newLogin("OWNER");
      t.status(made, 201, "the owner creates a YARD login");
      const madeId = (await made.json().catch(() => ({}))).id;
      if (madeId) {
        t.status(await c.patch(`/api/users/${madeId}`, "OWNER", { directorAccess: true }), 400, "even the owner can't give a YARD login director access");
        t.status(await c.patch(`/api/users/${madeId}`, "OWNER", { role: "VIEWER" }), 200, "the owner takes YARD away");
      }
    } else t.note("no owner login on the copy - the owner's YARD changes aren't exercised");
    t.status(await c.get("/api/tools", "COORDINATOR"), 200, "the coordinator still reaches the Tools register");
    t.status(await c.get("/api/tools", "TIMESHEETS"), 403, "a TIMESHEETS login is still refused Tools");

    // (7) No dollar figure in anything it received.
    const leaks = seen.filter(([, text]) => !noMoney(text)).map(([p]) => p);
    t.ok(leaks.length === 0, `no "$" + digit in any of its ${seen.length} replies`, leaks.join(", "));
  },
};
