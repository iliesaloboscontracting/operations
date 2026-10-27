// LCI phase 6: just enough of a zip reader to take one file out of a .docx (or any zip), with Node's own zlib - no
// library. Since DS-015 the code lives in extract-core.mjs (plain JavaScript, so the extraction worker can load it);
// this file keeps the TypeScript import path. `npm test` (docsearch.test.ts).
export { docxText, zipDirectory, zipEntry, zipUnpackedSize } from "./extract-core.mjs";
