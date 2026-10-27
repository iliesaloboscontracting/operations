# Release check

One command that builders run before handing work over, and the Test & Release agent runs again on the
integrated candidate. It replaces the one-off `mkenv / mkmgr / mkacc / mkadm / mkdir / mkts / mklinks / rowcounts`
helpers and the `n15smoke / trackcheck / dirtest / payrollcheck / prodcheck / s3-s7check / rcptcheck / rbcheck /
delcheck / adcheck / xacheck / d4check / dpcheck` scripts.

```bash
# in YOUR OWN worktree (never the shared folder, never the server), after `npm ci`:
npm run release-check -- --snapshot C:/path/to/prod-YYYYMMDD-HHMM.db

# check another checkout (e.g. an integration branch) with this copy of the tool:
npm run release-check -- --snapshot <db> --app C:/Users/ilies/Documents/operations-rel-x
```

Options: `--port 3001` (never 3000), `--accept-data-loss` (only with the release owner's approval - the warning is
written into the report), `--out <folder>` (default `release-check-reports/<time>-<sha>/`, git-ignored),
`--keep-build` (keep `.next`), `--no-audit` (offline; recorded as SKIPPED and needs an owner exception),
`--only id1,id2` (a subset - not a release result).

Exit code: **0** everything passed (SKIPPED only where a check is not applicable), **1** something failed,
**2** something was blocked (missing data, port in use, registry unreachable...) and nothing failed.

## What it does

1. Refuses to run if: the folder isn't an Operations checkout or has no `node_modules`; it's under `/srv`; the port
   is 3000; there is a `.env` it didn't write (so the shared folder and real installs are never touched);
   `.env.local` / `.env.production*` exist; the snapshot is missing or is this checkout's own `prisma/dev.db`.
2. Copies the snapshot to `<app>/prisma/test.db` (the snapshot itself is only read; its sha256 is checked at the end).
3. Writes a test `.env`: `DATABASE_URL` = that copy, a fresh random `AUTH_SECRET`, `SITE_BASE_URL` = 127.0.0.1,
   file folders in a temp folder, `RECEIPT_READING=off`, `DAILY_LOG_REMINDER=off`, `ESTIMATING_URL` = a closed
   port, `SEARCH_INDEX_PATH` in the temp folder. **Never** `VAPID_*`, `XERO_*`, `GRAPH_*`, `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY` or `ACTUALS_SECRET` - and those are stripped from the inherited environment too.
4. Static checks: candidate has no uncommitted changes, `tsc --noEmit`, `npm test`, lint (SKIPPED while the repo has
   no ESLint config), the tool's own self-tests (`node --test scripts/release-check/lib/audit.test.mjs`), and
   `npm audit --omit=dev`: every advisory of moderate or worse FAILS unless an active exception in
   `expected.mjs` `AUDIT_EXCEPTIONS` accepts it exactly (package + GHSA id, no worse severity, no new package or
   install path affected) - those show as "accepted: EX-001". From an exception's expiry date (or the event it
   names, e.g. the Next.js 16 upgrade for EX-001) it stops applying. Low / info advisories are listed, not gating.
   Each exception needs its record in `docs/security/EXCEPTIONS.md` (EX-001: main 33e8ec7, expires 2027-01-25).
5. Row counts, `prisma db push`, row counts again. A data-loss warning stops the run (FAIL, warning listed) unless
   `--accept-data-loss`. Any existing table dropped or changing row count is a FAIL.
6. `npm run build`.
7. Throwaway logins for MANAGER, MANAGER + director access, ADMIN + director access, ADMIN, VIEWER, TIMESHEETS,
   ACCOUNTS and DIRECTOR (random passwords, in memory only - no credential files), and fresh SUPERVISOR / OFFICE
   links for people who already have one. Two logins are known by email, not role - the owner and the Operations AI
   (Building Agent): on the COPY only their password is replaced with a random in-memory one (created if missing).
8. Starts `next start` on 127.0.0.1:<port> with `lib/outbound-guard.cjs` preloaded: every TCP connection to a
   non-loopback host is **blocked and logged**; the `no-outbound` check fails if there was even one attempt.
9. Runs every module in `checks/` (in file-name order; the ones marked `writes: true` add synthetic rows to the
   copy only), then the candidate's own `scripts/check-viewer-safety.ts`.
10. Prints the PASS / FAIL / BLOCKED / SKIPPED table, writes `release-check.md` and `release-check.json` (commit,
    lockfile hash, snapshot hash, every assertion - no figures, no names, no secrets), stops the server by its own
    PID tree (never all `node.exe`), and deletes the test DB, the test `.env`, the temp folder and `.next`.

## Checks

| id | covers |
|---|---|
| smoke | pages, core APIs, site links, scope PDF, sign-in gate, logout; `/api/users` 403 for a Manager is expected |
| access-matrix | every GET API vs no login / TIMESHEETS / DIRECTOR / ACCOUNTS - outside `expected.mjs` they must 401/403 |
| director-wall | Directors screen = Tracking, writes and Estimating refused, only the owner hands out DIRECTOR |
| tracking-integrity | every project: daily = categories = locked + estimated + invoiced = total; forecast >= spent |
| payroll | access, hours-only CSVs, GPS / engagement hidden from Managers, supervisor hours on the link |
| production | benchmarks for Managers and Directors, offer refused, `/estimating` Admin only, no $ |
| accounts-xero | accounts read status, can't connect / disconnect, no token in replies |
| asset-dates | Managers get six fields only |
| accounts-tax | accounts only, labelled estimate, Tracking byte-for-byte unchanged |
| accounts-s3 | on-cost rates Admin only, double claim refused, Tracking unchanged (writes a claim) |
| compliance-s5 | board flag label + date only, TFN refused, nothing on links (writes a ticket) |
| purchases-s6 | link -> accounts -> Director chain, amount never on the link or for a Manager (writes a request) |
| receipts | driver link receipts-only, asbestos tap, spoofed price ignored, add-docket rules (writes a docket) |
| reimbursements | link tile rules, no $ on the link, tip dockets never claims |
| signin-remove | Admin removal with a reason, locked weeks refuse, gone from Sign-ins and timesheets (writes) |
| docsearch | only when `src/lib/docsearch` exists: roles, never on links, OFF with no Graph keys, no index file, folders unapproved, index refuses `prisma/`, kill switch |
| questions-chat | only when `src/app/api/messages` exists: Accounts -> Questions access, Operations AI questions (targets, 20 a day, tag), answers change nothing, office chat roles, never on links, edit / delete own only, history, owner-only read-all without marking seen |
| viewer-safety | the candidate's own `scripts/check-viewer-safety.ts` |
| no-outbound | zero outbound connection attempts from the test server |
| cleanup | server stopped, test files gone, snapshot unchanged |

Known-expected results live in `expected.mjs` (`MAY_ANSWER` per role, `EXPECTED_NOTES`). A new route that one of
the one-page logins should reach must be added there on purpose.

## Adding a check

Drop `checks/NN-name.mjs` exporting `{ id, title, writes?, timeoutMs?, applies?(ctx), run(t, ctx) }`. Use
`t.ok(cond, name, detail)`, `t.status(res, want, name)`, `t.note(text)`, `t.block(reason)` (data missing) and
`ctx.get/post/put/patch/del(path, ROLE | null, body)`, `ctx.json/text`, `ctx.site(link, "/rest")`, `ctx.db`
(test.db only), `ctx.users`, `ctx.links`, `ctx.today`, `ctx.lastWeek`. Never print a figure, a name or a body.

## Limits

- The snapshot is a raw copy of live data (not sanitised): keep it local, never commit or send it. The run deletes
  its own copies; delete the snapshot when the release is done.
- `next build` downloads the Google fonts (next/font) - the build needs the internet; the running test server
  does not and is blocked from it.
- Pages are client-gated (AppFrame sends one-page logins home); the APIs are what's checked for access.
- Data-dependent steps (a supervisor with a job today, a sign-in in an unlocked week) report BLOCKED with the
  reason rather than pass silently.
