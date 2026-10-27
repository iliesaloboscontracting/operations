#!/usr/bin/env node
// The shared release check (27 Oct 2026). ONE command that builders run before handover and the release agent runs
// on the integrated candidate:
//
//   npm run release-check -- --snapshot <path to a SQLite copy of live data> [--app <checkout>] [--port 3001]
//                            [--accept-data-loss] [--out <report folder>] [--keep-build] [--no-audit] [--only a,b]
//
// It copies the snapshot to <app>/prisma/test.db, writes a test .env (no phone-alert, Xero, Graph, AI or
// server-to-server keys), records row counts, runs `prisma db push` (stops on any data-loss warning), creates
// throwaway logins and site links, builds, starts the app on 127.0.0.1:<port> with every outbound connection blocked
// and logged, runs every check, prints a PASS / FAIL / BLOCKED / SKIPPED table, writes a Markdown + JSON report, then
// stops the server and deletes the test DB, the test .env, the test files and (unless --keep-build) .next.
// Exit code: 0 all passed, 1 something failed, 2 something was blocked (nothing failed). See README.md.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AUDIT_EXCEPTIONS, EXPECTED_NOTES } from "./expected.mjs";
import { judgeAudit } from "./lib/audit.mjs";
import { makeContext, makeTally } from "./lib/context.mjs";
import { startServer, stopServer } from "./lib/server.mjs";
import { childEnv, compareCounts, copySnapshot, dbPush, ENV_MARKER, makeLinks, makeSpecialUsers, makeUsers, paths, prismaFor, refusals, rowCounts, writeEnv } from "./lib/setup.mjs";
import { npmCommand, run, scrub, sha256File, sydneyDate } from "./lib/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { values: o } = parseArgs({
  options: {
    snapshot: { type: "string" }, app: { type: "string" }, port: { type: "string", default: "3001" }, out: { type: "string" },
    "accept-data-loss": { type: "boolean", default: false }, "keep-build": { type: "boolean", default: false },
    "no-audit": { type: "boolean", default: false }, "skip-build": { type: "boolean", default: false }, only: { type: "string" }, help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});
if (o.help) { console.log(readFileSync(path.join(HERE, "README.md"), "utf8")); process.exit(0); }

const appDir = path.resolve(o.app ?? path.join(HERE, "..", ".."));
const port = Number(o.port);
const runTmp = mkdtempSync(path.join(os.tmpdir(), "operations-release-check-"));
const p = paths(appDir, runTmp);
const results = [];
const started = new Date();
const only = o.only ? new Set(o.only.split(",").map((s) => s.trim())) : null;
const wanted = (id) => !only || only.has(id);

function record(id, title, status, reason, ms, items = []) {
  results.push({ id, title, status, reason: reason ? scrub(reason).slice(0, 400) : null, ms, items });
  const tag = { PASS: "PASS   ", FAIL: "FAIL   ", BLOCKED: "BLOCKED", SKIPPED: "SKIPPED" }[status];
  console.log(`${tag} ${id} (${(ms / 1000).toFixed(1)} s)${reason ? " - " + scrub(reason).slice(0, 200) : ""}`);
  for (const it of items) if (it.ok === false) console.log(`          FAIL ${it.name}${it.detail ? " -> " + it.detail : ""}`);
}
async function command(id, title, cmd, args, opts, judge) {
  if (!wanted(id)) return;
  const r = await run(cmd, args, opts);
  const j = judge ? judge(r) : { status: r.code === 0 ? "PASS" : "FAIL", reason: r.code === 0 ? null : (r.timedOut ? "timed out" : `exit ${r.code}: ${r.out.trim().split(/\r?\n/).slice(-6).join(" | ")}`) };
  record(id, title, j.status, j.reason, r.ms, j.items ?? []);
  return r;
}
const git = (args, dir = appDir) => run("git", ["-C", dir, ...args], { timeoutMs: 20_000 }).then((r) => (r.code === 0 ? r.out.trim() : ""));

// ---- 0. refuse anything unsafe --------------------------------------------------------------------------------
const refused = refusals(p, { snapshot: o.snapshot, port });
if (refused.length) {
  for (const r of refused) console.error("REFUSED: " + r);
  rmSync(runTmp, { recursive: true, force: true });
  process.exit(2);
}

const meta = {
  started: started.toISOString(), appDir, port,
  candidate: { commit: await git(["rev-parse", "HEAD"]), branch: await git(["rev-parse", "--abbrev-ref", "HEAD"]), dirty: (await git(["status", "--porcelain", "--untracked-files=no"])).length > 0 },
  tool: { commit: await git(["rev-parse", "HEAD"], HERE) },
  node: process.version, platform: `${process.platform} ${os.release()}`,
  lockfileSha256: existsSync(path.join(appDir, "package-lock.json")) ? await sha256File(path.join(appDir, "package-lock.json")) : null,
  snapshot: { file: path.basename(o.snapshot), bytes: statSync(o.snapshot).size, modified: statSync(o.snapshot).mtime.toISOString(), sha256: await sha256File(o.snapshot) },
  acceptDataLoss: o["accept-data-loss"],
};
console.log(`Release check - candidate ${meta.candidate.branch} @ ${meta.candidate.commit.slice(0, 7)}${meta.candidate.dirty ? " (UNCOMMITTED CHANGES)" : ""}, snapshot ${meta.snapshot.file}, node ${meta.node}`);
const pre = { defaultIndexExisted: existsSync(p.defaultSearchIndex) };

let srv = null, db = null;
try {
  // ---- 1-2. the test copy and its .env ---------------------------------------------------------------------------
  copySnapshot(p, o.snapshot);
  const testEnv = writeEnv(p, port);
  const env = childEnv(testEnv);
  // Static checks get the shell environment minus the forbidden keys, NOT the test settings (e.g. unit tests read
  // DAILY_LOG_REMINDER themselves and must see it unset, as on a builder machine).
  const staticEnv = childEnv({});
  const npm = npmCommand();
  const npmRun = (script, extra = []) => npm ? [npm.cmd, [...npm.pre, "run", script, ...extra]] : ["npm", ["run", script, ...extra]];

  // ---- static checks (no server) ---------------------------------------------------------------------------------
  if (!meta.candidate.commit) record("candidate-clean", "Candidate commit identified", "BLOCKED", "git isn't available (put git on PATH) - results can't be tied to a commit", 0);
  else if (meta.candidate.dirty) record("candidate-clean", "Candidate has no uncommitted changes", "FAIL", "tracked files have uncommitted changes - results would not match a commit", 0);
  else record("candidate-clean", "Candidate has no uncommitted changes", "PASS", null, 0);
  await command("typecheck", "TypeScript (tsc --noEmit)", process.execPath, [path.join(appDir, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: appDir, env: staticEnv, timeoutMs: 900_000 });
  const [tc, ta] = npmRun("test");
  await command("unit-tests", "Unit tests (npm test)", tc, ta, { cwd: appDir, env: staticEnv, timeoutMs: 900_000 }, (r) => {
    const pass = Number(r.out.match(/ℹ pass (\d+)/)?.[1] ?? NaN), fail = Number(r.out.match(/ℹ fail (\d+)/)?.[1] ?? NaN);
    const fails = [...r.out.matchAll(/^✖ (.+)$/gm)].map((m) => m[1]).slice(0, 10);
    return { status: r.code === 0 && fail === 0 ? "PASS" : "FAIL", reason: `${pass} passed, ${fail} failed${r.timedOut ? ", timed out" : ""}${fails.length ? ": " + fails.join(" | ") : ""}` };
  });
  if (wanted("lint")) {
    const cfg = readdirSync(appDir).filter((f) => /^(\.eslintrc(\..+)?|eslint\.config\.(js|mjs|cjs|ts))$/.test(f));
    if (!cfg.length) record("lint", "Lint", "SKIPPED", "no ESLint configuration in the repo (`next lint` would stop to ask) - lint is not a configured check yet", 0);
    else { const [lc, la] = npmRun("lint"); await command("lint", "Lint (npm run lint)", lc, la, { cwd: appDir, env: staticEnv, timeoutMs: 600_000 }); }
  }
  // The release check's own unit tests (the audit gate and its exceptions) - a broken gate must never pass silently.
  await command("tool-selftest", "Release-check self-tests (node --test scripts/release-check)", process.execPath, ["--test", path.join(HERE, "lib", "audit.test.mjs")],
    { cwd: HERE, env: staticEnv, timeoutMs: 120_000 }, (r) => ({ status: r.code === 0 ? "PASS" : "FAIL", reason: `${r.out.match(/ℹ pass (\d+)/)?.[1] ?? "?"} passed, ${r.out.match(/ℹ fail (\d+)/)?.[1] ?? "?"} failed` }));
  if (wanted("audit")) {
    if (o["no-audit"]) record("audit", "npm audit (production dependencies)", "SKIPPED", "--no-audit given: needs the release owner's recorded exception", 0);
    else {
      const ac = npm ? [npm.cmd, [...npm.pre, "audit", "--omit=dev", "--json"]] : ["npm", ["audit", "--omit=dev", "--json"]];
      let nextVersion = null;
      try { nextVersion = JSON.parse(readFileSync(path.join(appDir, "node_modules", "next", "package.json"), "utf8")).version; } catch { /* not installed */ }
      await command("audit", "npm audit (production dependencies; moderate+ fails unless accepted in expected.mjs)", ac[0], ac[1], { cwd: appDir, env: staticEnv, timeoutMs: 180_000 }, (r) => {
        let j = null; try { j = JSON.parse(r.out.slice(r.out.indexOf("{"))); } catch { /* not JSON */ }
        const res = judgeAudit(j, AUDIT_EXCEPTIONS, { today: sydneyDate(), nextVersion });
        return { status: res.status, reason: res.status === "BLOCKED" ? `${res.reason}: ${r.out.trim().slice(-160)}` : res.reason };
      });
    }
  }

  // ---- 3-5. row counts, schema push, row counts --------------------------------------------------------------------
  let t0 = Date.now();
  const before = rowCounts(p.testDb);
  const push = await dbPush(p, env, o["accept-data-loss"]);
  let setupOk = push.ok;
  if (push.ok) {
    const after = rowCounts(p.testDb);
    const d = compareCounts(before, after);
    const ok = !d.dropped.length && !d.changed.length;
    record("schema-push", "prisma db push on the copy; row counts unchanged", ok ? "PASS" : "FAIL",
      `${Object.keys(before).length} tables before, ${Object.keys(after).length} after; new: ${d.added.join(", ") || "none"}; dropped: ${d.dropped.join(", ") || "none"}; changed counts: ${d.changed.join("; ") || "none"}${push.accepted ? "; DATA-LOSS WARNING ACCEPTED: " + push.warnings.join(" | ") : ""}`, Date.now() - t0);
    meta.rowCounts = { tablesBefore: Object.keys(before).length, tablesAfter: Object.keys(after).length, added: d.added, dropped: d.dropped, changed: d.changed, rowsBefore: Object.values(before).reduce((a, b) => a + b, 0) };
    if (!ok) setupOk = false;
  } else record("schema-push", "prisma db push on the copy; row counts unchanged", push.warnings.length ? "FAIL" : "BLOCKED", `${push.error}${push.warnings.length ? ": " + push.warnings.join(" | ") : ": " + push.out.trim().split(/\r?\n/).slice(-4).join(" | ")}`, Date.now() - t0);

  // ---- 6. build - before this process loads the Prisma engine (on Windows a loaded engine blocks `prisma generate`) --
  if (setupOk && o["skip-build"]) {
    // Development of the checks only: reuses an existing .next - never a release result.
    if (existsSync(path.join(appDir, ".next", "BUILD_ID"))) record("build", "Production build", "SKIPPED", "--skip-build: reused the existing .next (not a release result)", 0);
    else { record("build", "Production build", "BLOCKED", "--skip-build but there is no .next to reuse", 0); setupOk = false; }
  } else if (setupOk) {
    const [bc, ba] = npmRun("build");
    const b = await command("build", "Production build (npm run build)", bc, ba, { cwd: appDir, env, timeoutMs: 1_200_000 });
    if (!b || b.code !== 0) setupOk = false;
  }

  // ---- 7. throwaway logins and links, then start -------------------------------------------------------------------
  let users = null, links = null;
  if (setupOk) {
    t0 = Date.now();
    try {
      db = prismaFor(p);
      users = await makeUsers(db);
      const special = await makeSpecialUsers(db, appDir);
      Object.assign(users, special.users);
      links = await makeLinks(db);
      record("test-logins", "Throwaway logins (8 roles + owner + Operations AI) and site links on the copy", "PASS",
        [...special.notes, links.missing.length && `links missing: ${links.missing.join("; ")}`].filter(Boolean).join("; "), Date.now() - t0);
    } catch (e) { setupOk = false; record("test-logins", "Throwaway logins and site links", "BLOCKED", e.message, Date.now() - t0); }
  }
  if (setupOk) {
    t0 = Date.now();
    srv = await startServer(p, env, port);
    if (srv.error) { record("server-start", `Start on 127.0.0.1:${port}`, "BLOCKED", srv.error, Date.now() - t0); setupOk = false; }
    else record("server-start", `Start on 127.0.0.1:${port} (outbound guard on)`, "PASS", null, Date.now() - t0);
  }

  // ---- 8. the checks ------------------------------------------------------------------------------------------------
  const modules = readdirSync(path.join(HERE, "checks")).filter((f) => f.endsWith(".mjs")).sort();
  const ctx = setupOk ? makeContext({ base: srv.base, p, db, users, links, port, options: o }) : null;
  if (ctx) Object.assign(ctx, { childEnv: env, pre });
  for (const f of modules) {
    const mod = (await import(pathToFileURL(path.join(HERE, "checks", f)).href)).default;
    if (!wanted(mod.id)) continue;
    if (!ctx) { record(mod.id, mod.title, "BLOCKED", "setup failed (see above)", 0); continue; }
    const applies = mod.applies ? mod.applies(ctx) : true;
    if (applies !== true) { record(mod.id, mod.title, "SKIPPED", `not applicable: ${applies}`, 0); continue; }
    const t = makeTally(); const s = Date.now();
    let err = null;
    try {
      await Promise.race([mod.run(t, ctx), new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${(mod.timeoutMs ?? 240_000) / 1000} s`)), mod.timeoutMs ?? 240_000))]);
    } catch (e) { err = e; }
    const failed = t.items.filter((i) => i.ok === false).length, passed = t.items.filter((i) => i.ok === true).length;
    const status = err || failed ? "FAIL" : t.blocked ? "BLOCKED" : t.skipped ? "SKIPPED" : "PASS";
    record(mod.id, mod.title, status, [err && `error: ${err.message}`, `${passed} passed, ${failed} failed`, t.blocked && `blocked: ${t.blocked}`, t.skipped && `skipped: ${t.skipped}`].filter(Boolean).join("; "), Date.now() - s, t.items);
  }

  // ---- viewer-safety (the candidate's own script) -------------------------------------------------------------------
  if (wanted("viewer-safety")) {
    if (!ctx) record("viewer-safety", "Viewer money wall (scripts/check-viewer-safety.ts)", "BLOCKED", "setup failed", 0);
    else await command("viewer-safety", "Viewer money wall (scripts/check-viewer-safety.ts)", process.execPath,
      [path.join(appDir, "node_modules", "tsx", "dist", "cli.mjs"), path.join(appDir, "scripts", "check-viewer-safety.ts")],
      { cwd: appDir, env: { ...env, BASE_URL: srv.base }, timeoutMs: 300_000 }, (r) => ({
        status: r.code === 0 ? "PASS" : "FAIL",
        reason: (r.out.match(/(\d+\/\d+) passed/)?.[1] ?? "?") + " passed" + (r.code === 0 ? "" : ": " + [...r.out.matchAll(/^FAIL\s+(.+)$/gm)].map((m) => m[1]).slice(0, 6).join(" | ")),
      }));
  }
} catch (e) {
  record("runner", "Release-check runner", "FAIL", `unexpected error: ${e.stack ?? e.message}`, 0);
} finally {
  // ---- 10. stop and clean up -----------------------------------------------------------------------------------------
  const t0 = Date.now();
  const stopped = srv?.pid ? await stopServer(srv, port) : true;
  try { await db?.$disconnect(); } catch { /* ignore */ }
  // Outbound attempts the guard blocked (read before the temp folder goes).
  let net = [];
  try { net = readFileSync(p.netLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no log = no server */ }
  if (srv?.pid) record("no-outbound", "No outbound connection attempted by the test server", net.length ? "FAIL" : "PASS",
    net.length ? `blocked attempts: ${[...new Set(net.map((n) => `${n.host}:${n.port}`))].join(", ")}` : "0 attempts to non-loopback hosts", 0);
  let serverErrors = [];
  try { serverErrors = readFileSync(p.serverLog, "utf8").split(/\r?\n/).filter((l) => /error|unhandled/i.test(l)).slice(-15); } catch { /* none */ }
  for (const f of [p.testDb, p.testDb + "-journal", p.testDb + "-wal", p.testDb + "-shm", path.join(p.prismaDir, "rc-probe-search.db")]) rmSync(f, { force: true });
  if (existsSync(p.envFile) && readFileSync(p.envFile, "utf8").includes(ENV_MARKER)) rmSync(p.envFile, { force: true });
  if (!pre.defaultIndexExisted && existsSync(p.defaultSearchIndex)) { results.push({ id: "default-index", title: "No index at the default path", status: "FAIL", reason: "an index file appeared at ../operations-search - removed", ms: 0, items: [] }); rmSync(path.dirname(p.defaultSearchIndex), { recursive: true, force: true }); }
  if (!o["keep-build"]) rmSync(path.join(appDir, ".next"), { recursive: true, force: true });
  rmSync(runTmp, { recursive: true, force: true });
  const left = [p.testDb, p.envFile, runTmp].filter((f) => existsSync(f));
  const snapAfter = existsSync(o.snapshot) ? await sha256File(o.snapshot) : null;
  record("cleanup", "Server stopped; test DB, .env, test files removed; snapshot untouched",
    stopped && !left.length && snapAfter === meta.snapshot.sha256 ? "PASS" : "FAIL",
    [!stopped && `port ${port} still answering`, left.length && `left behind: ${left.join(", ")}`, snapAfter !== meta.snapshot.sha256 && "THE SNAPSHOT FILE CHANGED", o["keep-build"] ? ".next kept (--keep-build)" : ".next removed"].filter(Boolean).join("; ") || null, Date.now() - t0);

  // ---- 9. the table and the report --------------------------------------------------------------------------------
  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = { PASS: count("PASS"), FAIL: count("FAIL"), BLOCKED: count("BLOCKED"), SKIPPED: count("SKIPPED") };
  const partial = o["skip-build"] || only || o["no-audit"];
  let overall = summary.FAIL ? "FAIL" : summary.BLOCKED ? "BLOCKED" : "PASS";
  if (overall === "PASS" && partial) overall = "PARTIAL"; // --skip-build / --only / --no-audit: never a release result
  const w = Math.max(...results.map((r) => r.id.length), 5);
  console.log("\n" + "CHECK".padEnd(w) + "  RESULT   TIME     DETAIL");
  for (const r of results) console.log(`${r.id.padEnd(w)}  ${r.status.padEnd(7)}  ${((r.ms / 1000).toFixed(1) + " s").padEnd(7)}  ${(r.reason ?? "").slice(0, 110)}`);
  console.log(`\nOVERALL ${overall} - ${summary.PASS} passed, ${summary.FAIL} failed, ${summary.BLOCKED} blocked, ${summary.SKIPPED} skipped`);
  if (serverErrors.length && overall !== "PASS") console.log("\nServer log (error lines, scrubbed):\n" + serverErrors.map((l) => "  " + scrub(l).slice(0, 200)).join("\n"));

  const outDir = path.resolve(o.out ?? path.join(HERE, "..", "..", "release-check-reports", `${started.toISOString().replace(/[:.]/g, "-")}-${meta.candidate.commit.slice(0, 7)}`));
  mkdirSync(outDir, { recursive: true });
  const report = { meta: { ...meta, finished: new Date().toISOString() }, overall, summary, results, expectedNotes: EXPECTED_NOTES };
  writeFileSync(path.join(outDir, "release-check.json"), JSON.stringify(report, null, 1));
  const md = [
    `# Release check - ${overall}`, "",
    `- Candidate: \`${meta.candidate.branch}\` @ \`${meta.candidate.commit}\`${meta.candidate.dirty ? " **(uncommitted changes)**" : ""}`,
    `- Release-check tool: \`${meta.tool.commit}\``,
    `- Run: ${meta.started} -> ${report.meta.finished}, ${meta.platform}, Node ${meta.node}, port ${port}`,
    `- package-lock.json sha256: \`${meta.lockfileSha256}\``,
    `- Snapshot: \`${meta.snapshot.file}\` (${meta.snapshot.bytes} bytes, modified ${meta.snapshot.modified}, sha256 \`${meta.snapshot.sha256}\`) - copied, never modified, deleted after`,
    `- Result: ${summary.PASS} passed, ${summary.FAIL} failed, ${summary.BLOCKED} blocked, ${summary.SKIPPED} skipped`, "",
    "| Check | Result | Time | Detail |", "|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.status} | ${(r.ms / 1000).toFixed(1)} s | ${(r.reason ?? "").replace(/\|/g, "/")} |`), "",
    "## Assertions", "",
    ...results.filter((r) => r.items.length).flatMap((r) => [`### ${r.id} - ${r.title}`, ...r.items.map((i) => i.note ? `- note: ${i.note}` : `- ${i.ok ? "PASS" : "**FAIL**"} ${i.name}${i.detail ? ` (${i.detail})` : ""}`), ""]),
    "## Known-expected results", "", ...EXPECTED_NOTES.map((n) => `- ${n}`), "",
  ].join("\n");
  writeFileSync(path.join(outDir, "release-check.md"), md);
  console.log(`\nReport: ${outDir}`);
  process.exit(overall === "PASS" ? 0 : overall === "FAIL" ? 1 : 2); // PARTIAL and BLOCKED -> 2
}
