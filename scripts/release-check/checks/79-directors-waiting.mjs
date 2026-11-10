// Directors -> "Waiting on you" (10 Nov 2026; Ilies: "yes go and deploy once it passes"). Seeds two director people on
// the copy: A = the SAME_PERSON pair's DIRECTOR login (Nick's, by id from src/lib/samePerson.ts - created with that id
// if the copy has none) and A2 = the pair's other login (made a DIRECTOR login under another name for the approve test,
// so only the by-id rule can refuse it); B = the throwaway DIRECTOR login. Then: the section lists an open question, a
// pending proposal and a project with no contract value; A enters a value -> a proposal; A, A2 and the owner are
// refused; B approves -> the project's contractValue changes and the proposal's history is recorded; "Send to Ilies"
// once; VIEWER / MANAGER / ACCOUNTS / COORDINATOR / YARD / TIMESHEETS / plain Admin refused; every action link is a
// Directors page; DIRECTOR logins may turn on their own phone alerts; the Monday reminder run directly (through tsx)
// with a fake Monday 8:30am - exactly one per director person, none on a second run, none when N = 0, none with the
// kill switch or on a Tuesday; no money in the push. WRITES on the test copy: 2 logins (or their passwords / roles), a
// project, a question, a proposal (executed), a chat thread, push devices, reminder rows.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";

const hashOf = (pw) => { const salt = randomBytes(16); return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 64).toString("hex")}`; };
const MONDAY = "2020-03-23"; // a Monday in AEDT (UTC+11), far from any live week
const aedt = (date, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d, h - 11, m)); };
const items = (dto) => (dto?.groups ?? []).flatMap((g) => g.items.map((i) => ({ ...i, group: g.id })));

export default {
  id: "directors-waiting", title: "Directors: Waiting on you - questions, approvals, contract values, decisions; Monday reminder",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/directorsWaiting/rules.ts") || "needs lib/directorsWaiting/rules.ts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    if (!c.users.DIRECTOR || !c.users.OWNER) return t.block("no DIRECTOR or owner test login");
    // The SAME_PERSON pair (Nick's two logins) from the candidate's own source.
    let pair = null;
    try { pair = readFileSync(path.join(c.p.appDir, "src", "lib", "samePerson.ts"), "utf8").match(/\[\s*"([a-z0-9]+)"\s*,\s*"([a-z0-9]+)"\s*\]/)?.slice(1, 3); } catch { /* missing */ }
    if (!pair) return t.block("no SAME_PERSON pair in src/lib/samePerson.ts");
    const existing = await db.user.findMany({ where: { id: { in: pair } }, select: { id: true, role: true } });
    // The pair's DIRECTOR login (A) and the other one (A2); on a copy without them, both are made with those ids.
    const dirId = existing.find((u) => u.role === "DIRECTOR")?.id ?? pair[1];
    const otherId = pair.find((x) => x !== dirId);
    const seat = async (key, id, role) => {
      const password = randomBytes(18).toString("base64url");
      const was = await db.user.findUnique({ where: { id }, select: { email: true, role: true } });
      const name = `RC79 ${key} ${tag}`;
      const u = was
        ? await db.user.update({ where: { id }, data: { passwordHash: hashOf(password), active: true, role, name } })
        : await db.user.create({ data: { id, email: `rc79-${key.toLowerCase()}-${tag}@release-check.test`, name, passwordHash: hashOf(password), role } });
      c.users[`RC79_${key}`] = { id: u.id, email: u.email, password, role };
      c.forget(`RC79_${key}`);
      return { ...u, wasRole: was?.role ?? null };
    };
    const A = await seat("A", dirId, "DIRECTOR");
    const A2 = await seat("A2", otherId, "DIRECTOR"); // made a DIRECTOR login for the approve test only (role put back below)
    const B = c.users.DIRECTOR;
    t.note(`A / A2: ${existing.length === 2 ? "the copy's SAME_PERSON pair, passwords replaced" : "created on the copy with the SAME_PERSON ids"}`);

    // Seeds: an active project with no contract value, and an open question to A.
    const project = await db.project.create({ data: { name: `RC79 no value ${tag}`, status: "ACTIVE" } });
    const q = await c.post("/api/info-requests", "OWNER", { toUserId: A.id, type: "QUESTION", title: `RC79 question ${tag}`, question: "Which tender register is the master copy?", why: "So the pipeline reads the right list" });
    t.status(q, 201, "the owner asks A a question (information request)");
    const qid = (await q.json().catch(() => ({}))).id;

    // (1) A's section: the question, the no-value project with "Enter value", the decisions not made yet.
    const a1 = await c.json("/api/directors/waiting", "RC79_A");
    t.status(a1.status, 200, "A reads Waiting on you");
    const ai = items(a1.body);
    t.ok(a1.body?.groups?.map((g) => g.id).join(",") === "QUESTIONS,APPROVALS,FIGURES,DECISIONS", "four groups in order", a1.body?.groups?.map((g) => g.id).join(","));
    const qi = ai.find((i) => i.id === `q:${qid}`);
    t.ok(qi && qi.group === "QUESTIONS" && qi.action?.type === "ANSWER" && qi.counts && qi.since && qi.why === "So the pipeline reads the right list.", "the open question is listed, with its own why, its age and the answer action", JSON.stringify(qi ?? {}).slice(0, 200));
    const cv = ai.find((i) => i.id === `cv:${project.id}`);
    t.ok(cv && cv.group === "FIGURES" && cv.action?.type === "ENTER_VALUE" && cv.counts && cv.why === "Tracking can't warn at 80% / 100% of the job's value.", "the no-contract-value project: Enter value, with why it matters", JSON.stringify(cv ?? {}).slice(0, 200));
    const decisions = ai.filter((i) => i.group === "DECISIONS");
    t.ok(decisions.length >= 2 && decisions.every((i) => i.action?.type === "SEND_TO_ILIES" && /what's needed/.test(i.what)), "decisions not made yet: each with what's needed and Send to Ilies", decisions.length);
    t.ok(a1.body?.total === ai.filter((i) => i.counts).length && a1.body.total > 0, "N = the items A can act on", a1.body?.total);
    t.ok(!ai.some((i) => /rate|ticket|rego|job number/i.test(i.kind)), "no office gaps (rates, tickets, rego, job numbers)");

    // (2) A enters a value -> a proposal (nothing changes yet).
    const prop = await c.post("/api/changes", "RC79_A", { kind: "PROJECT_CONTRACT_VALUE", recordId: project.id, contractValue: "123456", reason: "Letter of award (release check)", sources: [{ type: "Other", label: "Letter of award (release check)" }] });
    t.status(prop, 201, "A (a DIRECTOR login) proposes the contract value");
    const pid = (await prop.json().catch(() => ({}))).id;
    t.ok((await db.project.findUnique({ where: { id: project.id } }))?.contractValue == null, "the project is unchanged until approved");
    const a2v = items((await c.json("/api/directors/waiting", "RC79_A")).body).find((i) => i.id === `cv:${project.id}`);
    t.ok(a2v && a2v.action?.type === "NONE" && /waiting on .* to approve/.test(a2v.action.text) && !a2v.counts, "A now sees it waiting on the other director (not counted)", JSON.stringify(a2v?.action ?? {}).slice(0, 120));
    t.ok(!/RC79 A2/.test(a2v?.action?.text ?? ""), "A's other login is never named as the approver");

    // (3) B sees the pending proposal under Approvals, with the existing approve card.
    const b1 = await c.json("/api/directors/waiting", "DIRECTOR");
    const bi = items(b1.body);
    const pi = bi.find((i) => i.id === `c:${pid}`);
    t.ok(pi && pi.group === "APPROVALS" && pi.action?.type === "APPROVE" && pi.change?.canApprove === true && pi.counts, "B: the pending proposal is listed to approve", JSON.stringify(pi?.action ?? {}));
    t.ok(bi.find((i) => i.id === `cv:${project.id}`)?.counts === false, "B: the project isn't counted twice");
    const fingerprint = pi?.change?.fingerprint;

    // (4) Never the same person (A, A2 by id), never the owner; then B approves and it goes in, with its history.
    for (const [who, label] of [["RC79_A", "A (proposed it)"], ["RC79_A2", "A's other login (SAME_PERSON, another name)"], ["OWNER", "the owner"]]) {
      const r = await c.post(`/api/changes/${pid}`, who, { action: "APPROVE", fingerprint });
      const body = await r.json().catch(() => ({}));
      t.ok(r.status === 403 || (who === "OWNER" && r.status === 404), `${label} can't approve it -> 403`, `${r.status} ${body?.error ?? ""}`.slice(0, 120));
      if (who !== "OWNER") t.ok(/You proposed/.test(body?.error ?? ""), `${label}: refused as the proposer`, body?.error);
    }
    t.ok((await db.project.findUnique({ where: { id: project.id } }))?.contractValue == null, "still unchanged after the refusals");
    const ok = await c.post(`/api/changes/${pid}`, "DIRECTOR", { action: "APPROVE", fingerprint });
    const okBody = await ok.json().catch(() => ({}));
    t.ok(ok.status === 200 && okBody.status === "EXECUTED", "B (the other director) approves -> executed", `${ok.status} ${okBody.status ?? okBody.error ?? ""}`);
    t.ok((await db.project.findUnique({ where: { id: project.id } }))?.contractValue === 123456, "the project's contract value is the approved one");
    const hist = await db.changeProposalEvent.findMany({ where: { proposalId: pid }, select: { action: true, byUserId: true } });
    const acts = hist.map((e) => e.action);
    t.ok(acts.includes("PROPOSED") && acts.filter((a) => a === "REFUSED").length >= 3 && acts.includes("APPROVED") && acts.includes("EXECUTED")
      && hist.find((e) => e.action === "PROPOSED")?.byUserId === A.id && hist.find((e) => e.action === "APPROVED")?.byUserId === B.id,
    "history: proposed by A, three refusals, approved by B, executed", acts.join(","));
    t.ok(!items((await c.json("/api/directors/waiting", "RC79_A")).body).some((i) => i.id === `cv:${project.id}`), "the project has left A's list");
    // A2 back to an Admin login with director access (Nick's other login) - so the Monday reminder below groups it with A.
    await db.user.update({ where: { id: A2.id }, data: { role: A2.wasRole && A2.wasRole !== "DIRECTOR" ? A2.wasRole : "ADMIN", directorAccess: true } });

    // (5) Send to Ilies: once (a one-to-one office-chat message to the owner); the owner can't send to himself.
    const key = decisions[0]?.action?.key;
    const before = await db.message.count();
    t.status(await c.post("/api/directors/waiting/ask", "RC79_A", { key }), 200, "A sends a decision to Ilies");
    t.ok((await db.message.count()) === before + 1, "one office-chat message");
    t.status(await c.post("/api/directors/waiting/ask", "RC79_A", { key }), 409, "a second send the same week is refused");
    const sentRow = items((await c.json("/api/directors/waiting", "RC79_A")).body).find((i) => i.id === decisions[0].id);
    t.ok(sentRow && sentRow.sentAt && !sentRow.counts && sentRow.action?.type === "NONE", "it shows as sent to Ilies and no longer counts");
    t.status(await c.post("/api/directors/waiting/ask", "OWNER", { key }), 400, "the owner doesn't send to himself");
    t.status(await c.post("/api/directors/waiting/ask", "RC79_A", { key: "NOPE" }), 404, "an unknown item");

    // (6) Who may look: director access only.
    t.status(await c.get("/api/directors/waiting", null), 401, "no login");
    for (const who of ["VIEWER", "MANAGER", "ACCOUNTS", "COORDINATOR", "YARD", "TIMESHEETS", "ADMIN_PLAIN"]) {
      if (!c.users[who]) { t.note(`${who}: no test login`); continue; }
      t.status(await c.get("/api/directors/waiting", who), 403, `${who} refused`);
      t.status(await c.post("/api/directors/waiting/ask", who, { key }), 403, `${who} can't send to Ilies`);
    }
    for (const who of ["MANAGER_DIRECTOR", "ADMIN", "OWNER"]) t.status(await c.get("/api/directors/waiting", who), 200, `${who} (director access) reads it`);

    // (7) Never a link into Operations: every action link is a Directors page; the component only links to /directors.
    const hrefs = [...ai, ...bi].filter((i) => i.action?.type === "OPEN").map((i) => i.action.href);
    t.ok(hrefs.every((h) => h.startsWith("/directors/")), "every action link is a Directors page", hrefs.filter((h) => !h.startsWith("/directors/")).join(" "));
    let src = "";
    try { src = readFileSync(path.join(c.p.appDir, "src", "components", "directors", "WaitingOnYou.tsx"), "utf8"); } catch { /* missing */ }
    const literal = [...src.matchAll(/href=\{?[`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    t.ok(src && literal.length > 0 && literal.every((h) => h.startsWith("/directors")) && /<DLink href=\{a\.href\}/.test(src), "the section links only to /directors pages (and data links go through DLink)", literal.join(" "));
    t.status(await c.get("/directors/waiting", "DIRECTOR"), 200, "page /directors/waiting");
    t.ok((await c.text("/api/directors/waiting", "DIRECTOR")).text.length > 0 && noMoney(JSON.stringify(decisions)), "decision lines carry no amounts");

    // (8) Phone alerts: a DIRECTOR login turns on its own (/api/push), VIEWER still can't.
    t.status(await c.get("/api/push", "DIRECTOR"), 200, "a DIRECTOR login can turn on its own phone alerts");
    t.status(await c.get("/api/push", "VIEWER"), 403, "a Viewer still can't");

    // (9) The Monday reminder, run directly (through tsx) with a fake clock.
    const C = c.users.MANAGER_DIRECTOR; // a third director (by access) whose N is forced to 0
    for (const [uid, k] of [[A2.id, "a2"], [B.id, "b"], [C.id, "c"]]) {
      await db.pushDevice.create({ data: { userId: uid, endpoint: `https://fcm.googleapis.com/fcm/send/rc79-${k}-${tag}`, p256dh: "rc79", auth: "rc79" } });
    }
    const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (!existsSync(tsxCli)) return t.block("no tsx in the candidate - the reminder can't be run directly");
    const store = "file:///" + path.join(c.p.appDir, "src", "lib", "directorsWaiting", "store.ts").split(path.sep).join("/");
    const rules = "file:///" + path.join(c.p.appDir, "src", "lib", "directorsWaiting", "rules.ts").split(path.sep).join("/");
    const remind = (atIso, extra = {}) => {
      const script = path.join(c.p.files, `rc79-remind-${tag}-${Math.random().toString(36).slice(2, 8)}.mts`);
      writeFileSync(script, [
        `import { mondayWaitingReminder, loadWaiting } from ${JSON.stringify(store)};`,
        `import { reminderPush } from ${JSON.stringify(rules)};`,
        `const now = new Date(${JSON.stringify(atIso)});`,
        `const r = await mondayWaitingReminder(now, { count: async (u) => (u.id === ${JSON.stringify(C.id)} ? 0 : (await loadWaiting(u, now)).total) });`,
        `console.log("RESULT " + JSON.stringify({ ...r, push: reminderPush(3) }));`,
        `process.exit(0);`,
      ].join("\n"));
      const childEnv = { ...process.env, ...env, ...extra };
      if (!("DIRECTOR_WAITING_REMINDER" in extra)) delete childEnv.DIRECTOR_WAITING_REMINDER;
      let out = "";
      try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 180_000 }); } catch (e) { out = String(e?.stdout ?? ""); }
      try { return JSON.parse(out.match(/RESULT (.*)/)?.[1] ?? "null"); } catch { return null; }
    };
    const rows = (week) => db.shiftReminder.findMany({ where: { kind: "DIRECTOR_WAITING", jobId: { endsWith: `:${week}` } }, select: { jobId: true, people: true } });
    const mine = (list, id) => list.filter((r) => r.jobId === `${id}:${MONDAY}`);
    const off = remind(aedt(MONDAY, "08:30").toISOString(), { DIRECTOR_WAITING_REMINDER: "off" });
    t.ok(off && off.recorded === 0 && (await rows(MONDAY)).length === 0, "DIRECTOR_WAITING_REMINDER=off: nothing recorded", JSON.stringify(off));
    const tue = remind(aedt("2020-03-24", "08:30").toISOString());
    t.ok(tue && tue.recorded === 0 && (await rows("2020-03-24")).length === 0, "a Tuesday: nothing", JSON.stringify(tue));
    const first = remind(aedt(MONDAY, "08:30").toISOString());
    const r1 = await rows(MONDAY);
    t.ok(first && mine(r1, A.id).length === 1 && mine(r1, A.id)[0].people > 0, "Monday 8:30am: exactly one reminder for A (phone on A's other login - one person)", JSON.stringify({ recorded: first?.recorded, a: mine(r1, A.id).length }));
    t.ok(mine(r1, A2.id).length === 0, "none keyed on A's other login (the same person)");
    t.ok(mine(r1, B.id).length === 1 && mine(r1, B.id)[0].people > 0, "exactly one reminder for B");
    t.ok(mine(r1, C.id).length === 0, "N = 0: no reminder for that director");
    t.ok(mine(r1, c.users.OWNER.id).length === 0, "never the owner");
    const second = remind(aedt(MONDAY, "10:45").toISOString());
    t.ok(second && second.recorded === 0 && (await rows(MONDAY)).length === r1.length, "a second run that Monday records none", JSON.stringify(second));
    const push = first?.push ?? {};
    t.ok(push.body === "3 things waiting on you - open the Directors screen" && noMoney(JSON.stringify(push)) && !/\d[\d,]*\.\d{2}/.test(JSON.stringify(push)) && push.url === "/directors/waiting",
      "the push says how many and where - no money, no names", JSON.stringify(push));
  },
};
