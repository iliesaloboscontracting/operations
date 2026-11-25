#!/usr/bin/env node
// SD-002 (Ilies approved 26 Nov 2026): prep a COPY of live data for the release check - no incident reports and no
// signature images in it (lib/prep.mjs prepCopy). It changes the file you give it, so give it a copy:
//
//   copy the server's backup to e.g. prisma\rc-1126-prepped.db, then
//   node scripts/release-check/prep-snapshot.mjs prisma\rc-1126-prepped.db
//
// Refuses prisma/dev.db, anything under /srv and anything that isn't a .db file.
import { existsSync } from "node:fs";
import path from "node:path";
import { isClean, prepCopy, sensitiveRows } from "./lib/prep.mjs";

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error("Usage: node scripts/release-check/prep-snapshot.mjs <a COPY of the database (.db)>"); process.exit(2); }
const abs = path.resolve(file);
if (!/\.db$/i.test(abs) || /[\\/]dev\.db$/i.test(abs) || /^\/srv\//.test(abs.replace(/\\/g, "/"))) {
  console.error(`Refusing ${abs} - give it a COPY (not dev.db, not the server's).`);
  process.exit(2);
}
const before = sensitiveRows(abs);
const done = prepCopy(abs);
const after = sensitiveRows(abs);
console.log(`Prepped ${path.basename(abs)}: ${JSON.stringify(done)}`);
console.log(`Before ${JSON.stringify(before)} -> after ${JSON.stringify(after)}`);
if (!isClean(after)) { console.error("Still has incident or signature data - not usable as a snapshot."); process.exit(1); }
console.log("Clean - use it with --snapshot.");