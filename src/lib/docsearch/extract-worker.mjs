// LCI phase 6 / RT-002: one document's text, read in its OWN PROCESS - started by extract.ts with a 512 MB heap cap,
// an OS memory limit on Linux (prlimit --data, which also counts the off-heap buffers pdf.js and exceljs use), a memory
// watchdog and a 60 s stop, so a hostile or huge file can't take the app down. The file type is argv[2], the bytes
// arrive on stdin, and one JSON answer goes to stdout. It is started with no secrets in its environment. Plain
// JavaScript, loaded by Node from the app folder (no bundler step); unpdf and exceljs come from node_modules.
import { writeFileSync } from "node:fs";
import { extractCore } from "./extract-core.mjs";

// If the server ever runs short of memory, the kernel stops this process before the app.
try { writeFileSync("/proc/self/oom_score_adj", "1000"); } catch { /* not Linux */ }

const ext = process.argv[2] ?? "";
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const r = await extractCore(ext, Buffer.concat(chunks)).catch(() => ({ status: "UNREADABLE", text: "", why: "the file couldn't be opened" }));
process.stdout.write(JSON.stringify(r), () => process.exit(0));
