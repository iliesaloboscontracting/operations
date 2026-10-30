# Plan: "Claimed" figures on the Directors screen (30 Oct 2026; stages 1-3 approved)

There are no business figures in this document, so it can move into `director-insights-plan/` once it's approved.

## Current State
- The Directors overview and job page show cost against contract value, with costs taken from `loadTracking()`.
- Xero sales are mirrored every night into XeroImport / XeroInvoice / XeroLine.
- Job matching is worked out once, when each import is written, and stored on each line (`XeroLine.projectId`). It is decided in this order:
  1. a person's decision (`XeroJobMatch`);
  2. the Xero tracking category;
  3. a job number in the invoice text.
- `revenueSummary()` already adds these lines up, with each line's sign taken from its type (sale or credit note). Voided, deleted and draft invoices are left out.
- The live sync reads from 1 July of the previous financial year, so that window moves forward every year.
- One problem: the shared JobView has a tile labelled "Forecast · margin". That breaks the "nothing called margin" rule.

## Problem
Directors can't see what each job has been claimed, how much is left to claim, or what was claimed against what was spent. Nick's tracker can't be read automatically: it's 260 MB and its formulas are broken.

## Proposed Change
1. Show **Claimed (Xero)** per job, plus a company **Claimed by month** chart covering the last 15 months.
2. Show **Claimed less cost to date** and **Left to claim** per job. Neither is ever called margin or profit.
3. Add a **data-confidence line**: sales not tied to a job, draft invoices (which aren't counted), where the Xero data starts and its source, and when it was last read.
4. *(Optional, separate yes)* **Pin the mirror start date**, so history stops dropping off every 1 July.
5. **Don't build an upload for Nick's tracker.** Explain the gap through queries instead.

## Reason
It reuses the stored matches and the nightly read. There is no new connection, no new Xero scope, no new table, and no matching logic copied.

## Impact
- **Code that changes:**
  - `src/lib/xero/summary.ts`: a shared line helper.
  - New: `src/lib/insights/claims.ts` and its tests.
  - `dictionary.ts`, `load.ts`, `xero/imports.ts`.
  - `src/app/directors/page.tsx`, `/directors/kpis`, `api/directors/jobs/[id]`.
  - `JobView.tsx`, in director mode only.
- **No new routes.** The two responses behind guardDirector get a `claims` field.
- **New release check:** `22-directors-claimed`.

## Risks
- The invoice date isn't the claim month.
- Sales not tied to a job make the per-job figures too low.
- Older jobs have claims from before the mirror start, so those claims are missing. A LOW-confidence mark covers this.
- Variations aren't in Operations, so "Left to claim" can go below zero. When it does, the screen says so in words rather than showing a negative amount.
- JobView is shared with Operations pages. The release check enforces that `claims` appears only in director mode.
- Nick's figures don't match Xero, and nobody knows why yet.

## KPI drafts (dictionary.ts)

| ID | Name | Definition |
|---|---|---|
| F14 | Claimed (Xero) | Sales lines less credit-note lines, ex GST, matched to the job. Covers the mirror start to today. Leaves out voided, deleted and draft invoices. Status CONFIRM. |
| F15 | Claimed by month | Company total per invoice month, split into: tied to a job / not tied yet / not a job. Last 15 months. |
| F16 | Claimed less cost to date | F14 less Tracking's total cost to date. No colour and no threshold. Marked LOW confidence when the history is incomplete. |
| F17 | Left to claim | Contract value less F14. Above the contract value, the screen says so in words. |

Also add data-quality rows for untied invoices, draft invoices and the mirror-start line. Leave F13 "Margin per job" blocked.

## Stages
Each stage ships separately.
1. The maths and unit tests.
2. The overview, its release check, and a browser check on a copy.
3. The job page, plus renaming the director-mode "Forecast · margin" tile to "Forecast · headroom".
4. Pin the mirror start (needs a yes).
5. A process change: claims raised in Xero only.

## Open questions
1. Should the month be the invoice date or the claim period?
2. Confirm all figures are ex GST.
3. Retention: how should it be treated?
4. Variations: is "Left to claim" against the original contract acceptable until there's a register of variations?
5. "Not a job" invoices (deposits, recharges): show them as their own band, or leave them out?
6. Show active jobs only, or include recently completed ones?
7. Pin the mirror start at 1 Jul 2025, or read back to Apr 2023?
8. Should draft invoices ever count?
9. When does Nick move to raising claims in Xero only?

## Recommendation
Build stages 1-3, and approve stage 4. Don't build the upload for Nick's tracker. Instead, send in-app queries to Victoria and Nick asking them to explain the gap.


## Approved (30 Oct 2026)

Ilies said "build stages 1-3". Later the same day he approved stage 4 too ("do all of this"): the live read now starts at a fixed `XERO_CONFIG.mirrorFrom = "2025-07-01"` instead of the rolling 1 July. It uses the same endpoint and the same read-only scopes, just more pages (MAX_PAGES 100). Reaching that limit stops the read with an error rather than quietly leaving invoices out.

Until Ilies answers the open questions, these defaults apply. Each is labelled on the screen or in the dictionary note:

1. **Month** = the invoice date.
2. **GST:** all figures are ex GST.
3. **Retention:** what's invoiced counts, noted as "retention as invoiced".
4. **Left to claim** is against the Operations contract value only. Above it, the screen says in words "Claimed more than the contract value (variations aren't in Operations)".
5. **"Not a job" invoices** get their own band in the monthly chart and never count in any job.
6. **Job table:** active jobs, plus jobs with a board day in the last 60 days.
7. **Mirror start:** fixed at 1 July 2025 (stage 4). The screen shows the "Xero sales from <date>" line.
8. **Draft invoices** never count. They show as a data-quality count.

**Thresholds (drafts):** claimsMonths 15, claimCostGapDays 31. claimsTiedHighAt reuses F9's 0.9 (`THRESHOLDS.revenueTiedHighAt`). F13 "Margin per job" stays blocked.
