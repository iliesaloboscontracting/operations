// "Tidy it up" on Message at sign-in (Ilies, 25 Nov 2026: "yes build it, deploy once passes"). POST
// /api/attendance/messages/tidy { text } -> { text }: Claude rewrites the draft for the box, it never sends anything.
//   (1) Who: Managers, Admins and the coordinator (guardOrCoordinator) get past the guard - here 503, as the release
//       check's .env has no ANTHROPIC_API_KEY; VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / YARD 403; signed out 401.
//   (2) The draft on the server: empty, over 600 characters, a $ amount, TFN / bank -> 400 (before anything else);
//       the office view says tidy is off (no key), so the button shows "Tidy-up isn't available right now".
//   (3) The rules with a stand-in Claude, run in a tsx child (as checks/78 does with receipts) with the outbound guard
//       preloaded and a dummy key, so nothing can leave: a good reply fills the box (folded the way the message route
//       keeps it); empty, over 300 (refused, never cut), money, TFN / bank, wrapped in quotes or markdown -> 422 "Couldn't
//       tidy that one - edit it yourself"; a Claude failure -> 502; MESSAGE_TIDY=off and no key -> 503 with the stand-in
//       never called; 40 a day per login (41st 429); the stand-in only ever gets { system, user } with the draft wrapped
//       in <draft> - no person id or name from the body.
//   (4) No message is created by tidying (row counts before / after); no outbound call (server and child).
// WRITES nothing on the test copy.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { noMoney } from "../lib/context.mjs";

const ALLOWED = ["MANAGER", "ADMIN", "COORDINATOR"];
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];
const ROUTE = "/api/attendance/messages/tidy";
const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "outbound-guard.cjs");
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "message-tidy", title: "Message at sign-in \"Tidy it up\": Manager / Admin / coordinator only, draft checks, reply checks (stand-in Claude), off without a key or MESSAGE_TIDY=off, 40 a day, never sends, no outbound",
  writes: false, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/lib/signinMessages/tidy.ts") || "needs lib/signinMessages/tidy.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const net0 = netLines(c);
    const count = () => db.signinMessage.count();
    const count0 = await count();
    const replies = [];
    const tidy = async (who, body) => { const r = await c.post(ROUTE, who, body); const text = await r.text().catch(() => ""); replies.push(text); let b = null; try { b = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body: b }; };
    const DRAFT = { text: "hey all pls make sure prestarts done b4 u start, cheers - ilies", resourceIds: ["rc105-not-sent"], audience: "PEOPLE" };

    // (1) Who may.
    for (const who of ALLOWED) {
      const r = await tidy(who, DRAFT);
      t.status(r, 503, `${who}: past the guard - 503 here (no ANTHROPIC_API_KEY in the release check)`);
      t.ok(/isn't available right now/i.test(r.body?.error ?? ""), `...${who} told "Tidy-up isn't available right now"`, r.body?.error);
    }
    for (const who of REFUSED) t.status(await tidy(who, DRAFT), 403, `${who} refused (403)`);
    t.status(await tidy(null, DRAFT), 401, "signed out 401");
    t.status(await c.get(ROUTE, "MANAGER"), [404, 405], "no GET on the tidy route");

    // (2) The draft, on the server.
    for (const [what, body] of [["an empty draft", { text: "   " }], ["no text", {}], ["over 600 characters", { text: "a".repeat(601) }], ["a $ amount", { text: "bonus of $50 for everyone" }], ["a TFN", { text: "your TFN 123 456 782 is wrong" }], ["bank details", { text: "BSB 062-000 account 12345678" }]])
      t.status(await tidy("MANAGER", body), 400, `${what}: 400`);
    t.status(await tidy("VIEWER", { text: "" }), 403, "the guard comes before the draft checks (VIEWER with a bad draft: 403)");
    const ov = await c.json("/api/attendance/messages", "MANAGER");
    t.ok(ov.status === 200 && ov.body?.tidy === false, "the office view says tidy is off without the key (the button shows it isn't available)", `${ov.status} tidy=${ov.body?.tidy}`);

    // (3) The rules with a stand-in Claude, in a child that can't reach anything.
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (!existsSync(tsxCli)) return t.block("no tsx in the candidate's node_modules - the reply checks were not run");
    {
      const mod = "file:///" + path.join(c.p.appDir, "src", "lib", "signinMessages", "tidy.ts").split(path.sep).join("/");
      const script = path.join(c.p.files, `rc105-tidy-${Date.now().toString(36)}.mts`);
      writeFileSync(script, [
        `import { runTidy, buildTidyPrompt } from ${JSON.stringify(mod)};`,
        `const ON = { ANTHROPIC_API_KEY: "rc105-dummy-not-a-key" };`,
        `const out = {}; const seen = [];`,
        `const say = (reply) => async (p) => { seen.push(p); if (reply instanceof Error) throw reply; return reply; };`,
        `const body = ${JSON.stringify(DRAFT)};`,
        `out.good = await runTidy("rc105-a", body, say("Morning all, please make sure your pre-starts are done before you start.\\n- Ilies"), { env: ON });`,
        `out.promptOnly = seen.length === 1 && Object.keys(seen[0]).sort().join() === "system,user" && JSON.stringify(seen[0]) === JSON.stringify(buildTidyPrompt(body.text.trim()));`,
        `out.noIds = !JSON.stringify(seen).includes("rc105-not-sent") && !JSON.stringify(seen).includes("rc105-a");`,
        `out.wrapped = /^<draft>\\n[\\s\\S]*\\n<\\/draft>$/.test(seen[0]?.user ?? "");`,
        `const bad = { empty: "  ", tooLong: "Please ".repeat(50), money: "Bonus of $50 this week.", tfn: "Your TFN 123 456 782 is wrong.", bank: "BSB 062-000 account 12345678.", quotes: "\\"Please do your pre-starts.\\"", markdown: "**Reminder:** do your pre-starts.", list: "- Pre-starts\\n- Sign out" };`,
        `out.bad = {}; for (const [k, r] of Object.entries(bad)) out.bad[k] = await runTidy("rc105-b", { text: "hi team" }, say(r), { env: ON });`,
        `out.fail = await runTidy("rc105-b", { text: "hi team" }, say(new Error("rc105 boom")), { env: ON });`,
        `const n0 = seen.length;`,
        `out.off = await runTidy("rc105-c", { text: "hi team" }, say("Hi team."), { env: { ...ON, MESSAGE_TIDY: "off" } });`,
        `out.noKey = await runTidy("rc105-c", { text: "hi team" }, say("Hi team."), { env: {} });`,
        `out.offNotCalled = seen.length === n0;`,
        `let made = 0, last = null; for (let i = 0; i < 41; i++) { last = await runTidy("rc105-limit", { text: "hi team" }, say("Hi team."), { env: ON }); if (last.status === 200) made++; else break; }`,
        `out.limit = { made, last };`,
        `console.log("RESULT " + JSON.stringify(out));`,
        `process.exit(0);`,
      ].join("\n"));
      let raw = "";
      try {
        const env = { ...process.env, ...(c.childEnv ?? {}), RELEASE_CHECK_NET_LOG: c.p.netLog, NODE_OPTIONS: `--require "${GUARD.split(path.sep).join("/")}"` };
        delete env.ANTHROPIC_API_KEY; delete env.MESSAGE_TIDY;
        raw = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env, encoding: "utf8", timeout: 120_000 });
      } catch (e) { raw = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
      const line = raw.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
      let r = null;
      try { r = line ? JSON.parse(line.slice(7)) : null; } catch { /* below */ }
      if (!t.ok(!!r, "the reply checks ran with the stand-in Claude", line ? "" : raw.slice(-300))) return;
      t.ok(r.good?.status === 200 && r.good.body?.text === "Morning all, please make sure your pre-starts are done before you start. - Ilies", "a good reply fills the box, folded the way a message is kept (sign-off kept)", JSON.stringify(r.good));
      t.ok(r.promptOnly && r.wrapped, "Claude gets only { system, user } - the draft wrapped in <draft>...</draft>");
      t.ok(r.noIds, "...never the person ids from the body or the login");
      for (const k of ["empty", "money", "tfn", "bank", "quotes", "markdown", "list"])
        t.ok(r.bad?.[k]?.status === 422 && r.bad[k].body?.error === "Couldn't tidy that one - edit it yourself", `a reply that's ${k}: 422 "Couldn't tidy that one - edit it yourself"`, JSON.stringify(r.bad?.[k]));
      t.ok(r.bad?.tooLong?.status === 422 && /over 300 characters - shorten/.test(r.bad.tooLong.body?.error ?? "") && !("text" in (r.bad.tooLong.body ?? {})), "a reply over 300 characters: 422 asking to shorten it - never cut", JSON.stringify(r.bad?.tooLong));
      t.ok(r.fail?.status === 502 && !JSON.stringify(r.fail).includes("boom"), "Claude failing: 502, the error not passed on", JSON.stringify(r.fail));
      t.ok(r.off?.status === 503 && r.noKey?.status === 503 && r.offNotCalled, "MESSAGE_TIDY=off and no key: 503, Claude never called", `${r.off?.status} ${r.noKey?.status} ${r.offNotCalled}`);
      t.ok(r.limit?.made === 40 && r.limit?.last?.status === 429, "40 tidies a day per login, the 41st refused (429)", JSON.stringify(r.limit));
      t.ok(Object.values(r.bad ?? {}).every((x) => noMoney(JSON.stringify(x))), "no $ figure in any refusal");
    }

    // (4) Never sends, nothing leaves.
    t.ok((await count()) === count0, "no message created by tidying", `${(await count()) - count0} new`);
    t.ok(replies.every((x) => noMoney(x)), `no $ figure in any of the ${replies.length} tidy replies`);
    t.ok(netLines(c) === net0, "no outbound connection attempted during this check (server and the child)");
  },
};
