# Security exceptions (accepted risks)

Each entry: what, why it's accepted, who accepted it, when it expires. An exception ends at its expiry date, at the
event named, or as soon as the reason stops being true - whichever comes first.

## EX-001 - npm audit: postcss / next, uuid / exceljs, minimatch / exceljs (accepted 27 Oct 2026; minimatch added 1 Nov 2026)

- **What:** the gated production audit (`npm audit --omit=dev`) reports 2 high and 10 moderate advisories on main and
  every release candidate (main 2fe2321, 1 Nov 2026; postcss-selector-parser below is dev-only and adds one more in a
  full `npm audit`):
  - postcss <= 8.5.22, nested in next 15.5 (high). The only fix is next@16, a major upgrade.
  - source-map-js 1.0.0 - 1.2.1 (high).
  - postcss-selector-parser < 6.1.5 (moderate).
  - next (moderate; this is the postcss item).
  - uuid < 11.1.1 via exceljs 4.4.0 (moderate).
  - minimatch < 11.0.1 (GHSA-g3hv-75wg-m249, moderate), only through exceljs 4.4.0: archiver 5.3.2 -> archiver-utils /
    readdir-glob / zip-stream -> glob 7.2.3 -> minimatch 3.1.5 / 5.1.9, and unzipper -> fstream -> rimraf -> glob. npm
    audit also lists archiver, archiver-utils, glob, readdir-glob, rimraf, zip-stream and exceljs. (eslint's copy is a
    dev dependency, outside the gated `--omit=dev` audit.)
- **Why accepted:** the security review (lobos-security-assurance, 27 Oct 2026) found none of them reachable at run
  time:
  - postcss, source-map-js and postcss-selector-parser only run at `next build`, on the app's own CSS;
    `next start` never processes CSS or source maps from users.
  - exceljs only calls uuid v4. The advisory is in v3 / v5 / v6 with a caller-supplied buffer.
  - Don't take npm's suggested "fix" for exceljs: it's a downgrade to 3.4.0.
  - minimatch only runs inside archiver.glob / archiver.directory / archiver-utils file.glob and rimraf's glob. The
    app calls none of them: exceljs uses archiver only in its streaming WorkbookWriter (append / file, never glob),
    and unzipper -> fstream only in its streaming reader's Extract; Operations uses neither - only `wb.xlsx.load`
    (JSZip) in `src/lib/invoiceSheet.ts` and `src/lib/docsearch/extract-core.mjs`, and CSV is the app's own parser. No
    user-supplied string ever reaches a glob pattern. Security review (lobos-security-assurance, 31 Oct 2026,
    AUD-001).
  - No safe fix: exceljs 4.4.0 is the latest release; forcing minimatch 11 under glob 7 is an unsupported pairing.
- **Accepted by:** Ilies (owner), 27 Oct 2026: "approve ... exception" - "accepting the package weakness for 90 days
  so releases can go out meanwhile".
  minimatch addition: Ilies (owner), 1 Nov 2026: "accept the minimatch exception".
- **Expires:** 25 Jan 2027, or at the Next.js 16 upgrade, or as soon as the app processes user-supplied CSS / source
  maps - whichever comes first.
  For the minimatch entries it also ends at once if Operations starts using exceljs's streaming WorkbookWriter /
  WorkbookReader, calls archiver, glob, minimatch, readdir-glob or rimraf directly, or passes any user-supplied string
  to a glob; and it is replaced by the upgrade as soon as a stable exceljs release drops archiver 5.
- **Meanwhile:**
  - apply `npm audit fix` (no --force) for source-map-js and postcss-selector-parser on a branch, as a small change;
  - plan the Next.js 16 upgrade through the permission gate;
  - the release check's audit step treats exactly these advisories as accepted until the expiry date, and fails on
    anything new.

## EX-002 - the owner may approve Operations AI's admin-kind change proposals (SEC-008, accepted 28 Oct 2026)

- **What:** `SAME_PERSON` (`lib/samePerson.ts`) pairs the owner's login with the Building Agent's, so neither
  approves the other's proposals. One narrow exception (`aiOwnerMayApprove` in `lib/changes/config.ts`): the owner
  may approve a proposal from Operations AI (the Building Agent's email on an active MANAGER login, checked at the
  time of the decision) for the seven admin kinds only - TIP_RATE_ADD, TIP_RATE_RETIRE, INVOICED_COST_REMOVE,
  RESOURCE_RATE, RESOURCE_ENGAGEMENT, WORKER_TICKET, COMPLIANCE_DOC. Never his own proposal, never another kind;
  contract values stay with the director logins; purchases are unchanged. Design:
  `docs/lci/ADMIN-CHANGE-KINDS-DESIGN.md`.
- **Why accepted / residual risk:** Ilies drives the agent session, so his approval of its proposal is not a
  second, independent person. This gives him no new power - as owner he can already make all seven changes directly
  on the Admin screens. Each proposal still carries before -> after, why and its source, and is logged; approvers
  must check the sources on each card before approving.
- **Accepted by:** Ilies (owner), through the lead, 28 Oct 2026 (security review of 6e6f2c0: SEC-001..007 approved,
  SEC-008 = this register entry).
- **Expires / review:** review by 29 January 2027 (Ilies, 29 Oct 2026: three months). It ends sooner, at once, if
  the agent can act without Ilies driving it, or if any of the seven kinds gains a power the owner doesn't already
  have.
- **Rollback:** `CONTROLLED_CHANGES_OFF=TIP_RATE_ADD,TIP_RATE_RETIRE,INVOICED_COST_REMOVE,RESOURCE_RATE,RESOURCE_ENGAGEMENT,WORKER_TICKET,COMPLIANCE_DOC`
  in `.env` switches the seven kinds off (proposals can still be read; nothing is approved), or remove
  `aiOwnerMayApprove` from the seven rules to keep the kinds with another Admin approving.
- **Daily cap (SEC-002) raised, 29 Oct 2026:** Ilies: "dont limit the cap to 20 just do it all today" (to clear the
  ~120 Admin items from the 28 Oct drive check in one day). The cap is now `AI_CHANGE_DAILY_LIMIT` in `.env`
  (blank = 20, max 1000), set to 300 on the server. Residual risk: more phone alerts (still at most one every 2
  minutes) and a larger approval queue; masking (SEC-001, SEC-009..012) is unaffected. Put it back by removing the
  line from `.env` and restarting.

## EX-003 - owner-accepted findings from the 2 Nov 2026 releases (COORDINATOR, regional travel, purchase quotes)

Ilies (owner) declined these fixes or accepted these risks when they were put to him by ID on 2 Nov 2026. Each was
reviewed by lobos-security-assurance. Review all of them by **2 February 2027**, or earlier at the trigger shown.

- **CO-002 (Medium, accepted):** the COORDINATOR login's money stripping only catches amounts written with a plain
  "$". Free-text amounts like "450/day", "48,500 ex GST", "4500$" or a full-width dollar sign can reach Alex's screens
  from project / hire / Day Review / tool notes.
  - Ilies: "alex can see figures this is okay".
  - Review trigger: a role change for Alex, or a second COORDINATOR login.
- **CO-003..CO-006 (Low, not approved):**
  - CO-003: document search names and snippets aren't stripped for COORDINATOR.
  - CO-004: a non-owner Admin's role change on a login with director access leaves a stale directorAccess tick.
  - CO-005: tool deletes keep no record of who deleted what.
  - CO-006: release check 63 doesn't cover every money shape.
- **Rollback note for COORDINATOR (d27a253 / 45fab23):** before rolling back to anything older than d27a253, switch
  every COORDINATOR login to TIMESHEETS (or deactivate it). Older builds fail open on an unknown role.
- **AT-002..AT-004, AT-006, AT-007 (Low, not approved), regional travel:**
  - AT-002: a crafted device id can make a travel pass never expire. With AT-001 in place, a pass is only ever issued
    after a genuine supervisor-QR sign-in by an allocated person; a crafted one can only be killed by rotating
    AUTH_SECRET.
  - AT-003: a leaver's pass keeps working for Start travel / Arrived.
  - AT-004: a worker's own travel taps aren't refused for an already-approved week, and payroll files read live legs.
  - AT-006: the public travel route has no rate limit.
  - AT-007: gaps in release checks 65 / 66.
- **AT-005 (Medium, deferred):** travel times are self-declared (up to about 16 h a day) with no sense check.
  - Ilies: "Later, before travel is paid".
  - It **must** be resolved before any travel pay is applied from the pay-run file's Travel hours column.
- **PQ-007 (Info, accepted):** the Building Agent login (a Manager) sees all supplier quotes and prices.
  - Ilies: "Yes, like any Manager".
  - Quote files are untrusted data for any Claude session.
- **PQ-011 (Info):** the 20-quote-files-a-day cap can be slightly exceeded by simultaneous sends. Each request is still
  capped at 30 MB.