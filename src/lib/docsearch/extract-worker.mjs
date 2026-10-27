// LCI phase 6 / DS-015: one document's text, read in its own worker thread - started by extract.ts with a 512 MB heap
// cap and stopped after 60 s, so a hostile or huge file can't take the app down. Plain JavaScript, loaded by Node from
// the app folder (no bundler step); unpdf and exceljs come from node_modules.
import { parentPort, workerData } from "node:worker_threads";
import { extractCore } from "./extract-core.mjs";

const { ext, bytes } = workerData;
extractCore(ext, Buffer.from(bytes)).then(
  (r) => parentPort.postMessage(r),
  () => parentPort.postMessage({ status: "UNREADABLE", text: "", why: "the file couldn't be opened" }),
);
