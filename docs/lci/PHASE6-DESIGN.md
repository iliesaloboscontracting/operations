# LCI phase 6 - document search: design (27 Oct 2026)

Ilies (27 Oct): "do it now". Option A: Microsoft Graph from the server, `Sites.Selected`, read-only, approved sites only.
The Microsoft 365 admin step isn't done yet, so everything here is **off** until `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` and
`GRAPH_CLIENT_SECRET` are in `.env`. Until then nothing calls out at all.

Plan: `PHASE6-PLAN.md`. The folder list for Ilies to tick: `PHASE6-FOLDERS.md`. Draft defaults are marked **D6-1 … D6-9**.

## 1. What's built (this release)

| Part | Where |
|---|---|
| Approved folders (patterns), minimum level per folder, deny list | `src/lib/docsearch/folders.ts` |
| Text from PDF / Word / Excel / text | `src/lib/docsearch/extract.ts`, `zip.ts` |
| The search index (separate SQLite FTS5 file) | `src/lib/docsearch/index.ts`, `query.ts` |
| Sources: `GraphSource` (real), `LocalFolderSource` (tests only) | `src/lib/docsearch/sources/` |
| Graph settings, host allowlist, write-permission refusal, scrubbing | `src/lib/docsearch/graphSetup.ts` |
| Incremental refresh, nightly tick, kill switch | `src/lib/docsearch/indexer.ts`, `nightly.ts`, `instrumentation.ts` |
| `/documents` page and `/api/documents` (Managers and up) | `src/app/documents`, `src/app/api/documents` |

**Not in this release:** the Assistant tool. It's the second release, as the plan says.

## 2. Reading libraries

| Format | How | Why |
|---|---|---|
| PDF | **`unpdf` 1.8.1** (pinned, exact) | See below. |
| Word `.docx` | **No library.** A `.docx` is a zip; `zip.ts` reads `word/document.xml` through the zip's central directory with Node's own `zlib`, and keeps the text of each paragraph. | About 80 lines and tested. The usual library (`mammoth`) brings 8 dependencies for something we only read text from. |
| Excel `.xlsx` | `exceljs` (already a dependency) | Each sheet's cell text, sheet by sheet. |
| `.txt`, `.csv`, `.md` | read as UTF-8 | |
| Old `.doc` / `.xls`, images, scans with no text | not read: listed as "not readable" | A scan would need OCR. Reading scans with Claude sends documents out, so it's a separate later decision (plan, Risks). |

**Why `unpdf`:**
- It has no dependencies. Its only peer, `@napi-rs/canvas`, is marked optional, so nothing native is installed.
- It's MIT licensed, maintained (unjs), and bundles Mozilla's pdf.js **6.1.200**, read at runtime.
- `pdfjs-dist` itself was tried first. It pulls `@napi-rs/canvas` (a native binary per platform) as an optional dependency, which is only needed for drawing pages.
- 1.8.1 (13 Aug 2026) is the newest release more than two weeks old.

**Vulnerabilities:**
- pdf.js's known code-execution issue (CVE-2024-4367, a font with script) was fixed in 4.2.67; 6.1.200 is well past it.
- In pdf.js 6 that route is gone entirely: the bundled build contains no `eval` or `new Function` (checked), so there's no `isEvalSupported` switch left to set.
- `npm audit --omit=dev` shows the same 5 findings before and after adding unpdf (postcss, source-map-js, uuid, all already there). unpdf adds none.

**Limits:**
- Files over 25 MB aren't downloaded.
- At most 300 pages are read per PDF.
- At most 200,000 characters of text are kept per document.

## 3. The index (`SEARCH_INDEX_PATH`)

- It uses Node 24's built-in SQLite (`node:sqlite`, SQLite 3.53, FTS5 with Porter stemming, so "spotters" finds "spotter"). It's loaded through `process.getBuiltinModule`, so the bundler never sees it, and no package is added.
- The file defaults to `../operations-search/search.db`, beside the app and **outside `prisma/`**, so `prisma db push` can never touch it. On the server it's `/srv/operations/search/search.db`.
- **Deploy (DS-014):**
  - set `SEARCH_INDEX_PATH=/srv/operations/search/search.db` in `.env`;
  - make `/srv/operations/search` owned by the `operations` user with mode `700`;
  - add `UMask=0077` to the `[Service]` section of the `operations` systemd unit, so SQLite's `-wal` / `-shm` files are `600` too.
  The app itself makes the folder `0700` and the file `0600` before SQLite opens it, so the index text is readable only by `operations` (and root).
- It's a derived copy: it can be deleted and rebuilt at any time, so it isn't backed up. Rows for files that left an approved folder are removed from it; that's a cache, not a business record.

```sql
docs(id PK  -- source:itemId
     , folder_id, folder_label, level      -- level copied from the folder at index time
     , name, path, web_url, modified, revision, etag, size, ext
     , status   -- OK | UNREADABLE | TOO_BIG | UNSUPPORTED
     , chars, indexed_at)
docs_fts USING fts5(name, body, content='', tokenize='porter unicode61')   -- rowid = docs.rowid
runs(id, source, started_at, finished_at, seen, added, updated, removed, unreadable, error)
meta(key PK, value)   -- last nightly date
```

- **Search** is plain words, all required. Each word is quoted, so no user text is ever FTS syntax, and the last word is a prefix match.
- **Ranking** is bm25, with the file name weighted 3× the body.
- **Each result** has a snippet, folder, date, a revision read from the file name ("Rev C", "R2", "v3") and the SharePoint link.

## 4. Who sees what (on the server)

| Level | Who | Folders (draft, `PHASE6-FOLDERS.md`) |
|---|---|---|
| `MANAGER` | Manager and Admin logins | SWMS and safety; scopes, drawings, programmes, quality |
| `COMMERCIAL` | Admin logins, and Manager logins with director access | contracts, variations, EOTs, tenders and quotes |
| never | | HR, payroll, finance, legal, accounts, progress claims, cost reports, supplier invoices, contact lists, personal folders, the CLAUDE / estimating workspaces |

- **The page and API** are Managers and Admins only. Viewers, Timesheets, DIRECTOR and ACCOUNTS logins are refused, and nothing is on any site link (D6-1: DIRECTOR / ACCOUNTS logins are off Operations, as today).
- **Filtering:** every search runs `WHERE level IN (<levels for this login>)` in SQL. A result the login may not see is never read from the index, let alone sent.
- **Two checks per file:** the folder's level is stored on each row when it's indexed. The **deny list wins over the approved list**, so a file inside an approved folder but under a denied subfolder (for example `…/22_001_14_Timesheets & Payroll`) is never read.
- **D6-2: draft folders aren't approved.** Every folder in the list ships `approved: false`, so nothing is indexed until Ilies ticks it and the list is updated.
- **Re-checking at Microsoft:** the SharePoint link opens the document under the user's own Microsoft account, so nobody can open a file they couldn't open before.

## 5. Microsoft Graph (outbound connection #7), the same rules as Xero

- **Off** unless `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` and `GRAPH_CLIENT_SECRET` are all set. `GRAPH_SITE` defaults to `lobosdemolition.sharepoint.com:/sites/Management`.
- **Hosts:** `login.microsoftonline.com` (the token, POST) and `graph.microsoft.com` (GET only). Anything else is refused before `fetch`. There are no redirects, and each call times out after 20 s.
- **D6-3, one addition the lead should know about:** Graph never serves file bytes itself. `GET /drives/{d}/items/{i}/content` answers with a **302 to a short-lived pre-signed URL on the tenant's own SharePoint host** (`lobosdemolition.sharepoint.com`).
  - The client allows exactly that one host, taken from `GRAPH_SITE`, for that one step: a GET with **no Authorization header**, the pre-signed URL only, never followed further.
  - Without it, no file can be downloaded. Graph's alternative (`@microsoft.graph.downloadUrl`) is the same host.
- **Write permission refused:**
  - After each token, the app reads the token's `roles` claim. Anything other than exactly `Sites.Selected` stops the run: "Refusing to start: the app has these permissions - …".
  - `Sites.Read.All`, `Files.Read.All` and any `*.ReadWrite*`, `*.Write*`, `*.FullControl*` or `*.Manage*` are refused.
  - The per-site grant must be **read** (set by the admin); the app can't see it, so the checklist says it.
- **Errors** are scrubbed (the secret, tokens, `client_secret=`, `Bearer …`) and cut to 300 characters before they reach a log or the screen.
- **Throttling:** a 429 or 503 stops that night's run, and the next night carries on (incremental).

## 6. Refresh

- **Incremental:** for each approved folder, list its files recursively (8 levels at most). A file is downloaded and re-read only when its `eTag` / modified time changed. Files no longer present are removed from the index.
- **Nightly:** from the instrumentation tick, once a day after **2:30am Sydney** (after the 2am backup and the Xero read). At most one run at a time; the last date is in `meta`.
- **Kill switch:** `DOC_SEARCH=off` stops the tick, the refresh and the search (the page says "Document search is switched off").
- **D6-4:** "Refresh now" for an Admin on `/documents`, at most every 15 minutes.
- **D6-5, `LocalFolderSource`:** for tests only. It's used only when `DOC_SEARCH_SOURCE=local`, and **refused when `NODE_ENV=production`**. It reads a local folder that mirrors the SharePoint paths. `DOC_SEARCH_TEST_APPROVE=<folder ids>` approves draft folders, for the local source only.

## 7. The page (`/documents`)

- A search box. Each result shows the name, a highlighted snippet, the folder label, the modified date, the revision and "Open in SharePoint".
- A small status line: last refresh, document count, and how many weren't readable. Admins see the not-readable list (name and folder).
- **D6-6:** a result shows its folder label and path below the library root. A search for a project name finds its documents.

## 8. Draft defaults (all reversible)

- D6-1 DIRECTOR / ACCOUNTS logins: no `/documents` for now.
- D6-2 every draft folder `approved: false` until Ilies ticks it.
- D6-3 the tenant's SharePoint host is allowed for the pre-signed download only.
- D6-4 Admin "Refresh now", ≤ every 15 min.
- D6-5 `LocalFolderSource` only outside production.
- D6-6 the path is shown on results.
- D6-7 incident reports and contact lists aren't indexed (they hold personal details), even though they're inside project folders.
- D6-8 tenders: the 2026 folder only, not 2022–2025 (over 400 GB, mostly drawings). Older years can be added later.
- D6-9 limits: 25 MB per file, 300 pages per PDF, 200,000 characters per document.

## 9. Tests

- **Unit:**
  - the folder matcher and the deny list;
  - **"each role sees only its folders"**: a Manager never gets `COMMERCIAL`, and Viewer, Timesheets, DIRECTOR and ACCOUNTS get nothing;
  - the FTS query builder (no syntax injection);
  - revision parsing;
  - the zip / docx reader, Excel text and PDF text;
  - Graph: the host allowlist, write roles refused, scrubbing, OFF with missing settings.
- **On a copy:**
  - `LocalFolderSource` over a scratch folder of documents copied **out** of OneDrive (read-only): a SWMS, a scope and a contract;
  - a search as each role, the levels, incremental refresh, the kill switch;
  - **no outbound call** with Graph not set up;
  - viewer-safety.
