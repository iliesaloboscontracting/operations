// Loads a file of drafted information requests (Task I, 25 Oct 2026) - e.g.
// the lead builder's docs/info-requests/batch-01.json - as DRAFTS for Ilies
// to review on Directors -> Information requests -> Draft questions. NOTHING
// is sent: he ticks and sends them himself. Uses the same reader as the
// owner's "Load a draft file" button (lib/infoRequests), so a file that loads
// here loads there too - that button is the no-script way on the live app.
//
// Usage (PowerShell), against a copy:
//   $env:DATABASE_URL = "file:C:/path/to/copy/prisma/test.db"
//   npx tsx scripts/info-requests-draft.ts docs/info-requests/batch-01.json
// Against the live database it also needs DRAFTS_LIVE_OK=yes - and, under the
// data rules in CLAUDE.md, Ilies's written OK for that run and a backup first.
//
// File format: { "batch": "01 - ...", "items": [ { "to": "Nick Giannopoulos" |
// "Accounts" | an email, "type": "QUESTION" | "FYI", "title", "question",
// "need"?, "why"?, "dueDate"? } ] }. "to" means the DIRECTOR login first,
// then a director-access login; "Accounts" means the ACCOUNTS login. A name
// that doesn't match exactly one login is loaded as "can't send" until fixed.

import fs from "fs";
import { loadDraftFile } from "../src/lib/infoRequests/store";
import { prisma } from "../src/lib/prisma";

const file = process.argv[2];
const by = process.env.DRAFTS_BY || "Lead builder (draft file)";
const db = process.env.DATABASE_URL ?? "";
const stop = (why: string) => { console.error(`Not loading: ${why}`); process.exit(2); };
if (!file) stop("give the draft file, e.g. docs/info-requests/batch-01.json");
if (!/^file:/.test(db)) stop("DATABASE_URL must be set to the exact database (an absolute file: path).");
if ((/(^|[\\/])dev\.db$/i.test(db.replace(/^file:/, "")) || /\/srv\//.test(db)) && process.env.DRAFTS_LIVE_OK !== "yes") {
  stop("that's the live database - set DRAFTS_LIVE_OK=yes only with Ilies's written OK and a fresh backup (or use the Load a draft file button).");
}

(async () => {
  let json: unknown;
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { stop(`couldn't read ${file}: ${(e as Error).message}`); }
  const r = await loadDraftFile(json, by);
  if ("error" in r) stop(r.error);
  else {
    console.log(`Loaded "${r.batch}" as drafts (nothing sent):`);
    for (const row of r.rows) {
      const line = "error" in row && row.error ? `  x ${row.to || "(no name)"}: ${row.error} (not loaded)`
        : row.resolvedTo ? `  - ${row.to} -> ${row.resolvedTo}` : `  ! ${row.to}: ${"whyNot" in row && row.whyNot ? row.whyNot : "no single login matches"} (loaded as "can't send")`;
      console.log(line);
    }
  }
  await prisma.$disconnect();
})();
