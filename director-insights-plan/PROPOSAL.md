# Director Insights: proposal for approval

Prepared 24 Oct 2026 for Iliesa (product owner). This is a **Large** change under the brief's permission gate, so nothing has been built. Supporting files:

- `architecture/data-sources.md`: what systems exist and what each can answer
- `kpis/kpi-dictionary.md`: every proposed metric, its formula, source, thresholds and status
- `architecture/home-screen.md`: the Phase 1 director screen

---

## Current State

- **Operations** (cloud, `ops.lobostools.com.mx`) is the one live business system. It holds projects, the daily allocation board, labour/plant/hire costing with day close, supplier invoices (including the new invoices inbox), the hire register, site sign-ins and timesheets, site requests, and the plant, vehicle and tool registers.
- It already has a **Tracking** page that shows cost per job against contract value, exceptions first (Watch at 80%, Act at 100%). It also has start-readiness alerts, off-hire alerts and a read-only AI assistant.
- Directors (Yoel, Nick) are Admins in Operations, so today they see the operational screens, not a business overview.
- **Lobos Estimating** runs only on the laptop, with example data. It isn't linked to Operations.
- **No accounting system is connected.** Operations knows what jobs *cost*, not what they *earn*.

## Problem

1. No single screen tells a director how the company is doing. The information is spread across Tracking, Projects, Hire, Requests and Sign-ins, and it's built for running the day, not for oversight.
2. The questions directors care about most (are we making money, who owes us, what's in the pipeline, are we safe) **can't be answered by any system today**, because revenue, receivables, tenders and incidents aren't recorded anywhere Operations can read.
3. Without definitions, there's a risk of someone presenting "cost vs contract value" as margin, or a booked forecast as a final cost.

## Proposed Change

Build **Director Insights as a section inside Operations** (`/directors`), in phases.

**Phase 1: Director overview from Operations data (no new outside systems)**
- The home screen in `home-screen.md`: needs-attention list, cost and contract position, workload, capacity, cost trend, plant/hire, people, and a data-confidence panel that names what isn't available yet.
- An in-app KPI dictionary (each "?" opens the formula, source and last refresh).
- A **weekly snapshot** table, so trends like "jobs at Act over time" and "forecast at the start of the month" can be shown later. Live data can't rebuild those.
- Calculation tests for every Phase 1 KPI, and a one-off reconciliation of one real job with you before switch-on.
- Small database additions only: a snapshot table, plus a director-access flag if you pick that option (see Decisions).

**Phase 2: Act on it**
- Management actions (exception → owner, due date, status), a decision log, and meeting mode (a one-page board pack PDF).

**Phase 3: Money in (needs its own approval)**
- Read-only connection to the accounting system for invoices issued, payments and receivables. Then real revenue, gross profit and margin per job, overdue payments and cash pressure.

**Phase 4: Fill the remaining gaps (each its own approval)**
- Tender register / pipeline (move Estimating off the laptop or add a simple register), variations register, incident register, structured licence expiries, typed service-due dates.

## Business Benefit

- Directors get one trusted screen that says what needs them, with every number traceable to its source.
- It turns exceptions already sitting in Operations into something directors see: jobs over contract value, starts with no supervisor, hire left running, urgent requests stuck.
- It makes data gaps visible (missing contract values, TBC rates, days not closed), which pushes the data to get better.
- Phase 3 finally answers "are we making money, and where".

## Technical Impact

- New pages under `src/app/directors`, and new read-only API routes under `src/app/api/directors`.
- New KPI functions in `src/lib/insights/`. They **reuse** `costAllocation`, `trackingView`, `upcomingStarts`, `offHireAlert` and the Tracking API's cost logic rather than copying them, so a director number and a Tracking number can't drift apart.
- One new navigation entry, shown only to people with director access.
- Uses Recharts, which is already installed. No new runtime dependency. Tests run on the `tsx` already installed.
- Deployed the same way as every Operations change (test on a copy → build → restart on Lightsail).

## Data Impact

- **Read-only** over existing records. Nothing operational is changed or recalculated.
- New table: `KpiSnapshot` (week, KPI id, value, confidence, source note). It's append-only and never overwritten.
- Possibly a `directorAccess` flag on `User` (see Decisions).
- Phase 2 adds `ManagementAction` and `DirectorDecision` tables. Phase 3 adds tables for accounting data.
- Financial figures stay off every crew-facing view. The money-guard rules are unchanged.

## Risks

| Risk | Mitigation |
|---|---|
| Directors read cost burn as margin | Never labelled margin. "Revenue & margin: not yet available" shown until Phase 3. |
| Numbers look precise when the data is thin (TBC rates, missing contract values, open days) | Every number carries a label and confidence. A data-confidence panel sits on the home screen. |
| A director figure differs from Tracking | Shared functions, plus a test that compares both for the same job. |
| Directors see sensitive data they shouldn't, or others see director data | Server-side guard on every director route. Access list agreed with you. |
| Slower Operations pages | Director queries are separate routes. The weekly snapshot runs at night, using the existing background timer pattern. |
| Breaking Operations | Same throwaway-database workflow. Read-only routes. Clean commit boundary, easy to revert. |

## Alternatives

| Option | Pros | Cons |
|---|---|---|
| **A. Section inside Operations (recommended)** | One database, so one source of truth. Reuses existing costing logic, login, Cloudflare Access, backups and deploy. No new running cost. | Operations grows. Director releases ride the same deploy. |
| B. Separate director app reading Operations' API | Fully independent screens | A second server, login and deploy. Either duplicated business logic or a new API surface to secure. Data is only as fresh as the last sync. More to maintain. |
| C. Power BI / Excel over exported data | Familiar to finance | Per-user licence cost. The cloud SQLite database isn't directly reachable, so it needs an export pipeline. KPI logic would be re-written in a second place and drift. No link back to the record. |

## Migration / Rollback Plan

- Phase 1 changes no existing data. Rolling back means removing the navigation entry, or reverting the commit and redeploying. The snapshot table can be left in place harmlessly.
- Back up the database before the deploy that adds the new table, as with every schema change.

## Recommendation

Approve **Option A, Phase 1**, after the decisions below are answered. Phases 2–4 come back to you separately.

---

## Decisions needed from you

1. **Where it lives**: inside Operations (recommended), or a separate app?
2. **Who can see it**: just you, Yoel and Nick? Choose either (a) every Admin, which is simplest but means any future Admin sees it, or (b) a separate director-access tick on named users (recommended).
3. **Accounting system**: is it Xero? Who owns the financial definitions (your accountant, or a director)? This decides Phase 3.
4. **Thresholds to confirm** (marked *Confirm* in the KPI dictionary): days not closed (warn 3 / critical 10), idle plant (< 30% over 4 weeks), labour hire share target, request turnaround target, and what counts as a working day for plant utilisation.
5. **Snapshots**: OK to start recording weekly values from the first deploy? Trend lines only exist from that date forward.

## Estimated effort (Phase 1)

About 4–6 working sessions: data layer and tests (2), home screen and drill-downs (2), reconciliation with you and deploy (1). This is a rough guide, not a commitment.
