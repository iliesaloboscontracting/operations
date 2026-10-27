// Release check: start the built app on 127.0.0.1:<port> with the outbound guard preloaded; stop it by its own PID tree.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { killTree, portInUse, sleep } from "./util.mjs";

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "outbound-guard.cjs");

export async function startServer(p, env, port) {
  if (await portInUse(port)) return { error: `127.0.0.1:${port} is already in use - stop that server first (by its PID, never all node processes).` };
  const nextBin = path.join(p.appDir, "node_modules", "next", "dist", "bin", "next");
  const log = createWriteStream(p.serverLog);
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: p.appDir,
    env: { ...env, NODE_ENV: "production", RELEASE_CHECK_NET_LOG: p.netLog, NODE_OPTIONS: `--require "${GUARD.split(path.sep).join("/")}"` },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let exited = null;
  child.on("exit", (code) => { exited = code ?? -1; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 90; i++) {
    if (exited !== null) return { error: `the server exited (code ${exited}) - see its log`, pid: child.pid };
    try { const r = await fetch(base + "/login", { redirect: "manual" }); if (r.status < 500) return { pid: child.pid, base, child }; } catch { /* not up yet */ }
    await sleep(1000);
  }
  killTree(child.pid);
  return { error: "the server didn't answer within 90 s", pid: child.pid };
}

export async function stopServer(srv, port) {
  if (srv?.pid) killTree(srv.pid);
  for (let i = 0; i < 15; i++) { if (!(await portInUse(port))) return true; await sleep(500); }
  return false;
}
