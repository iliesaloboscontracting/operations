// Nightly backup of the live Operations database (Brief 09, item 1). Run by
// the "Operations DB Backup" Windows Scheduled Task via scripts/backup-db.ps1.
//
// Uses SQLite's own VACUUM INTO rather than a plain file copy: a plain copy
// of a live database file can capture a half-written (torn) snapshot if it
// lands mid-write, since this app doesn't use WAL mode. VACUUM INTO reads
// from the source connection and writes a complete, consistent copy to the
// destination without touching (or locking out writes to) the source file.
//
// Every backup is then opened independently and must pass
// PRAGMA integrity_check before it's trusted - result and details are always
// appended to backup-log.txt next to the backups, and a failed check exits
// non-zero so the Scheduled Task shows a failure instead of a silent one.
//
// Usage: DATABASE_URL must already be set to an absolute file: path (see
// backup-db.ps1) - there is no default, so this never silently backs up the
// wrong database.

import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BACKUP_DIR = "C:\\Users\\ilies\\OneDrive\\Operations-Backups";
const RETENTION_DAYS = 30;
const LOG_FILE = path.join(BACKUP_DIR, "backup-log.txt");

function log(line: string) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_FILE, stamped + "\n");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set - point it at the live database (an absolute file: path) and try again.");
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date()
    .toLocaleString("sv-SE", { timeZone: "Australia/Sydney" }) // yyyy-MM-dd HH:mm:ss, 24h, local
    .replace(" ", "_")
    .replace(/:/g, "")
    .slice(0, 15); // yyyy-MM-dd_HHmm
  const destPath = path.join(BACKUP_DIR, `dev-${stamp}.db`);

  const prisma = new PrismaClient();
  try {
    const escaped = destPath.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  } finally {
    await prisma.$disconnect();
  }

  const size = fs.statSync(destPath).size;

  const check = new DatabaseSync(destPath, { readOnly: true });
  let result: string;
  try {
    const row = check.prepare("PRAGMA integrity_check").get() as
      | { integrity_check: string }
      | undefined;
    result = row?.integrity_check ?? "no result";
  } finally {
    check.close();
  }

  if (result !== "ok") {
    log(`FAIL ${destPath} size=${size} integrity_check="${result}"`);
    throw new Error(`Backup integrity check failed for ${destPath}: ${result}`);
  }
  log(`OK ${destPath} size=${size} integrity_check=ok`);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^dev-.*\.db$/.test(name)) continue;
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      log(`PRUNED ${full}`);
    }
  }
}

main().catch((err) => {
  const line = `ERROR ${err instanceof Error ? err.message : String(err)}`;
  console.error(line);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // best-effort logging only
  }
  process.exit(1);
});
