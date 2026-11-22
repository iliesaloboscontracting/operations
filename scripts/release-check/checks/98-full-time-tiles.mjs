// Full-time tiles (Ilies, 22 Nov 2026: "all full times have a orange box. this allows me to easily identify who to
// prioritize when we dont have works"). Resource.fullTime: a tick on the Labour register that only a Manager or an
// Admin sets (server-checked), kept in the record's history; the board's data carries it (the job chips from
// /api/jobs, the Yard sidebar from /api/resources) for everyone who sees the board; no site-link reply ever does; it's
// Labour register only; nothing is called outside. Made-up people, a project and jobs on the test copy only - one job
// on 14 Sep 2020 (a day no other check uses) and one TODAY so a supervisor link and a site poster have crew to show.
// WRITES: four people, a machine, two projects, two jobs, assignments, a supervisor link and a poster.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const DAY = "2020-09-14";
const at = (date) => new Date(`${date}T00:00:00.000Z`);
const REFUSED = ["VIEWER", "COORDINATOR", "YARD", "ACCOUNTS", "TIMESHEETS", "DIRECTOR", null];
const label = (who) => who ?? "no login";
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
// Every file under a folder (relative paths), for the source checks.
const filesUnder = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name)) out.push(f); } };
  try { walk(dir); } catch { /* missing folder */ }
  return out;
};

export default {
  id: "full-time-tiles", title: "Full-time tiles: Manager / Admin set it, the board carries it, no site link does, no outbound call",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/fullTime.ts") || "needs lib/fullTime.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    if (await db.job.count({ where: { date: at(DAY), cancelledAt: null } })) return t.block(`the snapshot already has job(s) on ${DAY}`);
    const net0 = netLines(c);
    const tag = Date.now().toString(36);

    // Seed: A and B (Labour register), S a supervisor, H a hire worker, M a machine; jobs on DAY and today.
    const mk = (name, extra = {}) => db.resource.create({ data: { name: `${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", ...extra } });
    const A = await mk("RC Fulltimer A"), B = await mk("RC Casual B"), S = await mk("RC Ftsuper S", { category: "Site Manager", role: "Supervisor" });
    const H = await mk("RC Hire H", { type: "HIRE", category: "LABOUR", ownership: "HIRED" });
    const M = await mk("RC Machine M", { type: "EQUIPMENT", category: null, role: null });
    t.ok(A.fullTime === false && M.fullTime === false, "new records start not full-time (the column's default)");
    const P = await db.project.create({ data: { name: `RC Full-time ${tag}`, status: "ACTIVE" } });
    const T = await db.project.create({ data: { name: `RC Full-time today ${tag}`, status: "ACTIVE" } });
    const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: at(DAY), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    const JT = await db.job.create({ data: { projectId: T.id, title: T.name, date: at(c.today), shift: "DAY", status: "ACTIVE", startTime: "6am", endTime: "11pm" } });
    for (const [r, role] of [[A, null], [B, null], [S, "Supervisor"], [M, null]]) await db.assignment.create({ data: { jobId: J.id, resourceId: r.id, role } });
    for (const [r, role] of [[A, null], [B, null], [S, "Supervisor"]]) await db.assignment.create({ data: { jobId: JT.id, resourceId: r.id, role } });

    // (1) Who may set it. Every other role (and no login) is refused and nothing changes.
    const ft = async (r) => (await db.resource.findUnique({ where: { id: r.id } })).fullTime;
    for (const who of REFUSED) {
      t.status(await c.patch(`/api/resources/${A.id}`, who, { fullTime: true }), [401, 403], `${label(who)} ticking someone full-time`);
      t.status(await c.post("/api/resources", who, { name: `RC New ${tag}`, type: "PERSONNEL", fullTime: true }), [400, 401, 403], `${label(who)} adding a full-timer`);
    }
    t.ok((await ft(A)) === false, "after all of those A is still not full-time");
    t.ok(!(await db.resource.findFirst({ where: { name: `RC New ${tag}` } })), "and nobody was added");
    t.status(await c.patch(`/api/resources/${A.id}`, "MANAGER", { fullTime: true }), 200, "a Manager ticks A full-time");
    t.ok((await ft(A)) === true, "A is saved as full-time");
    t.status(await c.patch(`/api/resources/${S.id}`, "ADMIN", { fullTime: "true" }), 200, "an Admin ticks S (the supervisor) full-time, from the form's select");
    t.ok((await ft(S)) === true, "S is saved as full-time");
    t.status(await c.patch(`/api/resources/${S.id}`, "ADMIN", { fullTime: "false" }), 200, "an Admin unticks S");
    t.ok((await ft(S)) === false, "S is saved as not full-time");
    t.status(await c.patch(`/api/resources/${S.id}`, "MANAGER", { fullTime: true }), 200, "a Manager ticks S again");
    const made = await c.post("/api/resources", "MANAGER", { name: `RC New FT ${tag}`, type: "PERSONNEL", category: "Labourer", fullTime: "true" });
    t.status(made, 201, "a Manager adds a new worker ticked full-time");
    t.ok((await db.resource.findFirst({ where: { name: `RC New FT ${tag}` } }))?.fullTime === true, "the new worker is saved as full-time");
    // Labour register only; a yes or a no; the Plant form sending its "false" back is fine.
    t.status(await c.patch(`/api/resources/${M.id}`, "MANAGER", { fullTime: true }), 400, "ticking a machine full-time");
    t.status(await c.patch(`/api/resources/${H.id}`, "MANAGER", { fullTime: true }), 400, "ticking a labour hire worker full-time");
    t.status(await c.post("/api/resources", "MANAGER", { name: `RC Plant FT ${tag}`, type: "EQUIPMENT", fullTime: true }), 400, "adding a machine ticked full-time");
    t.status(await c.patch(`/api/resources/${A.id}`, "MANAGER", { fullTime: "maybe" }), 400, "a full-time value that isn't a yes or a no");
    t.status(await c.patch(`/api/resources/${M.id}`, "MANAGER", { fullTime: false, notes: "RC resave" }), 200, "the Plant form re-saving a machine with full-time = no");
    t.ok((await ft(M)) === false && (await ft(H)) === false && (await ft(A)) === true, "the machine and the hire worker are still not full-time; A still is");
    // The Labour form sends the whole record back: a Manager re-saving A unchanged keeps the tick.
    const regRow = (await c.json("/api/resources?type=PERSONNEL", "MANAGER")).body?.find?.((r) => r.id === A.id);
    t.status(await c.patch(`/api/resources/${A.id}`, "MANAGER", { ...regRow, notes: "RC whole-form resave" }), 200, "a Manager re-saving A's whole Labour form");
    t.ok((await ft(A)) === true, "A is still full-time after the whole-form save");

    // History: recorded like every other resource edit (RecordChange), shown to a Manager with who did it.
    const rc = await db.recordChange.findMany({ where: { model: "Resource", recordId: A.id, field: "fullTime" } });
    t.ok(rc.length === 1 && rc[0].before === "false" && rc[0].after === "true" && rc[0].changedById === c.users.MANAGER.id, "the tick is kept in A's history (false -> true, by the Manager)", JSON.stringify(rc.map((r) => [r.before, r.after])));
    const rs = await db.recordChange.findMany({ where: { model: "Resource", recordId: S.id, field: "fullTime" }, orderBy: { changedAt: "asc" } });
    t.ok(rs.length === 3 && rs.map((r) => r.after).join(",") === "true,false,true", "S's three changes are each kept", JSON.stringify(rs.map((r) => r.after)));
    const hm = (await c.json(`/api/history?model=Resource&id=${A.id}`, "MANAGER")).body;
    t.ok(hm?.changes?.some((x) => x.field === "fullTime" && x.after === "true"), "a Manager's History shows it");

    // (2) The board's data carries it, for everyone who sees the board (VIEWER included - it isn't money).
    for (const who of ["MANAGER", "ADMIN", "VIEWER"]) {
      const jobs = (await c.json(`/api/jobs?date=${DAY}`, who)).body;
      const chips = (Array.isArray(jobs) ? jobs : []).find((j) => j.id === J.id)?.assignments ?? [];
      const chip = (r) => chips.find((a) => a.resourceId === r.id)?.resource;
      t.ok(chip(A)?.fullTime === true && chip(S)?.fullTime === true, `the board's job chips carry fullTime = true for A and S (${who})`, JSON.stringify([chip(A)?.fullTime, chip(S)?.fullTime]));
      t.ok(chip(B)?.fullTime === false && chip(M)?.fullTime === false, `and false for B and the machine (${who})`, JSON.stringify([chip(B)?.fullTime, chip(M)?.fullTime]));
      const yard = (await c.json("/api/resources", who)).body;
      const card = (r) => (Array.isArray(yard) ? yard : []).find((x) => x.id === r.id);
      t.ok(card(A)?.fullTime === true && card(B)?.fullTime === false, `the Yard sidebar's list carries it (${who})`, JSON.stringify([card(A)?.fullTime, card(B)?.fullTime]));
    }
    // The money wall is unchanged: VIEWER's chips still have no rate or pay field.
    const vj = (await c.json(`/api/jobs?date=${DAY}`, "VIEWER")).body;
    const va = (Array.isArray(vj) ? vj : []).find((j) => j.id === J.id)?.assignments?.find((a) => a.resourceId === A.id)?.resource ?? {};
    t.ok(!["ordinaryRate", "payRateBasis", "engagement", "dailyRateExGst", "hireRate", "maxDaysPerWeek"].some((f) => f in va), "VIEWER's chip still has no pay, rate or limit field", Object.keys(va).join(","));
    t.ok(noMoney(JSON.stringify(vj)), "no dollar figure in VIEWER's board data");

    // (3) No site-link reply carries it: a supervisor link (S, on today's job with A), the snapshot's supervisor and
    // office links, a site poster for today's job, and the public search / pre-start replies.
    const sLink = await makeLink(db, "SUPERVISOR", S.id);
    const poster = await makeLink(db, "POSTER", null, { projectId: T.id });
    const links = [["supervisor (on today's job)", sLink], ["snapshot supervisor", c.links.sup], ["snapshot office", c.links.office]].filter(([, l]) => l);
    const rests = ["", "/hire", "/hours", `/hours?jobId=${JT.id}`, "/log", `/log?jobId=${JT.id}`, "/requests", "/signin", `/signin?jobId=${JT.id}`, "/todo", "/yard", "/receipts", "/reimbursements", "/queries", "/purchases", "/push"];
    let seen = 0, crewShown = false;
    for (const [name, l] of links) {
      for (const rest of rests) {
        const r = await c.get(c.site(l, rest), null);
        const text = await r.text().catch(() => "");
        if (r.status === 200) seen++;
        if (text.includes(A.name)) crewShown = true;
        t.ok(!/"fullTime"/.test(text), `no fullTime in ${name} link ${rest || "/"} (${r.status})`, text.slice(0, 160));
      }
    }
    t.ok(seen > 0, "the link replies were read (at least one 200)", `${seen}`);
    const pr = await c.get(`/api/site/in/${encodeURIComponent(poster.secret)}`, null);
    const prText = await pr.text().catch(() => "");
    t.ok(!/"fullTime"/.test(prText), `no fullTime in the site poster's sign-in reply (${pr.status})`, prText.slice(0, 160));
    if (pr.status === 200) { t.ok(prText.includes(A.name), "the poster lists today's crew (A among them) - so the check had a full-timer to leak"); crewShown = true; }
    else t.note(`the poster answered ${pr.status} on this copy: ${prText.slice(0, 120)}`);
    for (const pth of [`/api/site/in/search?q=${encodeURIComponent("RC Fulltimer")}`, "/api/site/in/prestart", `/api/site/plant/search?q=RC`]) {
      const r = await c.get(pth, null);
      const text = await r.text().catch(() => "");
      t.ok(!/"fullTime"/.test(text), `no fullTime in ${pth.split("?")[0]} (${r.status})`, text.slice(0, 160));
    }
    if (!crewShown) t.note("no site reply on this copy listed A by name - the key scan above still covers every reply");
    // And in the source: no site-link route or page names it, and none hands back a whole resource row.
    const siteFiles = [...filesUnder(path.join(c.p.appDir, "src", "app", "api", "site")), ...filesUnder(path.join(c.p.appDir, "src", "app", "site"))];
    const named = siteFiles.filter((f) => readFileSync(f, "utf8").includes("fullTime"));
    t.ok(siteFiles.length > 0 && named.length === 0, "no site-link route or page mentions fullTime", named.map((f) => path.relative(c.p.appDir, f)).join(", "));
    const whole = siteFiles.filter((f) => /resource:\s*true/.test(readFileSync(f, "utf8")));
    t.ok(whole.length === 0, "no site-link route includes a whole resource row (resource: true)", whole.map((f) => path.relative(c.p.appDir, f)).join(", "));
    const lib = readFileSync(path.join(c.p.appDir, "src", "lib", "fullTime.ts"), "utf8");
    t.ok(!/fetch\(|https?:\/\/|from "(node:)?(http|https|net)"/.test(lib), "lib/fullTime.ts makes no network call");

    // (4) Nothing was called outside during this check.
    const net1 = netLines(c);
    t.ok(net1 === net0, "no outbound connection attempted during this check", `${net1 - net0} new blocked attempt(s)`);
  },
};
