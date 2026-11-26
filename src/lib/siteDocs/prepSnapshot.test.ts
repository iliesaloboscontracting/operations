// SD-002 / SD-013 (Ilies approved 26 Nov 2026): the release check's snapshot prep - an orphan follow-up note makes a
// copy "not clean", prep removes it, and the path guards run on the REAL path (a symlink to dev.db is refused).
// `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isClean, prepCopy, refusePath, sensitiveRows } from "../../../scripts/release-check/lib/prep.mjs";

const CLI = path.join(__dirname, "..", "..", "..", "scripts", "release-check", "prep-snapshot.mjs");
// node:sqlite (Node 22.5+), typed loosely here - only exec / close are used.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as unknown as { DatabaseSync: new (f: string) => { exec(sql: string): void; close(): void } };

function makeDb(file: string, sql: string) {
  const db = new DatabaseSync(file);
  db.exec(`create table "IncidentReport"(id text primary key, words text);
    create table "IncidentEvent"(id text primary key, incidentId text, note text);
    create table "IncidentSignature"(id text primary key, incidentId text, png blob);
    create table "SwmsSignature"(id text primary key, png blob); create table "SiteDocSignature"(id text primary key, png blob);` + sql);
  db.close();
}

test("SD-013: an orphan IncidentEvent (no report) makes a copy not clean; prep clears it", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "prep-test-"));
  try {
    const f = path.join(dir, "copy.db");
    makeDb(f, `insert into "IncidentEvent" values ('e1', 'gone', 'Worker still sore');`);
    const s = sensitiveRows(f) as Record<string, number>;
    assert.equal(s.IncidentEvent, 1);
    assert.equal(s.IncidentReport, 0);
    assert.equal(isClean(s), false, "an orphan follow-up note alone is not clean");
    prepCopy(f);
    assert.equal(isClean(sensitiveRows(f)), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SD-013: the path guards - dev.db, /srv and non-.db refused; checked on the real path (a symlink to dev.db too)", () => {
  assert.equal(refusePath("C:/x/prisma/rc-1126-prepped.db"), null);
  assert.ok(refusePath("C:\\x\\prisma\\dev.db"));
  assert.ok(refusePath("/srv/operations/app/prisma/dev.db"));
  assert.ok(refusePath("/srv/operations/backups/copy.db"), "anything under /srv");
  assert.ok(refusePath("C:/x/notes.txt"));
  // A symlink named like a copy that points at a file named dev.db: the CLI resolves it and refuses. Creating a symlink
  // on Windows can need admin rights / developer mode - then the guard is checked on the resolved path directly.
  const dir = mkdtempSync(path.join(os.tmpdir(), "prep-link-"));
  try {
    const target = path.join(dir, "dev.db");
    writeFileSync(target, "");
    const link = path.join(dir, "innocent-copy.db");
    let linked = true;
    try { symlinkSync(target, link, "file"); } catch { linked = false; }
    if (linked) {
      let code = 0, out = "";
      try { out = execFileSync(process.execPath, [CLI, link], { encoding: "utf8", stdio: "pipe" }); } catch (e) { code = (e as { status?: number }).status ?? -1; out = String((e as { stderr?: string }).stderr ?? ""); }
      assert.equal(code, 2, `refused (exit 2): ${out}`);
      assert.match(out, /dev\.db/);
    } else {
      console.log("SD-013: no symlink permission on this machine - checked the guard on the resolved path instead");
      assert.ok(refusePath(target), "the resolved path (dev.db) is refused - symlinks need admin rights here");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
