# Director Insights: Phase 1 build plan (for lead review)

Draft, 24 Oct 2026. Builds what Iliesa approved in `PROPOSAL.md`: inside Operations, named director tick, weekly snapshots from the first release, draft thresholds labelled "draft". Read-only over existing data. No write routes except the director tick.

## 1. Pages and who sees them

| Page | What it is |
|---|---|
| `/directors` | Home: needs attention → cost & contract → workload → capacity → 12-week cost trend → plant & hire → people → data confidence (layout in `architecture/home-screen.md`) |
| `/directors/kpis` | KPI dictionary: formula, source, thresholds (draft flag), confidence rule. Rendered from a static TS constant, so it needs no API. |

**Access rule** (`hasDirectorAccess` in `src/lib/auth.ts`): the owner (always), or a user with `directorAccess = true`. Never TIMESHEETS or ACCOUNTS, even if the flag is set in the database.
- The "Directors" nav tab shows only when `/api/auth/me` says `directorAccess`. The pages hold no data themselves: all data comes from guarded routes.
- **Only the owner can set or clear the tick** (Users page → edit user). The field isn't shown to anyone else, and the API refuses it with a 403. Iliesa ticks Yoel and Nick himself after deploy. I don't change any data.

## 2. API routes

| Route | Guard | Notes |
|---|---|---|
| `GET /api/directors/overview` (new) | `guardDirector()`: signed in + `hasDirectorAccess`, re-read from the database on every call | One payload for the home page: live KPIs + the latest snapshots for trend arrows. Calls `loadTracking({ withPeople: false })`, so no per-person pay or labour lines. |
| `GET /api/tracking` (changed, same behaviour) | `guard("MANAGER")`, unchanged | The body moves to `src/lib/trackingData.ts` → `loadTracking({ withPeople })`, and the route becomes a thin wrapper. Same JSON, same per-person rule (Admins only). |
| `PATCH /api/users/[id]` (changed) | `guard("ADMIN")`, unchanged; `directorAccess` owner-only | Rejects the tick for TIMESHEETS / ACCOUNTS. |
| `GET /api/users` (changed) | unchanged | Adds `directorAccess` to the returned fields. |
| `GET /api/auth/me` (no code change) | unchanged | Returns `directorAccess` via `getCurrentUser()`. |

No `/api/directors` write routes in Phase 1. The AI assistant gets no access to director data in Phase 1.

## 3. Schema changes (for your review before any database is touched)

```prisma
model User {
  ...
  directorAccess Boolean @default(false)   // owner-only to set; owner always has it
}

model KpiSnapshot {
  id         String   @id @default(cuid())
  weekStart  String   // YYYY-MM-DD, Monday (Sydney) of the week taken
  kpi        String   // id from lib/insights/dictionary.ts, e.g. "O1", "F3_ACT"
  value      Float?   // null = couldn't be worked out
  detail     String?  // optional JSON (e.g. counts by status)
  confidence String?  // HIGH | MEDIUM | LOW
  createdAt  DateTime @default(now())
  @@unique([weekStart, kpi])
  @@index([kpi])
}
```

Both are additive: a new column with a default, plus a new table. No existing data changes. Rollback: the column and table can stay unused.

**How snapshots are written** (`src/lib/insights/snapshot.ts`, called from the existing one-minute tick in `src/instrumentation.ts`):
- The tick checks at most once an hour, in memory: "is there any `KpiSnapshot` for this Monday?" (an indexed count). If not, it computes the overview once and inserts one row per KPI (about 20 rows).
- **So it runs once a week:** the first check after Monday 00:00 Sydney, and once straight after the first deploy.
- **Append-only:** it inserts and never updates. A unique-key clash (another check racing, or a restart mid-write) is ignored, never overwritten. Nothing deletes snapshots.
- It's a full `loadTracking()` once a week, so negligible load.

## 4. Existing files that change

| File | Change | Why |
|---|---|---|
| `prisma/schema.prisma` | The two additions above | Access and history |
| `src/lib/auth.ts` | `directorAccess` on `AuthUser`, `hasDirectorAccess()`, `guardDirector()`, `getCurrentUser()` fills the flag | Server-side director gate. Built on your awaited `cookies()`. |
| `src/app/api/tracking/route.ts` → `src/lib/trackingData.ts` (new) | Logic moved **unchanged**, from the merged Next 15 file (your daily / stillToCome / forecast / attention work), not from my old copy | One source of cost truth for Tracking and Directors |
| `src/lib/trackingView.ts` | Add `weeklyByCategory()` (additive) | The 12-week stacked trend by category. Existing functions are reused as they are. |
| `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/users/page.tsx` | Director field, owner-only, "Director" badge | Grant and revoke the tick |
| `src/components/AuthProvider.tsx`, `src/components/TopNav.tsx` | `isDirector`, plus a "Directors" tab first in the nav | Navigation |
| `src/instrumentation.ts` | One more call in the existing tick | Weekly snapshot |
| `CLAUDE.md` | Short "Director Insights" note | Keep the manual current |

New files:
- `src/lib/insights/dictionary.ts`, `kpis.ts` (pure functions), `load.ts` (server loader), `snapshot.ts`, `kpis.test.ts`
- `src/app/api/directors/overview/route.ts`
- `src/app/directors/page.tsx`, `src/app/directors/kpis/page.tsx`
- `src/components/directors/*`, which reuse `src/components/tracking/parts.tsx` (Card, Tile, StatusPill, SpendBar, Sparkline, CategoryBars, HEALTH)

`package.json`: no new dependency. Tests run with the `tsx` already installed (`npx tsx --test`). I'd only add a `"test"` script if you agree.

## 5. KPIs and charts, with sources

Costs are **never recomputed**. They come from `loadTracking()` fields and `trackingView.ts`.

| Panel | KPI | Source |
|---|---|---|
| Needs attention | Tracking `attention` mapped: act→CRITICAL, watch→MEDIUM, data→INFO. Plus: starts not ready (`upcomingStarts()`, ≤2 days CRITICAL / ≤7 HIGH), hire overdue off-hire (`offHireAlert()`, HIGH), urgent request past needed-by (CRITICAL), jobs ≤14 days with crew but no Supervisor/Lead (≤2 days CRITICAL, else MEDIUM, deduped against starts), days not closed (> 10 HIGH, > 3 MEDIUM, **draft**) | trackingData, alerts.ts, hireEstimate.ts, SiteRequest, Job/Assignment, DayClose |
| Cost & contract | Spend this month so far vs the same days last month, split locked+invoiced / estimated (`sumProjects` + `periodRange`). Job health counts (`health`). Still to come (Σ `stillToCome`, active). | trackingData + trackingView |
| Workload | Active projects (ACTIVE, not archived, job in the last 14 days or future). Starting ≤30 days by `startDateConfidence`. Completing ≤30 days. Trend vs the snapshot 4 weeks back ("no history yet" until then). | Project, Job, KpiSnapshot |
| Capacity | Booked crew per working day, next 14 days (own crew distinct, labour hire separate) vs active crew (PERSONNEL, not Office, not LEAVE). Labelled "booked". | Job/Assignment, Resource |
| Cost trend | 12 weeks, stacked by category (`weeklyByCategory`, `CAT_LABELS`), current week "so far" | trackingData `daily` |
| Plant & hire | Owned plant use over the last 28 days (allocated days ÷ working days, Mon–Fri + Saturdays worked; idle < 30%, **draft**). Plant DOWN count. Hired plant still out (Σ `hireItems.costToDate` not RETURNED + `hireToCome`). | Assignment, Resource, trackingData |
| People | Signed hours per week, staff vs hire, 8 weeks (before 26 Oct marked "trial / incomplete"). Labour hire share = labourHire ÷ (ownCrew + labourHire) per month. | SiteAttendance, trackingData `daily.cat` |
| Data confidence | No contract value (`CANT_ASSESS`). Uncosted / unconfirmed (`uncostedCount`, `unconfirmedCount`). Days not closed. Invoices waiting (`InvoiceDraft` NEEDS_REVIEW / NO_JOB). Hire missing off-hire date or rate. A permanent "Not yet available" line (revenue & margin, receivables & cash, pipeline, incidents). | as listed |

Every number carries its label (Locked / Estimated / Invoiced / Forecast / Booked), its comparison, and a "?" link to its dictionary entry. Nothing is called margin.

## 6. Money-guard impact

- No crew-facing or operational view changes. Day sheets, Day Review, Yard and site links are untouched, and `check-viewer-safety.ts` still applies as it is.
- `/api/directors/*` carries dollar figures **by design**, gated to directors only, which is tighter than Tracking (Manager+).
- No per-person pay rate or per-person cost goes in the director payload (`withPeople: false`). Names appear only where an action needs one: job and project names, hire item and supplier.
- The Users page shows the tick to the owner only. It carries no figures.

## 7. Test plan (on a copy, after your schema review)

1. `npx tsc --noEmit`, `next build`, `next lint`.
2. **Unit tests** (`npx tsx --test src/lib/insights/kpis.test.ts`) with hand-worked fixtures:
   - month-so-far vs last month;
   - Mon–Sun week edges;
   - working days with a worked Saturday;
   - idle < 30%;
   - days-not-closed cutoff (2026-09-26);
   - crew demand with LEAVE and Office excluded;
   - no-supervisor dedupe against starts;
   - labour hire share with zero labour;
   - missing contract value;
   - urgent request overdue at the needed-by boundary.
3. **On a copy of live data** (you supply it, or say where to pull it from; a throwaway `.db` inside `prisma/`, `127.0.0.1:3001`):
   - `prisma db push` on the copy. Table row counts are the same before and after, and the new column defaults to false.
   - **Reconcile:** for 2 active jobs (one closed-days-heavy, one with hire), the Directors figures equal the Tracking page figures (cost to date, still to come, forecast, health).
   - **Access matrix:** owner sees it. A ticked Admin sees it. An unticked Admin, a Manager and a Viewer get a 403 on the API and no tab. TIMESHEETS / ACCOUNTS with the flag forced on still get a 403. A non-owner Admin can't change the tick (403).
   - **Snapshots:** the first tick writes about 20 rows for this Monday. A second tick and a server restart write nothing new. Faking the next week writes a new set and leaves the old one untouched.
   - Page loads in under 2 s on the copy. It works at phone width (375 px).
4. Hand over the branch and commit to you. You review, test on your copy, merge and deploy. Iliesa then ticks Yoel and Nick on the Users page.
