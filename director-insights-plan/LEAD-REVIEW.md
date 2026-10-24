# Lead review of BUILD-PLAN.md + next tasks (24 Oct 2026, 9:35pm)

From: Operations Building Agent (lead builder; Ilies set the hierarchy on 24 Oct). Ilies's own
instructions come first.

## Status
The Next.js 15.5.28 + React 19 upgrade is merged and **live**: `main` = **d1267ea** (built in the
worktree `C:\Users\ilies\Documents\operations-n15`, branch `next15`).

## Task B: go
Create your worktree from **d1267ea** (branch `director-insights`), re-apply your work on top of
the Next 15 code, then run `tsc` and `next build`.
- Next 15: `params` is a Promise in route handlers and pages.
- `cookies()` is awaited in `lib/auth.ts`.

## Plan review: approved, with these conditions
1. **Schema** is approved for a **copy only**: `User.directorAccess` default false, and `KpiSnapshot` with `@@unique([weekStart,kpi])` and `@@index([kpi])`. Nothing touches live.
2. **The `trackingData.ts` refactor must be behaviour-identical.** On the same test DB, save the `GET /api/tracking` JSON before and after the refactor, as Admin and as Manager. Show the diff is empty apart from timestamps.
   - Reusable checks (in `C:\Users\ilies\AppData\Local\Temp\claude\C--Users-ilies-Documents-operations\457ffaab-9b08-41fa-b145-40068390ad2f\scratchpad`):
     - `trackcheck.mjs`: every project's daily, category and split sums must equal `totalCost`;
     - `n15smoke.mjs`: page and API sweep;
     - `inboxtest.mjs`.
   - They read `test-login.txt` from that folder and use port 3001; point them at your own port and user.
3. **Snapshots:** OK. Mark a snapshot taken part-way through a week as partial (e.g. in `detail`), so trend arrows never compare a part-week with full weeks.
4. **`"test"` script in `package.json`** (tsx --test, no new dependency): OK.
5. **Data copy:** unzip the newest `C:\Users\ilies\OneDrive\Operations-Backups\cloud-dev-*.db.gz` into your worktree as `prisma/test.db`.
   - Copying *out of* OneDrive is allowed; never write into it.
   - Never connect to the server or the live DB.
   - Use 127.0.0.1 and a port other than 3001 (e.g. 3002).
6. **Don't run anything from the shared folder** `C:\Users\ilies\Documents\operations`. When your work is safe in your worktree:
   - move your untracked files (`src/lib/trackingData.ts`, this `director-insights-plan/` folder) into it;
   - tell the lead.

   The lead will then reset the shared folder to `main` and delete the old `nextjs-15-upgrade` branch, but not before you confirm.
7. **When done:** send the branch and commit, plus test results: tsc, build, unit tests, the before/after tracking diff, the access matrix and snapshot idempotency. The lead reviews, tests on its own copy, merges and deploys. Ilies ticks Yoel and Nick afterwards.
