# Accounts stage 3: reimbursements and full labour cost (on-costs)

Design note, 27 Oct 2026. Built on branch `director-accounts-s3`, which starts from stage 2 (`director-accounts-s2`) because it uses stage 2's `Resource.engagement` field.

Draft defaults are marked **Draft - for Ilies / Victoria**.

Both features sit on the Accounts screen only (`guardAccounts`: the ACCOUNTS login and Admins). Neither changes a number anywhere else in Operations. Tracking, Day Review, the board and every link stay exactly as they are.

## 1. Reimbursements

### What exists already (reused)

- **Receipts** (`Receipt`, R1-R4): tip dockets and fuel receipts sent from a supervisor's or driver's link. Each has a photo (`ReceiptPhoto`, file in `RECEIPT_FILE_DIR`), who sent it, and, once read, the docket number, date and total.
- **Photo storage and checks** (`lib/receipts/files.ts` `saveReceiptPhoto`) are reused for a receipt that accounts enters by hand.

### The flow

1. **A claim is created on Accounts → Reimbursements**, in one of two ways:
   - **From a receipt.** Accounts picks a receipt from the last 60 days that isn't claimed yet. The person, amount, date, docket number and photo come from the receipt.
   - **Entered by accounts.** Accounts picks the person (Personnel register) and enters what it was, the supplier, the receipt or docket number, the amount (inc GST), the date and an optional photo.
2. **The claim reads "Reimburse to <person>"** and shows as *To pay*.
3. **Victoria ticks it paid.** She enters the date paid (today by default) and an optional reference. Her name and the time are recorded.
4. **A claim made by mistake is cancelled with a reason, never deleted.** A cancelled claim no longer counts for duplicates.

### No double claims (pure rule, unit-tested: `lib/reimbursements/rules.ts`)

A new claim is **refused**, and the suspected duplicate is shown, when an existing claim that isn't cancelled has:
- the **same receipt** (one claim per receipt), or
- the **same photo**: the same file content, compared by its SHA-256 fingerprint, or
- the **same receipt or docket number + amount + date**. The number is compared ignoring spaces, case and leading zeros; the amount must match to the cent.

A softer match gives a **warning** but is allowed: **same person + same amount + same date** with no number on one or both. It shows as "Possible duplicate - check" on both claims.

*Draft - for Ilies / Victoria:* exact matches block with no override. If one is a genuine second purchase, enter the receipt number to tell them apart. If Victoria wants an "allow anyway, with a reason" button, it's a small change.

### Rules

- **Accounts screen only.** Nothing about reimbursements appears on any link. The receipt still shows "sent" on the worker's link, as today, with no amounts.
- **A reimbursement is a payment to a worker, not a job cost.** It never adds to Tracking. Tip costs already come from the docket (R3), and **fuel stays out of job cost** (Ilies: the truck day rate includes it).
- **Append-only history.** Paid and cancelled are status changes with who and when; nothing is deleted.
- **"To do" on Accounts** gets one line: reimbursements waiting to be paid.

*Draft / question for Ilies:* workers can't say "I paid this myself" when they send a receipt, so accounts marks it. A Yes / No tap on the receipt screen ("Did you pay with your own money?") would tell Victoria straight away. That would be a change to the link, so it isn't built until Ilies says so.

### Schema (additive)

**`Reimbursement`** fields:
- `id`;
- `resourceId?`, `personName`;
- `receiptId?`;
- `source`: RECEIPT or ACCOUNTS;
- `description`, `supplier?`, `refNo?`;
- `amountIncGst`, `spentOn` (YYYY-MM-DD);
- `photoFile?`, `photoHash?`;
- `status`: TO_PAY, PAID or CANCELLED;
- `paidOn?`, `paidRef?`, `paidBy?`, `paidAt?`;
- `cancelReason?`, `cancelledBy?`, `cancelledAt?`;
- `createdBy`, `createdById`, `createdAt`.

Indexes on `receiptId`, `photoHash`, `refNo` and `status`.

## 2. Full labour cost per person and job (on-costs)

### Victoria's method (read-only, from her workbook)

**Source:** SharePoint, Management site, folder "Leza & Victoria - Cost tracking and general info", file `Lobos_Labour_Cost_by_Site.xlsx` (FY 2026-27 to week ending 11 Oct; read 27 Oct 2026). The method is on its "Parameters" sheet and in the notes on its "Summary" sheet. `Lobos_Pay_Rates.xlsx` in the same folder is the source of the pay rates Operations already holds.

No rates, salaries or pay figures from those files are copied into the code or this note. Only the method is described here:

- **Paid to workers** is hours × the person's rate, with Saturday and Sunday loadings and the travel rate where it applies. Salaried staff count as annual ÷ 52 ÷ 5 per weekday. ABN workers count at their checked or invoiced amount.
- **Super** is a % **of paid**, for **TFN employees and salaried staff only**. **ABN workers get no super.**
- **Workers comp** is a % **of (paid + super)**, for **all workers**, ABN included.
- **Payroll tax** is a % **of (paid + super)**, for **all workers**, ABN included. It is applied flat to everything, with no threshold step in the workbook.
- **Company cost** = paid + super + workers comp + payroll tax.
- **Kept outside the method:** leave, public holidays and hours with no site go to "Overhead". Labour agencies are left out, because their invoices already include their own on-costs.

### What Operations does (Accounts screen only)

- **Base labour cost** comes from Tracking's own figures, reused rather than recomputed: `loadTracking({ withPeople: true })` → each project's `labour[]` lines.
  - These are the same numbers Tracking shows: frozen ledger amounts for closed days, live `costAllocation` for open days, plus the historical labour backfill.
  - Each line is matched to its person (the assignment's or backfill row's `resourceId`) to read `engagement`.
- **On-cost lines are applied on top**, per Victoria's method. The bases and who each line applies to are settings, so a different method needs no code change:

  | Line | % of | Applies to |
  |---|---|---|
  | Super | paid | employees (`engagement` EMPLOYEE, or not set) |
  | Workers comp | paid + super | everyone |
  | Payroll tax | paid + super | everyone |
  | Any other line | paid, or paid + super | employees or everyone |

- **The percentages are blank**, flagged **"to be entered"**, until an Admin enters them. Nothing is hard-coded or guessed.
  - Each line shows "not set", and company cost shows "incomplete", until all its lines have a rate.
  - A rate has an **effective-from date**. A change is a new row; a wrong row is retired with a reason, never edited or deleted.
- **Payroll tax threshold rule** (a setting):
  - **FLAT** (Victoria's workbook): the % on all of the base.
  - **ABOVE THRESHOLD**: an annual threshold, used up in date order across the financial year (1 July). Tax applies only to the part of the year's running base above it.
  - Operations doesn't see every wage (salaries are excluded on Tracking, and ABN amounts come from invoices), so ABOVE THRESHOLD is an approximation. *Draft:* FLAT is the default, matching Victoria.
- **Views** (`/accounts/labour-cost`):
  - **by job**: base, each on-cost line and company cost per project for a date range (default: this financial year);
  - **by week**: the same per week (Monday-Sunday);
  - **drill-down**: per person within a job (name, engagement, base, lines);
  - flags for people with no engagement set (counted as employees), uncosted lines (no rate or hours, as on Tracking), and lines with no rate entered.
- **Who:** ACCOUNTS and Admins see it, the same as pay figures on Payroll. **Only Admins enter or retire on-cost rates.** Managers, Viewers and links never see it.

### Not included (stays as it is)

- **Labour hire (`HIRE_LABOUR`)**: the agency invoice includes its on-costs.
- **Salaried staff**: Tracking marks them EXCLUDED, so they have no base here either.
  - Victoria's workbook puts salaried staff without a site in Overhead.
  - *Question for Victoria:* add salaries as a setting later?
- **Tracking's numbers don't change.**

### Question for Ilies: should on-costs flow into Tracking's job cost?

Today, Tracking's own-crew labour is hours × pay rate, with no super, workers comp or payroll tax. If the on-costs were added, own-crew labour on every job would rise by the same proportion. Each job's total would move less, because plant, hire, trucks, invoices and tips stay the same.

**Measured on a copy of live data (26 Oct), using the method above:**
- the size of the move was measured on a copy and given to Ilies directly (not written here: it reveals the on-cost rates);
- the top of the range is the jobs whose cost is almost all own crew;
- everyone was counted as an employee, because nobody's engagement is set yet. Once ABN workers are marked, their jobs move a little less;
- the more of a job's cost is own crew, the bigger the move;
- the "Watch" (80%) and "Act" (100%) statuses would trip earlier on labour-heavy jobs.

No figure or rate is written here. The measurement was worked out with the workbook's rates in a scratch calculation that isn't saved anywhere.

**Options:**
- (a) keep Tracking as hours × rate and show company cost on Accounts only (as built);
- (b) add on-costs to Tracking as their own category, so the before and after are visible;
- (c) show both on the Directors screen.

*Recommendation:* (a) now, and (b) once Victoria has confirmed the rates are entered and correct.

### Schema (additive)

**`OnCostRate`** fields:
- `id`;
- `line`: SUPER, WORKERS_COMP, PAYROLL_TAX or `OTHER:<name>`;
- `label`;
- `percent`;
- `base`: PAID or PAID_PLUS_SUPER;
- `appliesTo`: EMPLOYEE or ALL;
- `thresholdRule?`: FLAT or ABOVE_THRESHOLD (payroll tax);
- `thresholdAnnual?`;
- `effectiveFrom`;
- `note?`;
- `setBy`, `setById`, `setAt`;
- `retiredAt?`, `retiredBy?`, `retiredReason?`.

Append-only. The rate in force on a date is the latest non-retired row for that line with `effectiveFrom` on or before that date.

## Tests

- **Unit:**
  - `lib/reimbursements/rules.test.ts`: the duplicate rule (same receipt, photo, number + amount + date, number normalising, the soft warning, cancelled claims ignored).
  - `lib/oncosts/rules.test.ts`:
    - the rate in force by date (retired rows ignored);
    - super for employees only, with an unset engagement counted as an employee;
    - workers comp and payroll tax on paid + super;
    - "not set" lines and incomplete company cost;
    - FLAT vs ABOVE THRESHOLD across a financial year boundary;
    - rounding to the cent;
    - grouping by job and week.
- **Copy** (fresh off-site backup; never live):
  - claims from a receipt and by hand; a duplicate refused with the match shown; paid and cancelled;
  - permissions: ACCOUNTS and ADMIN allowed; MANAGER and VIEWER 403; Accounts can't change rates; links see nothing new;
  - on-costs shown as "not set", then entered by an Admin with effective dates;
  - the base equals Tracking's own-crew labour to the cent;
  - Tracking's numbers are unchanged before and after;
  - viewer safety (`scripts/check-viewer-safety.ts`);
  - both pages in the browser.
