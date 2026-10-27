// LCI phase 6: the search index - a SEPARATE SQLite file (Node 24's built-in node:sqlite, FTS5), at SEARCH_INDEX_PATH,
// outside prisma/ so `prisma db push` can never touch it. A derived copy: it can be deleted and rebuilt any time.
// Role filtering happens here, in SQL - a row a login may not see is never read. Design §3-4.
import { existsSync, mkdirSync } from "fs";
import path from "path";
import type { Level } from "./folders";
import { MARK_CLOSE, MARK_OPEN, toFtsQuery } from "./query";

// The few node:sqlite calls used (its types aren't in this project's @types/node). Loaded with getBuiltinModule so the
// bundler never tries to resolve it.
type Stmt = { run(...a: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };
const sqlite = () => (process as unknown as { getBuiltinModule(id: string): { DatabaseSync: new (p: string) => Db } }).getBuiltinModule("node:sqlite");

export const indexPath = () => path.resolve(process.env.SEARCH_INDEX_PATH?.trim() || path.join(process.cwd(), "..", "operations-search", "search.db"));

// Reading (search, status) never creates the file: an unconnected server has no index until its first refresh.
export const hasIndex = () => existsSync(indexPath());

let db: Db | null = null;
let openedAt: string | null = null;
export function openIndex(file = indexPath()): Db {
  if (db && openedAt === file) return db;
  if (db) db.close();
  if (/[\\/]prisma[\\/]/i.test(file)) throw new Error("The search index must live outside prisma/.");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  db = new (sqlite().DatabaseSync)(file);
  openedAt = file;
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      rowid INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, folder_id TEXT NOT NULL, folder_label TEXT NOT NULL, level TEXT NOT NULL,
      name TEXT NOT NULL, path TEXT NOT NULL, web_url TEXT, modified TEXT, revision TEXT, etag TEXT, size INTEGER, ext TEXT,
      status TEXT NOT NULL, why TEXT, chars INTEGER DEFAULT 0, indexed_at TEXT NOT NULL, seen_run INTEGER);
    CREATE INDEX IF NOT EXISTS docs_level ON docs(level);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(name, body, tokenize = 'porter unicode61');
    CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, source TEXT, started_at TEXT, finished_at TEXT, seen INTEGER DEFAULT 0,
      added INTEGER DEFAULT 0, updated INTEGER DEFAULT 0, removed INTEGER DEFAULT 0, unreadable INTEGER DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}
export function closeIndex() { db?.close(); db = null; openedAt = null; }

export const getMeta = (k: string) => (openIndex().prepare("SELECT value FROM meta WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? null;
export const setMeta = (k: string, v: string) => openIndex().prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export type DocRow = {
  id: string; folderId: string; folderLabel: string; level: Level; name: string; path: string; webUrl: string | null; modified: string;
  revision: string | null; etag: string; size: number; ext: string; status: string; why: string | null; text: string;
};

export const knownEtag = (id: string) => (openIndex().prepare("SELECT etag, level, folder_id FROM docs WHERE id = ?").get(id) as { etag: string; level: string; folder_id: string } | undefined) ?? null;
export const markSeen = (id: string, run: number) => openIndex().prepare("UPDATE docs SET seen_run = ? WHERE id = ?").run(run, id);

// Insert or replace one document and its text.
export function putDoc(d: DocRow, run: number): "added" | "updated" {
  const x = openIndex();
  const old = x.prepare("SELECT rowid FROM docs WHERE id = ?").get(d.id) as { rowid: number } | undefined;
  if (old) {
    x.prepare("DELETE FROM docs_fts WHERE rowid = ?").run(old.rowid);
    x.prepare(`UPDATE docs SET folder_id=?, folder_label=?, level=?, name=?, path=?, web_url=?, modified=?, revision=?, etag=?, size=?, ext=?, status=?, why=?, chars=?, indexed_at=?, seen_run=? WHERE rowid=?`)
      .run(d.folderId, d.folderLabel, d.level, d.name, d.path, d.webUrl, d.modified, d.revision, d.etag, d.size, d.ext, d.status, d.why, d.text.length, new Date().toISOString(), run, old.rowid);
    if (d.status === "OK") x.prepare("INSERT INTO docs_fts(rowid, name, body) VALUES(?, ?, ?)").run(old.rowid, `${d.name} ${d.path}`, d.text);
    return "updated";
  }
  const r = x.prepare(`INSERT INTO docs(id, folder_id, folder_label, level, name, path, web_url, modified, revision, etag, size, ext, status, why, chars, indexed_at, seen_run)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.id, d.folderId, d.folderLabel, d.level, d.name, d.path, d.webUrl, d.modified, d.revision, d.etag, d.size, d.ext, d.status, d.why, d.text.length, new Date().toISOString(), run);
  if (d.status === "OK") x.prepare("INSERT INTO docs_fts(rowid, name, body) VALUES(?, ?, ?)").run(Number(r.lastInsertRowid), `${d.name} ${d.path}`, d.text);
  return "added";
}

// Rows from this source not seen in this run (deleted, moved, or their folder no longer approved) leave the index.
export function removeUnseen(source: string, run: number): number {
  const x = openIndex();
  const gone = x.prepare("SELECT rowid FROM docs WHERE id LIKE ? AND (seen_run IS NULL OR seen_run <> ?)").all(`${source}:%`, run) as { rowid: number }[];
  for (const g of gone) { x.prepare("DELETE FROM docs_fts WHERE rowid = ?").run(g.rowid); x.prepare("DELETE FROM docs WHERE rowid = ?").run(g.rowid); }
  return gone.length;
}

export type Hit = { id: string; name: string; folder: string; path: string; webUrl: string | null; modified: string | null; revision: string | null; snippet: string };

// Search, filtered to the levels this login may see. No levels -> nothing (and no query is run).
export function search(input: string, levels: Level[], limit = 30): { hits: Hit[]; query: string | null } {
  const q = toFtsQuery(input);
  if (!q || !levels.length || !hasIndex()) return { hits: [], query: q };
  const marks = levels.map(() => "?").join(",");
  const rows = openIndex().prepare(`
    SELECT d.id, d.name, d.folder_label AS folder, d.path, d.web_url AS webUrl, d.modified, d.revision,
           snippet(docs_fts, 1, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 14) AS snippet
    FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
    WHERE docs_fts MATCH ? AND d.level IN (${marks}) AND d.status = 'OK'
    ORDER BY bm25(docs_fts, 3.0, 1.0) LIMIT ?`).all(q, ...levels, Math.min(Math.max(limit, 1), 50)) as Hit[];
  return { hits: rows, query: q };
}

export function status(levels: Level[]) {
  if (!hasIndex()) return { documents: 0, notReadable: 0, lastRun: null, unreadable: [] };
  const x = openIndex();
  const marks = levels.length ? levels.map(() => "?").join(",") : "''";
  const counts = x.prepare(`SELECT status, COUNT(*) n FROM docs WHERE level IN (${marks}) GROUP BY status`).all(...levels) as { status: string; n: number }[];
  const last = x.prepare("SELECT source, started_at AS startedAt, finished_at AS finishedAt, seen, added, updated, removed, unreadable, error FROM runs ORDER BY id DESC LIMIT 1").get() ?? null;
  const unreadable = x.prepare(`SELECT name, folder_label AS folder, why FROM docs WHERE status <> 'OK' AND level IN (${marks}) ORDER BY folder_label, name LIMIT 200`).all(...levels);
  return { documents: counts.find((c) => c.status === "OK")?.n ?? 0, notReadable: counts.filter((c) => c.status !== "OK").reduce((n, c) => n + c.n, 0), lastRun: last, unreadable };
}

export function startRun(source: string) { return Number(openIndex().prepare("INSERT INTO runs(source, started_at) VALUES(?, ?)").run(source, new Date().toISOString()).lastInsertRowid); }
export function finishRun(id: number, r: { seen: number; added: number; updated: number; removed: number; unreadable: number; error: string | null }) {
  openIndex().prepare("UPDATE runs SET finished_at=?, seen=?, added=?, updated=?, removed=?, unreadable=?, error=? WHERE id=?").run(new Date().toISOString(), r.seen, r.added, r.updated, r.removed, r.unreadable, r.error, id);
}
