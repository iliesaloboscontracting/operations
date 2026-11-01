// LCI phase 6: text out of a document - PDF, Word .docx, Excel .xlsx, plain text. Anything else, a scan with no text
// layer, or a broken file is "not readable" - listed, never guessed at. Design: docs/lci/PHASE6-DESIGN.md §2 (limits
// D6-9).
//
// DS-015 (security review, Ilies approved 27 Oct 2026) and RT-002 (Ilies, 1 Nov 2026, before switching search on): the
// reading runs in a separate process (extract-worker.mjs -> extract-core.mjs), never inside the app, with
//   - a 512 MB heap cap (--max-old-space-size);
//   - on Linux, an OS memory limit (prlimit --data, 1 GB), which counts the off-heap buffers a worker thread's heap
//     cap missed, plus a watchdog that stops it past 1 GB resident, and oom_score_adj 1000 so the kernel picks it
//     before the app;
//   - a 60 s stop;
//   - an environment holding only PATH (no API keys, no AUTH_SECRET).
// A hostile or huge file is "not readable" instead of taking the app down. An .xlsx that would unpack past 100 MB is
// refused from its zip directory, before it's opened.
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { MAX_CHARS, MAX_PDF_PAGES, MAX_XLSX_UNPACKED, zipUnpackedSize } from "./extract-core.mjs";

export { MAX_CHARS, MAX_PDF_PAGES, MAX_XLSX_UNPACKED };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const WORKER_TIMEOUT_MS = 60_000;
export const WORKER_LIMITS = { heapMb: 512, dataBytes: 1024 * 1024 * 1024, rssMb: 1024 } as const;
const MAX_ANSWER_BYTES = MAX_CHARS * 6 + 4096; // the JSON answer: text up to MAX_CHARS, escaped
const PRLIMIT = "/usr/bin/prlimit";

export type Extracted = { status: "OK"; text: string } | { status: "UNREADABLE" | "TOO_BIG" | "UNSUPPORTED"; text: ""; why: string };
export const SUPPORTED = ["pdf", "docx", "xlsx", "txt", "csv", "md"] as const;
export const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
export const isSupported = (name: string) => (SUPPORTED as readonly string[]).includes(extOf(name));

const fail = (status: "UNREADABLE" | "TOO_BIG" | "UNSUPPORTED", why: string): Extracted => ({ status, text: "", why });

// The worker script, from the app folder at run time (next start and the tests both run from the repo root), so the
// bundler never rewrites it.
const workerFile = () => path.join(process.cwd(), "src", "lib", "docsearch", "extract-worker.mjs");

// A worker's answer, trusted only in the shapes it may take.
const fromWorker = (r: unknown): Extracted => {
  const x = r as { status?: string; text?: unknown; why?: unknown };
  if (x?.status === "OK" && typeof x.text === "string") return { status: "OK", text: x.text.slice(0, MAX_CHARS) };
  const why = typeof x?.why === "string" ? x.why.slice(0, 200) : "the file couldn't be opened";
  return fail(x?.status === "TOO_BIG" ? "TOO_BIG" : "UNREADABLE", why);
};

// The child's environment: PATH only (and, on Windows, what Node needs to start). Never the app's secrets.
export function workerEnv(env: Record<string, string | undefined> = process.env, platform = process.platform): NodeJS.ProcessEnv {
  const out: Record<string, string> = { PATH: env.PATH ?? env.Path ?? "" };
  if (platform === "win32") for (const k of ["SystemRoot", "TEMP", "TMP"]) if (env[k]) out[k] = env[k] as string;
  return out as NodeJS.ProcessEnv;
}

// The command line: node with the heap cap, under prlimit's data limit on Linux when it's there. DSO-003 (Ilies approved
// 1 Nov 2026): on the Linux server (production) with no prlimit, null - nothing is read rather than read without the
// OS limit.
export function workerCommand(file: string, ext: string, heapMb: number, platform = process.platform, hasPrlimit = existsSync(PRLIMIT), production = process.env.NODE_ENV === "production") {
  const node = [process.execPath, `--max-old-space-size=${heapMb}`, file, ext];
  if (platform === "linux" && hasPrlimit) return { cmd: PRLIMIT, args: [`--data=${WORKER_LIMITS.dataBytes}`, "--", ...node] };
  if (platform === "linux" && production) return null;
  return { cmd: node[0], args: node.slice(1) };
}
let warnedNoLimit = false;

// Resident memory of a Linux process in MB, or null (not Linux, or gone).
function rssMb(pid: number): number | null {
  try {
    const m = readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+)\s+kB/m);
    return m ? Number(m[1]) / 1024 : null;
  } catch { return null; }
}

// `test`: the tests only - a stand-in worker script (one that loops, or eats memory) and smaller caps.
type Opts = { timeoutMs?: number; test?: { workerFile?: string; heapMb?: number; rssMb?: number } };

function inWorker(ext: string, buf: Buffer, opts: Opts): Promise<Extracted> {
  const command = workerCommand(opts.test?.workerFile ?? workerFile(), ext, opts.test?.heapMb ?? WORKER_LIMITS.heapMb);
  if (!command) {
    if (!warnedNoLimit) { warnedNoLimit = true; console.error("document search: /usr/bin/prlimit is missing - nothing is read until it's back (DSO-003)"); }
    return Promise.resolve(fail("UNREADABLE", "the server can't limit memory for reading"));
  }
  const { cmd, args } = command;
  return new Promise((resolve) => {
    let done = false;
    const child = spawn(cmd, args, { cwd: process.cwd(), env: workerEnv(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const out: Buffer[] = [];
    let outBytes = 0;
    const finish = (r: Extracted) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve(r);
    };
    const timer = setTimeout(() => finish(fail("UNREADABLE", "took too long to read")), opts.timeoutMs ?? WORKER_TIMEOUT_MS);
    const rssLimit = opts.test?.rssMb ?? WORKER_LIMITS.rssMb;
    const watch = setInterval(() => {
      const mb = child.pid ? rssMb(child.pid) : null;
      if (mb !== null && mb > rssLimit) finish(fail("TOO_BIG", "needed too much memory to read"));
    }, 200);
    child.stdout.on("data", (c: Buffer) => {
      outBytes += c.length;
      if (outBytes > MAX_ANSWER_BYTES) return finish(fail("UNREADABLE", "the file couldn't be opened"));
      out.push(c);
    });
    child.once("error", () => finish(fail("UNREADABLE", "the file couldn't be opened")));
    child.once("close", (code) => {
      if (code !== 0) return finish(fail("UNREADABLE", "the file couldn't be opened"));
      try { finish(fromWorker(JSON.parse(Buffer.concat(out).toString("utf8")))); } catch { finish(fail("UNREADABLE", "the file couldn't be opened")); }
    });
    child.stdin.on("error", () => undefined); // a child that exits early (or never reads) closes the pipe
    child.stdin.end(buf);
  });
}

export async function extractText(name: string, buf: Buffer, opts: Opts = {}): Promise<Extracted> {
  const ext = extOf(name);
  if (!isSupported(name)) return fail("UNSUPPORTED", ext ? `.${ext} files aren't read` : "no file type");
  if (buf.length > MAX_FILE_BYTES) return fail("TOO_BIG", "over 25 MB");
  if (ext === "xlsx") {
    const unpacked = zipUnpackedSize(buf);
    if (unpacked === null) return fail("UNREADABLE", "the file couldn't be opened");
    if (unpacked > MAX_XLSX_UNPACKED) return fail("TOO_BIG", "over 100 MB unpacked");
  }
  return inWorker(ext, buf, opts);
}
