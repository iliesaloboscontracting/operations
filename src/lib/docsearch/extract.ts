// LCI phase 6: text out of a document - PDF, Word .docx, Excel .xlsx, plain text. Anything else, a scan with no text
// layer, or a broken file is "not readable" - listed, never guessed at. Design: docs/lci/PHASE6-DESIGN.md §2 (limits
// D6-9).
//
// DS-015 (security review, Ilies approved 27 Oct 2026): the reading runs in a worker thread (extract-worker.mjs ->
// extract-core.mjs) with a 512 MB heap cap, stopped after 60 s - a hostile or huge file is "not readable" instead of
// taking the app down. An .xlsx that would unpack past 100 MB is refused from its zip directory, before it's opened.
import path from "path";
import { Worker } from "worker_threads";
import { MAX_CHARS, MAX_PDF_PAGES, MAX_XLSX_UNPACKED, zipUnpackedSize } from "./extract-core.mjs";

export { MAX_CHARS, MAX_PDF_PAGES, MAX_XLSX_UNPACKED };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const WORKER_TIMEOUT_MS = 60_000;
export const WORKER_LIMITS = { maxOldGenerationSizeMb: 512 } as const;

export type Extracted = { status: "OK"; text: string } | { status: "UNREADABLE" | "TOO_BIG" | "UNSUPPORTED"; text: ""; why: string };
export const SUPPORTED = ["pdf", "docx", "xlsx", "txt", "csv", "md"] as const;
export const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
export const isSupported = (name: string) => (SUPPORTED as readonly string[]).includes(extOf(name));

const fail = (status: "UNREADABLE" | "TOO_BIG" | "UNSUPPORTED", why: string): Extracted => ({ status, text: "", why });

// The worker script, from the app folder at run time (next start and the tests both run from the repo root), so the
// bundler never rewrites it.
const workerFile = () => path.join(process.cwd(), "src", "lib", "docsearch", "extract-worker.mjs");

function inWorker(ext: string, buf: Buffer, timeoutMs: number): Promise<Extracted> {
  return new Promise((resolve) => {
    let done = false;
    const w = new Worker(workerFile(), { workerData: { ext, bytes: buf }, resourceLimits: WORKER_LIMITS });
    const finish = (r: Extracted) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.terminate().catch(() => undefined);
      resolve(r);
    };
    const timer = setTimeout(() => finish(fail("UNREADABLE", "took too long to read")), timeoutMs);
    w.once("message", (r: Extracted) => finish(r?.status === "OK" && typeof r.text === "string" ? r : fail("UNREADABLE", (r as { why?: string })?.why ?? "the file couldn't be opened")));
    w.once("error", () => finish(fail("UNREADABLE", "the file couldn't be opened")));
    w.once("exit", () => finish(fail("UNREADABLE", "the file couldn't be opened")));
  });
}

export async function extractText(name: string, buf: Buffer, opts: { timeoutMs?: number } = {}): Promise<Extracted> {
  const ext = extOf(name);
  if (!isSupported(name)) return fail("UNSUPPORTED", ext ? `.${ext} files aren't read` : "no file type");
  if (buf.length > MAX_FILE_BYTES) return fail("TOO_BIG", "over 25 MB");
  if (ext === "xlsx") {
    const unpacked = zipUnpackedSize(buf);
    if (unpacked === null) return fail("UNREADABLE", "the file couldn't be opened");
    if (unpacked > MAX_XLSX_UNPACKED) return fail("TOO_BIG", "over 100 MB unpacked");
  }
  return inWorker(ext, buf, opts.timeoutMs ?? WORKER_TIMEOUT_MS);
}
