// Release check (27 Oct 2026): small shared helpers - running commands with a timeout, hashing, ports, killing a
// process tree we started (never by image name: other agents run node too).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import net from "node:net";

// Run a command; never throws. Output is captured (and capped), not printed, unless `echo` is set.
export function run(cmd, args, { cwd, env, timeoutMs = 600_000, echo = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "", timedOut = false;
    const cap = (s) => { out += s; if (out.length > 400_000) out = out.slice(-300_000); if (echo) process.stdout.write(s); };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: String(e), timedOut: false, ms: 0 });
    }
    child.stdout.on("data", (d) => cap(d.toString()));
    child.stderr.on("data", (d) => cap(d.toString()));
    const t = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.on("error", (e) => cap(`\n[spawn error] ${e.message}\n`));
    child.on("close", (code) => { clearTimeout(t); resolve({ code: timedOut ? -2 : code ?? -1, out, timedOut, ms: Date.now() - started }); });
  });
}

// npm, run as `node <npm-cli.js>` so no shell is needed on Windows (.cmd files can't be spawned directly).
export function npmCommand() {
  const cli = process.env.npm_execpath;
  if (cli && /\.(c?js|mjs)$/i.test(cli)) return { cmd: process.execPath, pre: [cli] };
  return null;
}

export function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
}

export const sha256File = (file) => new Promise((resolve, reject) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});

// Is anything listening on 127.0.0.1:<port>?
export const portInUse = (port) => new Promise((resolve) => {
  const s = net.connect({ host: "127.0.0.1", port });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
  s.setTimeout(1500, () => { s.destroy(); resolve(false); });
});

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Today's date and the Monday of last week, in Sydney (the app's own day boundary).
export const sydneyDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);
export function mondayOf(dateStr, weeksBack = 0) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow - 7 * weeksBack);
  return d.toISOString().slice(0, 10);
}

// Text that may reach the console or a report: no cookies, tokens, link secrets or passwords.
export function scrub(text) {
  return String(text ?? "")
    .replace(/(operate_session|session)=[^;\s"]+/gi, "$1=[hidden]")
    .replace(/\/(api\/)?site\/(in\/)?[A-Za-z0-9_\-.%]{20,}/g, "/$1site/$2<token>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [hidden]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[token]")
    .replace(/("?password"?\s*[:=]\s*"?)[^"&\s,}]+/gi, "$1[hidden]");
}
