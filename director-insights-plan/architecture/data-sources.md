# Source-system map — Director Insights

Surveyed 24 Oct 2026. Re-check before relying on it if it's been a while.

## Systems found

| System | What it is | Where it runs | Usable as a source? |
|---|---|---|---|
| **Operations** | Next.js 14 + Prisma + SQLite. Projects, daily allocation board, costing, day close, supplier invoices, hire register, sign-ins, timesheets, site requests, tools, plant/vehicles. | AWS Lightsail, Sydney. `ops.lobostools.com.mx` behind Cloudflare Access + app login. Nightly backups. | **Yes, this is the main source.** Live, validated in places, already has roles and money-guard rules. |
| **Lobos Estimating** | Local tender estimating app (JSON files). Build-up, programme, risk, tender total. | Laptop only (`127.0.0.1:4310`). Not reachable from the cloud. | **Not yet.** It holds example data only, and it isn't linked to Operations projects. It could become the pipeline/estimate source later. |
| **Operate-System-Overview** | Docs for the retired "Operate" app (Operations' predecessor). | OneDrive folder | No. History only. |
| **OneDrive / SharePoint** | Job folders, contracts, quotes, rate sheets. | Microsoft 365 | Read-only reference, via "propose, then apply" into Operations. Not a live metric source. |
| **Outlook** | Work mailbox | Microsoft 365 | Read-only, only on request. Not a metric source. |
| **Accounting (Xero?)** | Client invoicing, receivables, payments, cash. | Unknown. The Operations schema says "Xero later". | **Not connected.** This is the biggest gap. Needs confirming. |

## What Operations can answer today

| Director question | Operations data | Confidence |
|---|---|---|
| What are we spending, on which jobs, on what? | `costAllocation()` over Job/Assignment, frozen `AllocationCost` on closed days, `InvoicedCost`, hire estimates (`hireEstimate`), historical `LabourCost` | HIGH on closed days with confirmed rates. MEDIUM on open days. LOW where rates are TBC (`RATE_UNCONFIRMED`) or missing (`RATE_MISSING`, `HOURS_UNKNOWN`). |
| Which jobs are heading over their contract value? | Tracking health: forecast cost ÷ `Project.contractValue`. Watch at 80%, Act at 100% (confirmed by you). | MEDIUM. Forecast = spent + still to come (booked days, hire to finish, unbilled labour hire), **not** a cost-to-complete. Can't be assessed where there's no contract value. |
| What's starting or finishing soon, and is it ready? | `Project.startDate` / `expectedCompletion` + confidence, `upcomingStarts()` readiness (supervisor/lead on day one) | MEDIUM. Depends on dates being kept current. |
| Do we have the people? | Personnel register, board allocations (booked demand), `SiteAttendance` (actual), `TimesheetWeek` | HIGH for actual hours from sign-ins. Booked demand is only as far ahead as the board is filled. |
| Supervisor coverage | Assignment roles on upcoming jobs | MEDIUM |
| Owned plant use, plant down, servicing | Resource status, board days, `serviceDue` (free text), `ServiceRecord` | MEDIUM. `serviceDue` is free text, so it needs cleaning before it can drive an alert. |
| Hired plant exposure | Hire register (`hireStatus`, on/off-hire dates, rate, delivery/collection), plant-hire invoices | MEDIUM. Estimates until invoiced. |
| Site bottlenecks and responsiveness | `SiteRequest` + `SiteRequestEvent` (kind, priority, needed-by, outcome, timestamps) | HIGH |
| Safety signals | Only `SiteRequest` kind `SAFETY` and tool issues | LOW. **No incident register exists.** |

## What nothing can answer yet (gaps)

| Needed for | Missing data | Likely source |
|---|---|---|
| Revenue, gross profit, **margin** | Client invoices / progress claims | Accounting system |
| Receivables, overdue payments, cash | Invoices issued, payments received, bank | Accounting system |
| Variations (approved / pending) | Variation register | New register in Operations, or contract tracker |
| Budget vs actual by cost category | Each job's estimate broken down by category | Lobos Estimating, once linked to Operations projects |
| Pipeline, tender value, win rate | Tender register | Lobos Estimating (moved off the laptop) or a simple register in Operations |
| Incidents, near misses, corrective actions | Incident register | New safety module, or the existing safety system if there is one |
| Licence / ticket expiries | Structured tickets with expiry dates (`Resource.tickets` is free text) | Operations, after a small schema change |
| Overheads, company-level P&L | Overheads, salaries | Accounting system |
| Absenteeism, overtime | Award / rostering rules applied to sign-in data | Operations (derivable later, needs your rules) |

## Integration rules (from the brief)

- Operations stays the system of record for everything it already holds. Director Insights **reads**. It never writes back to operational records.
- Each future source (accounting, estimating, safety) is pulled **one way, into Operations**. Nothing syncs in both directions.
- Every metric shows **last refreshed** and which source it came from. If a source fails, the metric shows as stale. It never quietly shows the old number as if it were current.
