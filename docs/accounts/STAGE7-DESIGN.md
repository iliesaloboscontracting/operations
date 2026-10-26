# Accounts stage 7 (unblocked part): tax estimates

Design note, 27 Oct 2026. Built on branch `director-accounts-s7`, from `next15` `ea3306c`.

Bank and card tracking waits on decision 5 (Xero bank feeds) and isn't in this stage. Draft defaults are marked **Draft - for Ilies / Victoria**; the questions are at the end.

**Every figure here is an estimate.** The page says so in every section: "Estimate - Xero and the accountant are the record." Operations never lodges, pays or writes anything to Xero or the ATO. Xero stays read-only, and **no new Xero scope or outbound host is added.**

## Where the numbers come from (nothing re-entered)

- **The Xero mirror**, already read nightly, or uploaded by accounts:
  - **sales invoices and credit notes**: `XeroInvoice` SALE / SALE_CREDIT, latest INVOICES import;
  - **bills and supplier credits**: BILL / BILL_CREDIT, latest BILLS import;
  - **the monthly Profit & Loss**: `XeroPnlLine`, latest PNL import.
  - Always the **current import of each kind** (`currentImport()`), so nothing is counted twice across syncs.
  - Voided, deleted and draft invoices don't count (the same `XERO_CONFIG.ignoredStatuses` the Directors revenue tile uses).
- **The payroll tax rate**: stage 3's `OnCostRate` line `PAYROLL_TAX` (percent, base, FLAT / ABOVE_THRESHOLD, annual threshold), entered by an Admin with an effective date.
  - **One source of the rate**, not a second copy.
  - Until it's entered, the payroll tax section says **"Not set"**.
- **Victoria's calendar**: the existing `AccountsItem` due dates. Estimates are linked to items there; there's no second calendar.

## 1. Payroll tax estimate (per month, and the financial year to date)

**Wages come from the Xero P&L, not from stage 3's labour cost.**

| | Xero P&L (used) | Stage 3 labour cost (comparison only) |
|---|---|---|
| Covers | Everyone on the payroll: site crew, salaried staff, office, directors' wages; leave and allowances; super | Own crew only, as allocated on the board (hours × pay rate); salaried staff excluded, no leave |
| Is it what the payroll tax return is based on? | Yes: total taxable wages | No: it's a job-costing figure |

So the estimate uses the P&L. Stage 3's own-crew figure for the same months is shown underneath as "for comparison", so a big gap stands out.

**Which P&L accounts count:**
- Each expense account is classed as **wages**, **super** or **not wages**, by name to start with:
  - wages / salaries / allowances / overtime / bonus / leave / termination = wages;
  - superannuation = super;
  - payroll tax, workers comp and insurance are never wages.
- Victoria confirms or changes the classes on the page. Her choice is saved (`TaxSetting`, append-only) and wins over the name rule.

**The maths** (pure functions in `lib/taxEstimates/rules.ts`, unit-tested):
- **Base per month** = wages, plus super when the rate's `base` is PAID_PLUS_SUPER (the same setting stage 3 uses).
- **FLAT:** the % of the base.
- **ABOVE_THRESHOLD** (how a monthly return works): the % of (base − the annual threshold × days in the month ÷ days in the financial year), never below zero.
  - *Note:* stage 3 uses the threshold cumulatively over the year for job costing. Here the monthly share is used because that's how monthly returns are worked out. It's the same rate row, read two ways for two purposes.
- **Financial year to date** = the sum of the months from 1 July.
- **Annual reconciliation check** (shown when the rule is ABOVE_THRESHOLD) = the % of (year-to-date base − the threshold × days elapsed ÷ days in the year).
- The rate in force on each month's first day is used. A rate entered later doesn't change earlier months.

**Due dates** (*Draft - for Victoria*, NSW monthly lodger): the monthly return is due on the **7th of the following month**. June has no monthly return; the **annual reconciliation is due 28 July**.

## 2. BAS / IAS estimate (per quarter, from the Xero mirror)

- **GST collected** = GST on sales invoices less GST on sales credit notes, dated in the period.
- **GST paid** = GST on bills less GST on supplier credits, dated in the period.
- **Net GST** = collected − paid. A negative figure is a refund ("ATO owes Lobos").
- Invoices with no GST figure in the mirror are counted and shown ("N invoices have no GST amount in Xero's data"), never guessed.
- **Basis:** *Draft - for Victoria:* **accrual (invoice dates).** Cash basis would need payment dates. The connection already has `accounting.payments.read`, but payments aren't stored in the mirror yet. Adding them is a code change to the nightly read, not a new scope.
- **Frequency:** *Draft:* **quarterly** (Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun). Monthly is a setting.
- **PAYG withholding (W1 / W2):** the P&L doesn't show the tax withheld; it's a balance-sheet / payroll figure. Showing it would need Xero payroll access (`payroll.payruns.read`), which Lobos's connection **doesn't have**. So it shows **"Not available from the data Operations reads"**, and the question is listed below.
  - Victoria can still put her own PAYG figure on the calendar item's existing "amount".
  - PAYG instalments (income tax, from the ATO's notice) are the same.
- **Due dates** (*Draft - for Victoria*, Lobos lodging itself):
  - quarterly BAS: Q1 28 Oct, Q2 28 Feb, Q3 28 Apr, Q4 28 Jul;
  - monthly BAS / IAS: the 21st of the following month.
  - If the accountant lodges, their (later) agent dates apply. This is a setting, and the dates are shown with "check with the accountant".

## 3. The calendar (existing `AccountsItem`, no second copy)

For each period's estimate, the page looks for Victoria's matching item: same category (BAS / PAYROLL_TAX / IAS), open, due within the period's due window. Then:
- **No item:** "Add to calendar" creates one, with the due date, the title (e.g. "BAS Q2 2026-27 (estimate)") and `amount` = the estimate. It's linked by `sourceType` TAX_ESTIMATE + `sourceId` (e.g. `BAS:2026-Q2`), so it's never added twice.
- **An item exists:** it's shown ("On the calendar, due 28 Feb, expected $…").
  - "Use the estimate as the expected amount" fills its amount, but only when Victoria clicks it. Her own figure is never overwritten.
- Reminders and phone alerts come from the existing calendar as they do today.

## 4. Who sees it

- **Accounts → Tax estimates** (`/accounts/tax`, `guardAccounts`): the ACCOUNTS login and Admins.
  - Settings (account classes, GST basis / frequency / lodgement) can be changed by ACCOUNTS and Admins.
  - The payroll tax rate stays an Admin entry on Labour cost (stage 3).
- **Directors overview:** the company health band is six tiles, and a seventh would break it.
  - Instead, the existing **"Cash & receivables"** tile gets one extra line when an estimate is available: "Next BAS (estimate): … due …; payroll tax this month (estimate): …".
  - It's read-only, behind the overview's existing director access, and labelled as an estimate.
- Never on a link, never for a Manager, never on Tracking.

## Schema (additive)

**`TaxSetting`** (append-only; the latest row per key counts):
- `id`, `key`, `value` (JSON), `by`, `byId`, `at`.
- Keys:
  - `PAYROLL_ACCOUNTS`: `{ "<account name>": "WAGES" | "SUPER" | "NONE" }`;
  - `GST_BASIS`: ACCRUAL;
  - `BAS_FREQUENCY`: QUARTERLY or MONTHLY;
  - `LODGEMENT`: SELF or AGENT.

`AccountsItem` is reused as it is. `sourceType` gets a new value, TAX_ESTIMATE.

## Questions

**For Ilies:**
1. **PAYG withholding** needs Xero payroll access (`payroll.payruns.read`, read-only) to be estimated from data. Do you want that scope added to the Xero connection later? It's a change to what Lobos grants Operations, so it needs your approval and a reconnect. Until then it stays "not available".
2. **Directors:** is one estimate line on the Cash tile enough, or do they want their own tax screen?

**For Victoria:**
1. GST: **accrual or cash** basis? Quarterly or monthly?
2. Does Lobos lodge the BAS itself, or does the accountant (agent due dates)?
3. Which P&L accounts are wages and super for payroll tax? The page suggests them by name; please confirm.
4. Are any **contractor payments** treated as wages for payroll tax (NSW relevant-contract rules)? They aren't in the P&L wage accounts, so they'd be missing from the estimate.
5. Is Lobos part of a **payroll tax group** (shared threshold)? That would change the threshold used.
6. Monthly payroll tax returns: confirm the 7th of the month, and 28 July for the annual reconciliation.

## Tests

- **Unit** (made-up numbers):
  - financial years and quarters;
  - GST per period (sales, credits, bills, voided ignored, no-GST counted);
  - account classing and Victoria's override;
  - payroll tax FLAT vs ABOVE_THRESHOLD monthly share and the reconciliation check;
  - the rate in force by month;
  - "not set" with no rate;
  - due-date rules (quarterly self / agent, monthly, payroll tax incl. June → 28 July);
  - matching a calendar item.
- **Copy:**
  - Xero mirror rows seeded with made-up figures on the copy;
  - permissions (ACCOUNTS / ADMIN only; Manager 403; the Directors line behind director access);
  - "Not set" before the rate;
  - add to calendar once (no duplicate), and fill the amount only on request;
  - Tracking unchanged; viewer safety; browser.
