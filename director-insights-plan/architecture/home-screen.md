# Director home screen: Phase 1 proposal

Goal: a director opens it and knows within 10 seconds **what needs them**, then **how the business is tracking**. The order on the page follows the brief: action first, then position, trend and variance.

Route: `/directors` in Operations. It works on phone and tablet, and every number drills down to the existing page that holds the detail.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Director overview          Week of 20 Oct 2026     Data as of 10:42am ●  │
│                                            [ This week | Month | Quarter ]│
├──────────────────────────────────────────────────────────────────────────┤
│ 1. NEEDS ATTENTION                                (critical first, max 7) │
│  ● CRITICAL  Smith St: forecast booked cost 104% of contract value  →     │
│  ● CRITICAL  Parramatta starts Tue: no supervisor allocated          →    │
│  ● HIGH      2 hired excavators overdue off-hire (Hire Express)      →    │
│  ● HIGH      Urgent site request R-0142 past needed-by (3h)          →    │
│  ● MEDIUM    6 days not closed (costs still moving)                  →    │
│                                               [ See all 11 exceptions ]  │
├───────────────────────────┬───────────────────────────┬──────────────────┤
│ 2. COST & CONTRACT        │ 3. WORKLOAD               │ 4. CAPACITY       │
│ Spend this month so far   │ Active projects       14  │ Booked crew demand│
│ $412k  (Estimated 61%)    │   ▲2 vs 4 wks ago         │ next 14 days      │
│ vs last month at same     │ Starting ≤30 days      5  │ ▁▃▅▇▇▅▃ vs crew   │
│ point: $388k ▲6%          │   (3 confirmed, 2 tent.)  │ Short on Tue 4 Nov│
│                           │ Completing ≤30 days    3  │ Supervisors: 1 job│
│ Jobs vs contract value    │ Starts not ready       1  │ uncovered ≤14 days│
│  Act 1 · Watch 3 · OK 8   │                           │                   │
│  Can't assess 2           │                           │                   │
├───────────────────────────┴───────────────────────────┴──────────────────┤
│ 5. COST TREND: weekly spend, last 12 weeks, stacked by category         │
│    (Own crew / Labour hire / Hired plant / Our plant / Trucks / Tip /…)  │
│    $ ex GST · Mon–Sun weeks · current week marked "so far"               │
├───────────────────────────┬──────────────────────────────────────────────┤
│ 6. PLANT & HIRE           │ 7. PEOPLE                                    │
│ Owned plant use (4 wks)   │ Hours worked / week (staff vs hire)          │
│ 58%  · 2 idle · 1 down    │ Labour hire share of labour cost: 34%        │
│ Hired plant exposure $63k │                                              │
├───────────────────────────┴──────────────────────────────────────────────┤
│ 8. DATA CONFIDENCE                                                       │
│ 2 active jobs have no contract value · 9 cost lines on TBC rates ·       │
│ 6 days not closed · 4 invoices waiting in the inbox                      │
│ NOT YET AVAILABLE: revenue & margin, receivables & cash, pipeline,       │
│ incidents (no source connected)                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

*(The figures above are made up, to show the layout only.)*

## Rules for every panel

- Each number has a **label** (Actual / Estimated / Invoiced / Forecast), a **comparison** (previous period, or the threshold) and a **"?"** that opens its KPI-dictionary entry: formula, source and last refresh.
- Traffic-light colours appear **only** where a threshold is defined in the dictionary.
- Nothing calls cost "margin". The "Not yet available" line stays visible until a source is connected, so nobody reads a missing number as zero.
- Clicking through goes to existing pages (Tracking job page, Projects, Requests, Hire, Plant). The drill-down isn't rebuilt.
- No personal pay rates, and no individual names except where an action needs one (for example, "no supervisor on X").

## Drill-down by cause (brief §17)

"Act" on a job opens the existing `/tracking/[id]` page with the forecast broken into what drove it: category over-run vs last 4 weeks, hire still running, labour hire share, uncosted lines. This reuses `trackingView.ts`, so the maths isn't duplicated.

## Later phases (not in Phase 1)

- **Meeting mode**: a one-page board pack (exceptions, movements since last review, decisions needed, overdue actions), printable with the PDF renderer Operations already uses.
- **Management actions and decision log**: turn an exception into an owner, due date and status, and see it on the next review.
- **Revenue, margin and cash**: added once the accounting system is connected.
