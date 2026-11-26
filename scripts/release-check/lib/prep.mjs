// SD-002 (Ilies approved 26 Nov 2026): no health or crew-signature data in a release-check test copy. Incident
// reports (IncidentReport / IncidentSignature / IncidentEvent) are health data and the site documents' signatures
// (SwmsSignature / SiteDocSignature) are crew data: a snapshot is PREPPED first (scripts/release-check/prep-snapshot.mjs
// on a COPY), and run.mjs refuses one that still has them unless --allow-incidents is given. The checks (108, 109) make
// their own synthetic rows. Uses node:sqlite only - works before the Prisma client is generated.
const SIG_TABLES = ["SwmsSignature", "SiteDocSignature", "IncidentSignature"];
const has = (db, t) => !!db.prepare("select name from sqlite_master where type='table' and name = ?").get(t);
const count = (db, sql) => Number(db.prepare(sql).get().n);

// What a snapshot still holds: incident rows and non-empty signature PNGs per table (missing tables count 0).
export function sensitiveRows(file) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    // SD-013: IncidentEvent counted too - follow-up notes (health details) left behind without their report.
    const out = {
      IncidentReport: has(db, "IncidentReport") ? count(db, `select count(*) as n from "IncidentReport"`) : 0,
      IncidentEvent: has(db, "IncidentEvent") ? count(db, `select count(*) as n from "IncidentEvent"`) : 0,
    };
    for (const t of SIG_TABLES) out[t] = has(db, t) ? count(db, `select count(*) as n from "${t}" where length("png") > 0`) : 0;
    return out;
  } finally { db.close(); }
}
export const isClean = (s) => Object.values(s).every((n) => n === 0);

// Prep a COPY in place: delete IncidentEvent, IncidentSignature, IncidentReport (children first - their foreign keys
// RESTRICT); empty every png in SwmsSignature, SiteDocSignature, IncidentSignature and VariationSignature (the clients'
// and supervisors' docket signatures - just as easy, so done too); then VACUUM so the freed pages hold nothing.
export function prepCopy(file) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(file);
  const done = {};
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN");
    for (const t of ["IncidentEvent", "IncidentSignature", "IncidentReport"]) if (has(db, t)) done[`${t} deleted`] = Number(db.prepare(`delete from "${t}"`).run().changes);
    for (const t of [...SIG_TABLES, "VariationSignature"]) if (has(db, t)) done[`${t} png emptied`] = Number(db.prepare(`update "${t}" set "png" = X'' where length("png") > 0`).run().changes);
    db.exec("COMMIT");
    db.exec("VACUUM");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* none open */ }
    throw e;
  } finally { db.close(); }
  return done;
}

// SD-013 (Ilies approved 26 Nov 2026): which files prep-snapshot refuses - checked on the REAL path (fs.realpathSync), so
// a symlink or junction to dev.db or to anything under /srv is refused too. -> the reason, or null.
export function refusePath(realPath) {
  const p = String(realPath).replace(/\\/g, "/");
  if (!/\.db$/i.test(p)) return "not a .db file";
  if (/(^|\/)dev\.db$/i.test(p)) return "that's dev.db";
  if (/^\/srv\//.test(p)) return "that's under /srv (the server's)";
  return null;
}