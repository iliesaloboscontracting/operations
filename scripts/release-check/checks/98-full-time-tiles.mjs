// Full-time tiles (Ilies, 22 Nov 2026: "all full times have a orange box. this allows me to easily identify who to
// prioritize when we dont have works"). Resource.fullTime: a tick on the Labour register that only a Manager or an
// Admin sets (server-checked), kept in the record's history; the board's data carries it (the job chips from
// /api/jobs, the Yard sidebar from /api/resources) for everyone who sees the board; no site-link reply ever does; it's
// Labour register only; nothing is called outside. Made-up people, a project and jobs on the test copy only - one job
// on 14 Sep 2020 (a day no other check uses) and one TODAY so a supervisor link and a site poster have crew to show.
// On screen only (Ilies, 22 Nov 2026: "only for the system not to be exported"): the day sheet text, the DaySheetSend
// snapshot, the CSV exports and the daily report carry no full-time marker with ticked people allocated.
// FT-001: the Assistant's tools never hand fullTime to the model. FT-002: every export / report assertion first sees the
// ticked person (A) by name - seeded sign-ins on 14 Sep 2020, the week locked and A approved for the pay run, then put
// back. FT-003: a record moved off the Labour register loses its tick (recorded).
// WRITES (all tagged "RC ... <tag>", on the test copy only): five people, a machine, two projects, two jobs,
// assignments, a supervisor link, a poster, a day-sheet send, sign-ins on 14 Sep 2020 and a pay review - the sign-ins
// and the pay review are removed again and the week reopened at the end.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  id: "full-time-tiles", title: "Full-time tiles: Manager / Admin set it, the board carries it; no site link, export, sheet, report or Assistant does (replies + whole-src scan); no outbound call",
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
    const A = await mk("RC Ticked A"), B = await mk("RC Casual B"), S = await mk("RC Tsuper S", { category: "Site Manager", role: "Supervisor" });
    const H = await mk("RC Hire H", { type: "HIRE", category: "LABOUR", ownership: "HIRED" });
    const M = await mk("RC Machine M", { type: "EQUIPMENT", category: null, role: null });
    t.ok(A.fullTime === false && M.fullTime === false, "new records start not full-time (the column's default)");
    const P = await db.project.create({ data: { name: `RC Tiles ${tag}`, status: "ACTIVE" } });
    const T = await db.project.create({ data: { name: `RC Tiles today ${tag}`, status: "ACTIVE" } });
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
    const made = await c.post("/api/resources", "MANAGER", { name: `RC New Tick ${tag}`, type: "PERSONNEL", category: "Labourer", fullTime: "true" });
    t.status(made, 201, "a Manager adds a new worker ticked full-time");
    t.ok((await db.resource.findFirst({ where: { name: `RC New Tick ${tag}` } }))?.fullTime === true, "the new worker is saved as full-time");
    // Labour register only; a yes or a no; the Plant form sending its "false" back is fine.
    t.status(await c.patch(`/api/resources/${M.id}`, "MANAGER", { fullTime: true }), 400, "ticking a machine full-time");
    t.status(await c.patch(`/api/resources/${H.id}`, "MANAGER", { fullTime: true }), 400, "ticking a labour hire worker full-time");
    t.status(await c.post("/api/resources", "MANAGER", { name: `RC Plant Tick ${tag}`, type: "EQUIPMENT", fullTime: true }), 400, "adding a machine ticked full-time");
    t.status(await c.patch(`/api/resources/${A.id}`, "MANAGER", { fullTime: "maybe" }), 400, "a full-time value that isn't a yes or a no");
    t.status(await c.patch(`/api/resources/${M.id}`, "MANAGER", { fullTime: false, notes: "RC resave" }), 200, "the Plant form re-saving a machine with full-time = no");
    t.ok((await ft(M)) === false && (await ft(H)) === false && (await ft(A)) === true, "the machine and the hire worker are still not full-time; A still is");
    // The Labour form sends the whole record back: a Manager re-saving A unchanged keeps the tick.
    const regRow = (await c.json("/api/resources?type=PERSONNEL", "MANAGER")).body?.find?.((r) => r.id === A.id);
    t.status(await c.patch(`/api/resources/${A.id}`, "MANAGER", { ...regRow, notes: "RC whole-form resave" }), 200, "a Manager re-saving A's whole Labour form");
    t.ok((await ft(A)) === true, "A is still full-time after the whole-form save");

    // FT-003: moved off the Labour register -> the tick is cleared, and that's in the record's history.
    const X = await mk("RC Moved X");
    t.status(await c.patch(`/api/resources/${X.id}`, "MANAGER", { fullTime: true }), 200, "a Manager ticks X full-time");
    t.status(await c.patch(`/api/resources/${X.id}`, "ADMIN", { type: "EQUIPMENT" }), 200, "an Admin moves X to the Plant register (type EQUIPMENT)");
    t.ok((await ft(X)) === false, "X is no longer full-time once off the Labour register");
    const rx = await db.recordChange.findMany({ where: { model: "Resource", recordId: X.id, field: "fullTime" }, orderBy: { changedAt: "asc" } });
    t.ok(rx.map((r) => r.after).join(",") === "true,false", "both changes are in X's history (true, then false with the move)", JSON.stringify(rx.map((r) => r.after)));
    const made2 = await c.post("/api/resources", "MANAGER", { name: `RC Plant Untick ${tag}`, type: "EQUIPMENT" });
    t.status(made2, 201, "a Manager adds a machine");
    t.ok((await db.resource.findFirst({ where: { name: `RC Plant Untick ${tag}` } }))?.fullTime === false, "a new non-Labour record is saved not full-time");

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
    for (const pth of [`/api/site/in/search?q=${encodeURIComponent("RC Ticked")}`, "/api/site/in/prestart", `/api/site/plant/search?q=RC`]) {
      const r = await c.get(pth, null);
      const text = await r.text().catch(() => "");
      t.ok(!/"fullTime"/.test(text), `no fullTime in ${pth.split("?")[0]} (${r.status})`, text.slice(0, 160));
    }
    t.ok(crewShown, "a site-link / poster reply listed A (ticked full-time) by name - so there was a full-timer to leak");
    // And in the source: no site-link route or page names it, and none hands back a whole resource row. (The src/lib
    // modules those routes import are covered by the whole-src scan in (4): fullTime is named only in the allowed files.)
    const siteFiles = [...filesUnder(path.join(c.p.appDir, "src", "app", "api", "site")), ...filesUnder(path.join(c.p.appDir, "src", "app", "site"))];
    const named = siteFiles.filter((f) => readFileSync(f, "utf8").includes("fullTime"));
    t.ok(siteFiles.length > 0 && named.length === 0, "no site-link route or page mentions fullTime", named.map((f) => path.relative(c.p.appDir, f)).join(", "));
    const whole = siteFiles.filter((f) => /resource:\s*true/.test(readFileSync(f, "utf8")));
    t.ok(whole.length === 0, "no site-link route includes a whole resource row (resource: true)", whole.map((f) => path.relative(c.p.appDir, f)).join(", "));
    const lib = readFileSync(path.join(c.p.appDir, "src", "lib", "fullTime.ts"), "utf8");
    t.ok(!/fetch\(|https?:\/\/|from "(node:)?(http|https|net)"/.test(lib), "lib/fullTime.ts makes no network call");

    // (4) On screen only (Ilies, 22 Nov 2026: "the colour display for the full timers is only for the system not to be
    // exported"). With ticked people (A, S) on today's job: the day sheet's text and the DaySheetSend snapshot carry no
    // full-time marker; nor do the CSV exports or the printable daily report; and outside the board / sidebar / Labour
    // register / the write path, no source file uses it.
    const MARK = /fulltime|full-time|\bFT\b/i;
    const boardJobs = (await c.json(`/api/jobs?date=${c.today}`, "MANAGER")).body;
    const jt = (Array.isArray(boardJobs) ? boardJobs : []).filter((j) => j.id === JT.id);
    t.ok(jt[0]?.assignments?.some((a) => a.resourceId === A.id && a.resource?.fullTime === true), "today's board data has A ticked full-time (the sheet is built from it)");
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(tsxCli) && c.p.files) {
      // The day sheet is built in the browser (Board.tsx -> lib/daySheet.ts buildDaySheet). Run the same builder on the
      // board's own job objects - fullTime included, not even narrowed as Board.tsx does - and read the text it makes.
      const input = path.join(c.p.files, `rc98-jobs-${tag}.json`);
      const script = path.join(c.p.files, `rc98-sheet-${tag}.mts`);
      writeFileSync(input, JSON.stringify(jt));
      const sheetLib = "file:///" + path.join(c.p.appDir, "src", "lib", "daySheet.ts").split(path.sep).join("/");
      writeFileSync(script, [
        `import { readFileSync } from "node:fs";`,
        `import { buildDaySheet } from ${JSON.stringify(sheetLib)};`,
        `const s = buildDaySheet(JSON.parse(readFileSync(${JSON.stringify(input)}, "utf8")), ${JSON.stringify(c.today)});`,
        `console.log("RESULT " + JSON.stringify(s));`,
      ].join("\n"));
      let out = "";
      try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: { ...process.env, ...(c.childEnv ?? {}) }, encoding: "utf8", timeout: 120_000 }); }
      catch (e) { out = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
      let sheet = null;
      try { sheet = JSON.parse(out.split("\n").find((l) => l.startsWith("RESULT "))?.slice(7) ?? "null"); } catch { /* checked below */ }
      const text = sheet ? `${sheet.subject}\n${sheet.body}` : "";
      t.ok(text.includes(A.name) && text.includes(S.name), "the day sheet was built and lists A and S (both ticked full-time)", sheet ? "" : out.slice(0, 160));
      t.ok(!!sheet && !MARK.test(text), "the day sheet text (Export / Copy / Open in email) has no FT / Full-time marker", (text.match(MARK) ?? [""])[0]);
    } else t.block("no tsx in the candidate's node_modules - the day sheet text couldn't be built");
    const sent = await c.post("/api/board/sends", "MANAGER_DIRECTOR", { date: c.today, how: "COPY" });
    t.status(sent, [200, 201], "a Manager copies today's sheet (recorded as a send)");
    t.ok(!MARK.test(await sent.text().catch(() => "")), "no full-time marker in the send's reply");
    const send = await db.daySheetSend.findFirst({ where: { date: c.today }, orderBy: { sentAt: "desc" } });
    let snapJob = null;
    try { snapJob = JSON.parse(send?.snapshot ?? "{}").jobs?.find((j) => (j.crew ?? []).some((p) => p.id === A.id)) ?? null; } catch { /* checked below */ }
    t.ok(!!snapJob && snapJob.crew.some((p) => p.id === S.id), "the send's snapshot holds today's job with A and S");
    t.ok(!!send && !/fulltime|full-time/i.test(send.snapshot) && !MARK.test(JSON.stringify(snapJob ?? {})), "the DaySheetSend snapshot has no full-time marker", send ? "" : "no send row");
    // FT-002: an export only proves something if it lists the ticked person. Sign-ins on DAY (its own week, 14-20 Sep
    // 2020) for A and S (staff, both ticked) and a labour hire worker, signed in and out; removed again at the end.
    const aest = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 10, m)); };
    const seeded = [];
    const signIn = async (data) => {
      const r = await db.siteAttendance.create({ data: { jobId: J.id, date: DAY, allocated: true, signInMethod: "SUPERVISOR_QR", status: "CONFIRMED",
        signInAt: aest(DAY, "07:00"), signOutAt: aest(DAY, "15:30"), signOutMethod: "SUPERVISOR_QR", ...data } });
      seeded.push(r.id);
    };
    const hireName = `RC Hireworker ${tag}`;
    await signIn({ resourceId: A.id, workerName: A.name });
    await signIn({ resourceId: S.id, workerName: S.name });
    await signIn({ resourceId: null, workerName: hireName, company: "Advanced Labour Hire" });
    const sees = async (pth, who, name, what) => {
      const r = await c.text(pth, who);
      if (r.status !== 200 || !r.text.includes(name)) return t.block(`${what}: the copy didn't produce it listing ${name === A.name ? "A" : "the test hire worker"} (${r.status} ${r.text.slice(0, 100)})`);
      t.ok(true, `${what} lists ${name === A.name ? "A (ticked full-time)" : "the test hire worker"} by name`);
      t.ok(!MARK.test(r.text), `no full-time marker in ${what}`, (r.text.match(MARK) ?? [""])[0]);
    };
    let locked = false;
    try {
      await sees(`/api/timesheets/export?week=${DAY}`, "MANAGER", A.name, "the staff timesheet CSV (draft)");
      await sees(`/api/accounts/timesheets/export?week=${DAY}`, "ACCOUNTS", A.name, "the accounts timesheet CSV");
      await sees(`/api/accounts/payroll/export?week=${DAY}&file=summary`, "ACCOUNTS", A.name, "the payroll hours summary CSV");
      // Full-timers are Labour-register staff, never labour hire: that file is checked with a test hire worker in it.
      await sees(`/api/timesheets/labour-hire/export?week=${DAY}`, "MANAGER", hireName, "the labour hire timesheet CSV");
      await sees(`/api/daily-report/${J.id}`, "MANAGER", A.name, "the printable daily report");
      await sees(`/api/directors/daily-report/${J.id}`, "DIRECTOR", A.name, "the Directors' daily report");
      // The pay-run file lists only people accounts approved in a locked week: lock it, approve A, read it, put it back.
      const ap = await c.post("/api/timesheets", "MANAGER", { week: DAY, action: "approve" });
      locked = ap.status === 200;
      if (!locked) t.block(`pay-run CSV: the week of ${DAY} couldn't be locked on this copy (${ap.status} ${(await ap.text().catch(() => "")).slice(0, 120)})`);
      else {
        await sees(`/api/timesheets/export?week=${DAY}`, "MANAGER", A.name, "the staff timesheet CSV (approved week)");
        const pw = (await c.json(`/api/accounts/payroll?week=${DAY}`, "ACCOUNTS")).body;
        const pa = pw?.people?.find?.((p) => p.name === A.name);
        const rv = pa ? await c.post("/api/accounts/payroll", "ACCOUNTS", { week: DAY, personKey: pa.personKey, status: "APPROVED" }) : null;
        if (!rv || ![200, 201].includes(rv.status)) t.block(`pay-run CSV: accounts couldn't approve A on this copy (${rv ? rv.status + " " + (await rv.text().catch(() => "")).slice(0, 120) : "A not on the payroll week"})`);
        else await sees(`/api/accounts/payroll/export?week=${DAY}&file=payrun`, "ACCOUNTS", A.name, "the pay-run CSV");
      }
    } finally {
      if (locked) t.status(await c.post("/api/timesheets", "ADMIN", { week: DAY, action: "reopen", reason: "RC full-time check - put back" }), 200, "the week of 14 Sep 2020 reopened again");
      await db.payWeekReview.deleteMany({ where: { weekStart: DAY, personName: { contains: tag } } });
      await db.siteAttendance.deleteMany({ where: { id: { in: seeded } } });
    }

    // FT-001: the Assistant's tools (runTool -> the real /api/jobs and /api/resources, as a Manager) hand the model no
    // fullTime - with A and S ticked and on the board.
    if (existsSync(tsxCli) && c.p.files) {
      const cookie = (await c.login("MANAGER")).cookie;
      const toolsLib = "file:///" + path.join(c.p.appDir, "src", "lib", "assistantTools.ts").split(path.sep).join("/");
      const script = path.join(c.p.files, `rc98-assistant-${tag}.mts`);
      writeFileSync(script, [
        `import { runTool } from ${JSON.stringify(toolsLib)};`,
        `const jobs = await runTool("get_jobs", { date: ${JSON.stringify(DAY)} }, ${JSON.stringify(c.base)}, ${JSON.stringify(cookie)});`,
        `const res = await runTool("get_resources", {}, ${JSON.stringify(c.base)}, ${JSON.stringify(cookie)});`,
        `console.log("RESULT " + JSON.stringify({ jobs, res }));`,
      ].join("\n"));
      let out = "";
      try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: { ...process.env, ...(c.childEnv ?? {}) }, encoding: "utf8", timeout: 120_000 }); }
      catch (e) { out = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
      const line = out.split("\n").find((l) => l.startsWith("RESULT ")) ?? "";
      t.ok(line.includes(A.name) && /"ok":true/.test(line), "the Assistant's get_jobs / get_resources ran on the copy and include A", line ? "" : out.slice(0, 160));
      t.ok(!!line && !line.includes("fullTime"), "no fullTime in the Assistant's tool results (FT-001)");
    } else t.block("no tsx in the candidate's node_modules - the Assistant tools couldn't be run");

    const ALLOWED = new Set([
      "src/lib/assistantTools.ts", "src/lib/assistantTools.test.ts", // FT-001: they name it only to take it out
      "src/lib/fullTime.ts", "src/lib/fullTime.test.ts", "src/lib/resourceFields.ts", "src/lib/recordPatch.ts", "src/lib/types.ts",
      "src/app/api/resources/route.ts", "src/app/labour/page.tsx", "src/components/AssignedChip.tsx", "src/components/ResourceCard.tsx",
      "src/components/ResourceSidebar.tsx", "src/components/board/FullTimeMark.tsx", "src/components/HistoryButton.tsx",
    ]);
    const srcFiles = filesUnder(path.join(c.p.appDir, "src"));
    const strays = srcFiles.map((f) => path.relative(c.p.appDir, f).split(path.sep).join("/"))
      .filter((rel) => !ALLOWED.has(rel) && /\bfullTime\b|lib\/fullTime"|\.\/fullTime"|FullTimeMark/.test(readFileSync(path.join(c.p.appDir, rel), "utf8")));
    t.ok(srcFiles.length > 0 && strays.length === 0, "full-time is used only by the board, the sidebar, the Labour register and the write path (no export, sheet, report or link)", strays.join(", "));

    // (5) Nothing was called outside during this check.
    const net1 = netLines(c);
    t.ok(net1 === net0, "no outbound connection attempted during this check", `${net1 - net0} new blocked attempt(s)`);
  },
};
