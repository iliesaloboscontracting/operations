# KPI dictionary — Director Insights (draft v0.1)

> **Superseded for the build (24 Oct 2026):** the live definitions are `src/lib/insights/dictionary.ts`, shown at `/directors/kpis`. Changes since this draft: labour hire share uses the last full month (agencies invoice late), and owned plant use is low-confidence under 10% (plant is rarely booked on the board).

Draft for approval, 24 Oct 2026. Nothing here is built yet.

**Status key**
- **Ready**: can be calculated from Operations today, using logic that already exists.
- **Confirm**: can be calculated, but the definition or threshold needs your sign-off (or Finance's).
- **Blocked**: no source data yet (see `architecture/data-sources.md`).

**Value labels** (shown on every number, per brief §11 and §51): *Actual* (closed, frozen day) · *Estimated* (open day or hire estimate) · *Invoiced* (supplier invoice) · *Forecast* · *Manual* · *Stale* · *Incomplete*.

**Confidence**: HIGH = closed days with confirmed rates · MEDIUM = live open days, or some rates unconfirmed · LOW = TBC rates, missing contract value, or estimates only.

One rule above all: **no KPI is called "margin" or "profit" until revenue comes from the accounting system.** Today Operations knows cost, not revenue.

---

## Financial (cost side only)

| ID | KPI | Business meaning | Formula | Units | Source | Refresh | Target / Warn / Critical | Exclusions & notes | Status |
|---|---|---|---|---|---|---|---|---|---|
| F1 | **Cost to date** | What a job (or the company) has cost so far | Σ locked + estimated + invoiced per day, as Tracking calculates (`/api/tracking`, `sumDays`) | $ ex GST | Operations: `AllocationCost`, `costAllocation()`, `InvoicedCost`, `hireEstimate`, `LabourCost` | Live; frozen on day close | n/a | Excludes overheads, office salaries, subcontracts not on the board or invoiced. Must show its locked/estimated/invoiced split. | Ready |
| F2 | **Forecast booked cost** | Cost to date plus cost already booked but not yet spent | F1 + still to come (booked board days, hire to its finish date, unbilled labour hire) | $ ex GST | Operations Tracking `forecastCost` | Live | n/a | **Not** a cost-to-complete: work not yet on the board isn't in it. Label it "booked", never "final". | Ready |
| F3 | **Contract value used** | How much of the agreed job value the forecast cost will consume | F2 ÷ `Project.contractValue` | % | Operations | Live | Watch ≥ 80%, Act ≥ 100% | Your thresholds, already used on Tracking. No contract value → "Can't assess". Variations are not included (no register yet). | Ready |
| F4 | **Spend by month** | Company cost trend | Σ F1 by calendar month, split by category (Own crew, Labour hire, Hired plant, Our plant, Attachments, Trucks, Tip fees, Materials) | $ ex GST | Operations | Live | Comparison: previous month, same month last year once there's history | The current month is shown as "so far" and isn't compared like-for-like. | Ready |
| F5 | **Labour hire share** | How dependent we are on agency labour | Labour hire ÷ (Own crew + Labour hire), per month | % | Operations | Live | Confirm a target | Own crew on TBC rates makes this LOW confidence. | Confirm |
| F6 | **Hired plant exposure** | What hired plant is costing and committing us to | Σ hire cost to date + to off-hire date for items not `RETURNED` | $ ex GST | Hire register, plant-hire `InvoicedCost` | Live | Confirm a threshold | Invoice replaces estimate for covered days (existing rule). | Ready |
| F7 | **Uncosted lines** | Cost we know exists but can't price | Count (and job list) of allocations with status `RATE_MISSING` or `HOURS_UNKNOWN` | count | `costAllocation()` | Live | Target 0. Warn > 0 on an active job | Data quality KPI. Makes F1–F3 understated. | Ready |
| F8 | **Unconfirmed rates** | Cost priced on draft (TBC) pay or hire rates | Count of `RATE_UNCONFIRMED` lines, and the $ they carry | count, $ | `costAllocation()` | Live | Target 0 | Data quality KPI. | Ready |
| F9 | Revenue, gross profit, gross margin, forecast margin | — | — | — | Accounting system | — | — | Needs client invoices / claims | **Blocked** |
| F10 | Receivables, overdue receivables, cash position | — | — | — | Accounting system | — | — | | **Blocked** |
| F11 | Approved / pending variations, revised contract value | — | — | — | Variation register | — | — | | **Blocked** |
| F12 | Budget vs actual by cost category | — | — | — | Estimate linked to project | — | — | `contractValue` is the only "budget" today | **Blocked** |

## Operations & workload

| ID | KPI | Business meaning | Formula | Units | Source | Refresh | Target / Warn / Critical | Notes | Status |
|---|---|---|---|---|---|---|---|---|---|
| O1 | **Active projects** | Current workload | Projects `status = ACTIVE`, not archived, with a job in the last 14 days or future | count | Operations | Live | n/a | Show the trend vs 4 and 12 weeks ago (needs snapshots). | Ready |
| O2 | **Starting in next 30 days** | Incoming work | Projects with `startDate` in [today, today+30], split CONFIRMED / TENTATIVE / unknown | count + list | Operations | Live | n/a | Tentative starts are labelled, never counted as firm. | Ready |
| O3 | **Starts not ready** | Starts at risk | `upcomingStarts()`: no Supervisor/Lead on day one, within 7 days | count + list | Operations | Live | Critical if ≤ 2 days out, High if ≤ 7 | Existing rule (16 Oct 2026). | Ready |
| O4 | **Completing in next 30 days** | Work rolling off, capacity freeing up | `expectedCompletion` in [today, today+30] | count + list | Operations | Live | n/a | TBC completions past `completionReviewBy` show as a data-quality flag. | Ready |
| O5 | **Days not closed** | Cost still moving / not locked | Past working dates with jobs and no `DayClose` CLOSED | count | `DayClose` | Live | Warn > 3, Critical > 10 | Drives F1 confidence. | Confirm thresholds |
| O6 | **Open site requests** | Site bottlenecks | `SiteRequest` not DONE/DECLINED/CANCELLED/CANT_DO, by priority; overdue = past `neededBy` | count | Operations | Live | Critical: any Urgent overdue | | Ready |
| O7 | **Request turnaround** | How fast the office responds to site | Median SENT → DONE time, last 4 weeks, by priority | hours | `SiteRequestEvent` | Daily | Confirm target | | Confirm |

## People

| ID | KPI | Business meaning | Formula | Units | Source | Refresh | Target / Warn / Critical | Notes | Status |
|---|---|---|---|---|---|---|---|---|---|
| P1 | **Hours worked per week** | Labour effort trend | Σ signed hours less unpaid break, by week, staff vs hire workers | hours | `SiteAttendance` | Live | n/a | Only since sign-ins began (19 Oct 2026). Earlier weeks are Incomplete. | Ready |
| P2 | **Active crew** | Headcount available | Active PERSONNEL resources, excluding Office, by category | count | Resource register | Live | n/a | No names on the director view. | Ready |
| P3 | **Booked labour demand, next 14 days** | Do we have enough people? | People allocated per working day vs P2 (less LEAVE) | people/day | Board allocations | Live | Warn when demand > available on any day | Only as far ahead as the board is filled. Labelled "booked". | Confirm |
| P4 | **Supervisor coverage, next 14 days** | Jobs without a leader | Upcoming running jobs with no Supervisor/Lead assigned | count + list | Assignments | Live | Critical if within 2 days | | Ready |
| P5 | Licence / ticket expiries, competency gaps | — | — | — | Structured tickets | — | — | `tickets` is free text today | **Blocked** |
| P6 | Absenteeism, overtime | — | — | — | Sign-ins + your award rules | — | — | | **Blocked** |

## Plant & fleet

| ID | KPI | Business meaning | Formula | Units | Source | Refresh | Target / Warn / Critical | Notes | Status |
|---|---|---|---|---|---|---|---|---|---|
| PL1 | **Owned plant utilisation** | Are we using what we own? | Days allocated ÷ working days in period, per item and fleet | % | Board allocations, Resource (EQUIPMENT, OWNED) | Daily | Confirm target. Flag items < 30% over 4 weeks as idle | Working days = Mon–Fri, plus Saturdays worked. Needs your rule. | Confirm |
| PL2 | **Plant down** | Breakdown impact | Resources with `status = DOWN` | count + list | Resource register | Live | n/a | | Ready |
| PL3 | **Hire coming off / overdue** | Hire cost leakage | Existing `offHireAlert()`: overdue, today, within 3 days | count + list | Hire register | Live | Critical: overdue | Existing rule. | Ready |
| PL4 | **Owned vs hired plant days** | Should we buy or keep hiring? | Board days on hired plant vs owned plant, by class, per month | days | Allocations | Daily | n/a | | Ready |
| PL5 | Servicing due | — | — | — | `serviceDue` | — | — | Free text. Needs typed dates first. | **Blocked** |

## Commercial & safety

| ID | KPI | Status |
|---|---|---|
| C1 | Pipeline value, tender stage, win rate, awarded vs unawarded | **Blocked**: needs a tender register |
| C2 | Time bars, notices, retention, LDs, disputes | **Blocked**: needs a contract register |
| S1 | Open safety requests from site (`SiteRequest` kind SAFETY) | Ready, but **shown only as a proxy** and labelled that way |
| S2 | Incidents, LTIs, near misses, corrective actions, recurring hazards | **Blocked**: needs an incident register |

## Data-quality KPIs (shown to directors, per brief §26–27)

| ID | Check | Source |
|---|---|---|
| DQ1 | Active projects with no contract value | `Project.contractValue` null |
| DQ2 | Active projects with no start or completion date | `Project` |
| DQ3 | Uncosted lines / unconfirmed rates | F7, F8 |
| DQ4 | Days not closed | O5 |
| DQ5 | Invoices waiting for a person in the inbox | `InvoiceDraft` NEEDS_REVIEW / NO_JOB |
| DQ6 | Active jobs with no job number or client | `Project` |
| DQ7 | Hire items with no off-hire date or rate | Resource (HIRE) |

## Validation (before any KPI goes live, per brief §38)

Each Ready/Confirm KPI gets a calculation test using `tsx --test`, which is already installed, so there's no new dependency. Every test covers:
- a hand-worked sample reconciled to the Tracking page for one closed job;
- zero and blank values, missing contract value, TBC rates;
- a date boundary at month and week edges (Mon–Sun weeks);
- duplicate protection (invoice replaces hire estimate).

Financial KPIs (F1–F8) also get a one-off reconciliation against one real job, signed off by you before the page is switched on.
