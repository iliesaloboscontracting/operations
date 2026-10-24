# Lobos Central Intelligence (LCI): improved plan, v2 (draft for approval)

*By the Operations Building Agent (lead builder), 24 Oct 2026. Reviews and improves
"LOBOS_Central_Intelligence_Technical_Specification_v1.md". Nothing is built yet. This plan is for Ilies to approve
(and the directors, for the decisions in section 9).*

---

## 1. Verdict on v1 in one paragraph

The v1 spec has the **right goals and the right safety rules**, but it plans the **wrong size of platform**. Its
first goal, "daily site log → labour variance → finding → management review → documented outcome", is exactly
what Lobos needs. Its rules are sound: deterministic rules before AI, no invented costs, evidence on every finding,
approval tiers and separation of duties. Its delivery plan, though, is a new enterprise platform on Azure with
**about 12 separate cloud services**: API gateway, Postgres, Service Bus, AI Search, Azure OpenAI, Container Apps,
Key Vault, monitoring, Terraform and CI/CD across dev/staging/prod environments. It would also bring a second
programming language (Python) and a second identity system. That stack suits a company with an IT department. Lobos
has one product owner and AI builders. Also, **most of the data and about a third of the mechanics it describes
already exist in Operations**. What's actually missing is a few pieces of *data*, not infrastructure. v2 keeps every
goal and safety rule in v1, builds them into the platform we already run, and leaves a clear, measured point where
moving to Azure would make sense.

## 2. What v1 asks for vs what already exists

| v1 component | Already in place | Real gap |
|---|---|---|
| Daily site log | Sign-ins (who and hours, per site), Day Review hours, site photos, site requests, all from the supervisor's phone link | **No production quantities** (m², m³, loads, linear m), **no coded delays**, no daily narrative |
| Allocations | The board (Job → Assignment), labour hire tiles, plant/trucks | None for v1 |
| Cost entries | Frozen day costs (`AllocationCost`), supplier invoices (`InvoicedCost`), invoices inbox, hire estimates | Reconciliation flag per cost (partly there: firm vs estimate) |
| Budgets / budget lines | Contract value only | **No budget per job or work package.** It lives in the Estimating app (work packages with quantity, production rate and cost) but never reaches Operations |
| Findings | Tracking attention list, off-hire alerts, date checks, odd sign-ins | **Not stored**: no owner, status, outcome or history |
| Recommendations / approvals | Site requests (Admin decides, Alex actions, full history); day close/reopen with reasons; office time edits with reasons | No **general** approval engine for system-proposed actions |
| Audit log | Request events, attendance edits, day-close records, the agent change-log CSV | No single app-wide audit trail |
| Knowledge / memory | Read-only Microsoft 365 connector; read-only AI assistant over live data | No indexed, permission-aware search over SharePoint documents |
| Identity | App login (scrypt, roles) + Cloudflare Access email PIN; supervisor links | None needed for v1 (Entra is optional, see section 5) |
| Director dashboard | Director Insights (in build: KPIs, weekly snapshots) | Showing findings in it |
| Estimating | Lobos Estimating (laptop only, JSON files, **no version control**; 380 quoting rates). Ilies and Yoel are trialling **separate copies on purpose** | Its estimates can't reach Operations; it stops when the laptop sleeps; estimates carry **no job number**, and package codes ("WP01") are free text, not unique or standardised |
| Shared project identity | Each app has its own IDs | **No common project code** across Operations, Estimating and OneDrive folders |

**So the v1 "definition of done" is blocked by four data gaps, not by missing cloud services:**
1. production quantities from site;
2. a budget baseline from Estimating;
3. stored findings with outcomes;
4. one project code shared by every app.

## 3. Improvements to the plan

1. **Build inside the current platform first.** LCI becomes a module of Operations: same server, database, login
   and deploy process. Separate Lobos apps keep running individually and connect through small, versioned data
   contracts (section 4). This is how "operating in sync while performing individually" works without a central
   enterprise bus.
2. **Fix the data before adding intelligence.** The first deliverables are the supervisor's 60-second daily log
   (quantities and delays) and the estimate-to-budget handoff. No rule can measure variance without them.
3. **One project code everywhere.** Use the Lobos job number as the key that Operations, Estimating, Director
   Insights and the OneDrive job folder all carry. Each app keeps its own internal IDs.
4. **Store findings as records with a lifecycle**: Open → Acknowledged → Actioned → Resolved / Dismissed (with
   reason) → Outcome verified. Today's attention list becomes the first source of findings, so nothing is thrown
   away.
5. **Keep v1's autonomy tiers (A0–A4), mapped to things Lobos actually does:**
   - A0/A1 (read, analyse, flag): automatic.
   - A2 (internal reminders, e.g. "no daily log from Jannali yet"): automatic, but only for message types on an
     approved list, with rate limits and a kill switch per rule.
   - A3 (change the board, move an off-hire date, update a benchmark): proposed, then approved by a named person.
     The approver must not be the requester. The exact change is fingerprinted, so it can't be altered after
     approval.
   - A4 (money, employment, contracts, safety documents): stays manual. LCI only prepares the information.
6. **AI explains, rules decide.** As in v1: deterministic rules raise findings. Claude (already used in four
   places) writes the explanation from cited records and never fills in a missing cost or quantity.
7. **Reuse the approval flow that already works.** The site-requests decide/assign/history flow becomes the basis
   for a general approval engine, so it isn't rebuilt from scratch.
8. **Close two foundation risks v1 assumed were solved:**
   - **Code backup.** Operations' code has no off-machine copy with history; the server gets a snapshot without
     history. Fix: private GitHub repositories.
   - **Automated tests.** Turn our existing test scripts into an `npm test` suite that must pass before every
     deploy. v1's acceptance gates, such as "100% of cross-project access attempts denied", then become real
     tests.
9. **Bring Estimating under control before connecting it:** put it under version control, then decide where it
   runs. It has the laptop-sleep problem that pushed Operations to the cloud.
10. **Measure before claiming improvement** (kept from v1): record a 4-week baseline on the pilot job (log
    completeness, alert accuracy, time to resolve) before switching on automatic reminders.

## 4. How the apps stay in sync (the "hub and spokes")

```
            Estimating (owns estimates, rates)                Director Insights (reads, KPIs)
                    │  "budget approved" export v1                      ▲  findings + KPIs (read-only)
                    ▼                                                   │
  Supervisor link ──► OPERATIONS (system of record: projects, jobs, allocations, actuals, costs)
  (daily log v1)              │
                              ├── LCI module: rules → findings → approvals → outcomes → lessons
                              │
                              └── "actuals" export v1 ──► Estimating benchmarks (estimator approves)
  Microsoft 365 (read-only) ──► evidence links / later document search
```

- **Each app owns its own data.** Others read through versioned contracts (JSON with `schema_version`) and never
  through each other's databases.
- **Every message carries:** the project code, a unique ID (so a resend is ignored), when it happened, its source,
  and its verification status. This is v1's event envelope without the Service Bus.

## 5. Technology decisions (v1 → v2)

| Layer | v1 | v2 (now) | When to revisit |
|---|---|---|---|
| Hosting | Azure Container Apps, 3 environments | Existing Lightsail server (Sydney) + test copies, as today | If uptime or scale needs exceed one server |
| Database | Azure Postgres | SQLite through Prisma (already); Prisma can switch to Postgres later | Several services writing at once, or DB over a few GB |
| Events | Azure Service Bus | An "outbox" table + a background worker in the app (the same pattern, done in-process) | Several separately deployed services exchanging events |
| API gateway | Azure APIM (Standard v2 ≈ US$700/mo) | Next.js API routes + existing role guards + Cloudflare | External partners need APIs |
| AI | Azure OpenAI | Claude via the Anthropic API (already used) | If Australian-only processing is required: Claude via AWS Bedrock's Australia profile |
| Knowledge search | Azure AI Search (Basic ≈ US$75/mo per unit) | Phase 6: SQLite full-text index of *approved* folders, permission-filtered, with citations | If keyword search proves too weak |
| Identity | Entra ID | App login + Cloudflare Access; option to make Cloudflare Access use Microsoft (Entra) sign-in, low cost | When directors want one Microsoft login everywhere |
| Infrastructure-as-code / CI | Terraform + GitHub Actions | GitHub private repos + CI running `tsc` and tests | When there's more than one server |
| Language | Python + TypeScript | TypeScript only | — |

**Rough running cost.** v1 as written would likely be **well over A$1,000/month** before AI usage (gateway, search,
database, bus, compute and monitoring, times 3 environments), and it needs Azure-skilled people to run it. v2 is
the current server, plus AI usage, plus GitHub (free for private repos). *Prices are indicative and must be checked
before any decision.*

## 6. Phases (each ends with a test on a copy, Ilies's sign-off, then deploy)

| # | Phase | What gets built | Exit check |
|---|---|---|---|
| 0 | Foundations (≈1 week) | GitHub private repos (Operations, Estimating, Director Insights); Estimating under git; `npm test` + pre-deploy gate; app-wide audit log table; **project code mapping** across the apps and OneDrive folders | Every project has one code in every app; tests run before deploys |
| 1 | Daily site log | On the supervisor link (pilot: Damien and Tom). **Revised 25 Oct from evidence:** the Estimating agent's review of 10 won jobs (`demo-civil-estimator/docs/ACTIVITY-CODES-REVIEW.md`) found sites never measure m². What they record is labour and plant hours per task, tip dockets (t or m³ by waste class) and visits; claims are % complete per trade line. So the log is: (a) **daily**, hours split across today's activity codes, prefilled from the board and sign-ins; (b) **daily**, coded delays (weather, access, client, plant breakdown, waiting on others, other) + note + photos; (c) **weekly**, % complete per package; (d) tip dockets tagged with DEM-10 and their waste class. About 60 seconds a day. Shows in Day Review | Pilot supervisors log 2 weeks; completeness measured |
| 2 | Budget baseline | Estimating: add `jobNumber` to each estimate and pick package codes from the shared list (phase 1). Then "Approve as budget" produces a versioned export (packages: qty, unit, production rate, hours, cost by category). Operations: an Admin imports and approves it → `Budget` / `BudgetLine` | The pilot job has an approved budget and revision history |
| 3 | Findings engine | Stored findings + evidence + owner + status + outcome. First rules: missing log, labour-hours variance per package (only when scope and units match), progress variance, resource conflict, incomplete cost evidence (marked provisional), overdue hire (exists), possible unclaimed extra work (flag for review only). Feed in Operations + Director Insights | Findings checked by hand against 4 weeks of pilot data; false alerts recorded |
| 4 | Approvals + controlled actions | General approval engine (built on site requests): requester ≠ approver, fingerprinted change, expiry, re-check at execution, rollback note. A2 reminders on an approved list. Kill switches | Bypass and replay tests pass; no action runs without approval |
| 5 | Lessons + benchmarks | Verified outcomes become lessons; actual production rates are offered to Estimating's rate library; the estimator approves each one | First benchmark update approved with evidence |
| 6 | Knowledge (optional) | Permission-aware search of approved SharePoint folders, with citations, in the assistant | Search never shows a document outside the user's access |
| — | Azure decision point | After phase 3: decide with real numbers (users, load, data size, residency needs) | Directors' decision |

**Order of work across the builders:**
- **Lead (Operations):** phases 0–4.
- **Estimating agent:** git, then the budget export (phase 2), then accepting actuals into benchmarks (phase 5).
- **Director Insights agent:** finishes its current task, then shows findings and approvals read-only (phases 3–4).
- **Merging and deploys:** only the lead merges and deploys Operations.

## 7. Carried over from v1 unchanged

- No autonomous changes to SWMS or safety procedures.
- No employment decisions, spending or contract changes by LCI.
- AI never invents costs, quantities or ground conditions.
- Missing data produces a "provisional" or "needs reconciliation" finding, not a guess.
- Retrieved documents are treated as data, never as instructions.
- Approvals require a positive, signed-in action; silence is never consent.
- Every material conclusion lists its evidence, how fresh it is, its uncertainty and what's missing.
- The money guard stays: supervisors never see rates or costs.
- No unattended model training on Lobos data.

## 8. Risks and how v2 handles them

- **Supervisors won't fill in another form.** Keep the daily log to about 60 seconds, prefill from today's board,
  and pilot it with one supervisor first.
- **Estimate and site activities don't line up.** Use one shared activity list, matched to estimate packages and
  agreed with the estimator in phase 1.
- **Too many false alerts.** Start with rules only, pilot one job, record false alerts, then tune thresholds.
- **SQLite outgrows one server.** Prisma makes the move to Postgres a planned migration, not a rewrite. The
  triggers are listed in section 5.
- **AI data leaves Australia.** Today, Claude API calls may be processed outside Australia. If directors require
  Australian processing, switch to AWS Bedrock's Australia profile (decision 2).

## 9. Decisions needed (Ilies / directors)

1. Approve the **right-sized approach** (inside the current platform, Azure decision after phase 3), or proceed
   with Azure as written in v1.
2. **AI data residency:** is Anthropic's API acceptable for job data, or must processing stay in Australia (AWS
   Bedrock)?
3. **Budget authority:** who approves an estimate as a job's budget? And since Ilies's and Yoel's estimating copies
   are deliberately separate during the trial, **which copy (or both) can send a budget to Operations?**
4. **Pilot job and supervisor** for phases 1–3.
5. **GitHub:** a company-owned account to hold the code. Ilies creates it; Claude never handles its password.
6. **Automatic reminders (A2):** may LCI send internal reminders on its own (e.g. a missing daily log), within an
   approved list?
7. **SharePoint scope for phase 6:** which libraries may be indexed, and which are excluded (HR, payroll, legal).
8. **Estimating housekeeping** (raised by the estimating agent):
   - should rates be flagged stale after 6 months or 12? (6 currently flags LH Hire and Oz Cut);
   - is the Operations Manager's rate preliminaries or overhead?
   - add an Anthropic API key to turn on its Claude review (optional).

### Answers so far (Ilies, 24 Oct 2026)
- 1: wants the benefits and risks explained first (open).
- 2: asked for other options (open).
- 3: **Nick and Yoel** (the directors) approve an estimate as a job's budget.
- 4: pilot with **Damien and Tom**.
- 5: **yes**, GitHub.
- 6: **yes**, automatic internal reminders (approved list, rate limits, kill switch).
- 8: rates are stale **after 6 months** (keep as is). The Operations Manager rate answer ("yes") needs
  confirming: preliminaries or overhead?

## 10. Plugins and connectors

| Need | Status | Why |
|---|---|---|
| **GitHub** (private repos + GitHub connector / `gh` CLI) | **Needed (phase 0)**, free | Off-machine code history and backup, reviewable changes between builders, automated test runs before deploys. **Code only**: databases, `.env` files and supplier-rate files (Estimating `tools/lobos-rates-*.js`, `data/`) never go to GitHub; they stay in the existing backups |
| Microsoft 365 (Outlook / SharePoint / OneDrive / Teams) | Have it (read-only) | Evidence links now; document search in phase 6. Stays read-only |
| Uptime monitor (e.g. a free external health check) | Recommended, low cost | Alerts if Operations or the tunnel goes down; a monitoring step |
| Azure subscription, Terraform, Entra app registrations, Azure OpenAI / AI Search | **Not needed now** | Only if the Azure decision point says yes |
| AWS Bedrock (Claude, Australia profile) | Only if decision 2 = "Australia only" | Same Claude models, processed in Australia |
| Power BI | Not needed | Director Insights covers dashboards |
| Asana, Bland (AI phone calls/SMS) | Not needed | Not part of LCI; Bland in particular should stay unused unless deliberately approved |
