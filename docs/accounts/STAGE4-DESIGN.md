# Accounts stage 4: checking invoices (ABN workers, hire, agreed rates)

Design note, 27 Oct 2026. Built on branch `director-accounts-s4`, from `next15` `edcf627` (stages 2 and 3).

Draft defaults are marked **Draft - for Ilies / Victoria**.

## Shared ground rules

- **The Accounts screen only** (`guardAccounts`: the ACCOUNTS login and Admins).
- **Amounts never reach a worker or a link.** Anything a worker might see (the ABN invoice template) is hours only.
- **Nothing here changes Tracking.** A check never adds, removes or edits an `InvoicedCost`. It only flags. Victoria then decides with the existing tools (the inbox's take-off / add again, or a query).
- **One upload path: the existing invoices inbox** (`/invoices`, `lib/invoiceInbox.ts`). There is no second upload.
- **Decisions are recorded with who and when; nothing is deleted.**
- **No business figures in this note or in git.** Any measured counts go in the report to the lead.

## What the inbox reads, extended (one change to the existing reader)

`lib/invoiceReading.ts` already reads each PDF or photo with Claude. It gets four more optional fields per invoice; every one is empty when not printed:

- `supplierAbn`: the ABN printed on the invoice.
- `workDays`: for an invoice billing a person's hours, each date with its hours.
- `hoursTotal`: the total hours billed.
- `lines`: each invoice line, with description, quantity, unit and unit price ex GST.

These are stored on the draft as new nullable columns: `supplierAbn`, `workDays` (JSON), `hoursTotal`, `lines` (JSON).

- Spreadsheet registers have none of these, and nothing changes for them.
- Nothing else in the inbox rules changes, apart from the ABN step below.
- The same data goes to Claude as today: the file plus job names, numbers, clients and addresses. No rates.

## 1. ABN worker invoices vs approved hours

### Why

An ABN worker's invoice coming into the inbox today would be read as "labour hire" or "other". As "labour hire" it would be **added to the job's cost**. But own crew are already costed from their hours (allocation × pay rate), so that would count them twice.

### How an invoice becomes an ABN check

- **In the inbox rules** (`decide()`), before the job-matching steps. Only **strong evidence** takes an invoice off job cost on its own. A cost silently disappearing is the worst failure here (lead review, 27 Oct). The rule is `abnMatch()` in `lib/abnInvoices/rules.ts`:
  - **Strong evidence, not counted automatically** (SKIPPED, with the reason "ABN worker's invoice - checked against approved hours on Accounts → Invoice checks. Own crew are costed from hours, never from the invoice", and an `AbnInvoice` check opened):
    - **(a) ABN:** the ABN printed on the invoice equals exactly one active person's **recorded ABN** (stage 5 onboarding, `WorkerOnboarding.abn`, digits only). This wins over any name match.
    - **(b) Full name:** an ABN worker (Engagement ABN) whose register name has **two or more words**, every one appearing as a whole word in the supplier (e.g. "Joe Bloggs" in "Joe Bloggs Pty Ltd").
  - **A person decides** (NEEDS_REVIEW):
    - a **single-word name** with no ABN match ("Max" in "Max Hire"): "Could be Max's own invoice (ABN worker) - attach on Accounts -> Invoice checks, or add as a job cost";
    - an ABN recorded for **two people**;
    - **two full-name matches**.
  - Otherwise the ordinary inbox rules carry on unchanged.
- **By hand.** On Accounts → ABN invoices, Victoria can attach any inbox invoice that isn't on a job to a person; this opens the check and marks the draft not counted. She can also detach it, which sends the draft back to "needs you".
- Most register names are a single first name, so in practice the **recorded ABN** (stage 5 onboarding) is what makes automatic matching work. Until it's recorded, a first-name match only asks a person, and Victoria attaches by hand.

### The check (pure rules: `lib/abnInvoices/rules.ts`)

**Hours** come from stage 2's payroll week for that person and the weeks covering the invoice period (`payrollWeek`, reused). For each day:
- **signed**: all their sign-ins;
- **approved**: the lines the supervisor approved (`HoursApproval`), plus office, yard and truck sign-ins once the Manager has locked that week. Points have no supervisor step;
- Victoria's week decision (`PayWeekReview`) is shown beside each week.

**Comparison:**
- **With days on the invoice:** per day, invoiced vs approved.
  - Over by more than **0.25 h** = OVER;
  - under by more than 0.25 h = UNDER;
  - invoiced with no approved hours = NOT_APPROVED;
  - approved but not invoiced = information only.
- **With no days:** the invoice's total hours vs approved hours for the period.
- **With no hours at all:** "hours not shown on the invoice". Victoria compares by hand with the approved hours shown.
- *Draft:* the 0.25 h tolerance is one constant.

**GST flag**, from the person's `gstRegistered` (new, nullable, set on the ABN screen by accounts):
- charged GST but not registered;
- registered but no GST charged;
- GST charged but registration not recorded yet.

**ABN number:** the printed ABN is checked with the official ABN checksum ("doesn't look like a valid ABN").

**Victoria approves or queries** (with a note). The decision history is kept on the check. A query is information for the office. It never changes hours or costs.

### The standard Lobos ABN invoice

`/accounts/abn/template?person&from&to` is a printable page (print to PDF from the browser) with a matching CSV.
- **Hours only:** Lobos's details, the person's name, each day with site and supervisor-approved hours, and the total.
- **Left blank for the worker:** their ABN, invoice number, rate, GST and total.
- Victoria sends it to the worker, who copies it into their own invoice. Emails from accounts@ are still blocked.

## 2. Supplier hire invoices vs the hire register

Pure rules in `lib/hireChecks/rules.ts`; existing helpers reused (`hireEstimate.ts` `weekdaysBetween`, `hireDayRate`).

**What's checked:** every `InvoicedCost` linked to a hire-register item (`hireResourceId` + period). The inbox already links these. For each item, its invoices are checked against its on-hire window (on-hire date → off-hire date, or today while it's still on hire):

- **OUTSIDE_PERIOD**: weekdays billed before the on-hire date or after the off-hire date.
- **MORE_DAYS**: the invoice amount ÷ the item's day rate (the register's own rate) comes to more days than the register shows inside the invoice period. The wording also asks whether other charges (damage waiver, fuel, cleaning) explain it.
  - Delivery and pick-up charges on the item are allowed for before flagging.
  - *Draft:* half a day of tolerance. With no rate on the item, this check is skipped and says so.
- **BILLED_TWICE**: two invoices for the same item whose periods share a weekday.
- **NO_PERIOD**: a linked invoice with no period (it can't stop the estimate).

**Victoria marks each flag OK or Query, with a note** (`InvoiceFlagReview`, append-only). A flag marked OK stays visible as "checked by …".

## 3. Agreed rates: over-rate flags (rates stay in Estimating)

Supplier rates live in Lobos Estimating's rate library. Operations **reads** them server-side and never keeps a copy.

### Read contract: `rate-sheet.v1` (spec for the Estimating agent)

`GET /api/rate-sheet` on Estimating (127.0.0.1:4310).

- **Key:** the request must carry `x-lobos-actuals` = `ACTUALS_SECRET`, the server-only key already shared by the two `.env` files.
  - Without it: 403, `code: "server-only"`.
  - The `/estimating` browser proxy never forwards it (`lib/estimatingProxy.ts` allowlist).
- **Optional query:** `?category=Plant,Plant attachments,Trucks,Access / EWP,Skip bins,Disposal`. Default: all.
- **Reply:**

  ```json
  {
    "schema_version": "rate-sheet.v1",
    "version": "<rates.json mtime>",
    "rates": [
      {
        "id": "lh-01",
        "supplier": "LH Hire",
        "item": "0.8T Excavator",
        "category": "Plant",
        "unit": "day",
        "rateExGst": 0,
        "validFrom": "2026-01-01",
        "validTo": null,
        "source": "Price List 2026",
        "confidence": "high"
      }
    ]
  }
  ```

  (`rateExGst` here is a placeholder, not a real rate.)

  - `supplier` is the part of the library's `source` before " — ", and `item` is `item` without that prefix.
  - `unit` is one of `day`, `wk`, `hr`, `each`, `t`, `load`, `trip`, `m`, `m³`, `bag`, `item`.
  - `validFrom` / `validTo` come from `date` / `valid` (null when blank).
  - Example rows ("EXAMPLE") are left out.
- **Read-only.** No write route is added. Estimating's own screens stay the only place rates change.

### Operations side (built now against a fixture)

- **`lib/rateSheet/client.ts`** calls `estimatingCall("/api/rate-sheet", { headers: { "x-lobos-actuals": … } })`.
  - Until Estimating has the route (404), it says "Rate sheet not available from Estimating yet".
  - For testing only, `RATE_SHEET_FIXTURE` (a path to a JSON file in the same shape) is used instead. It's never set on the server.
- **What's compared:** invoice lines (`lines` read from the PDF) on plant-hire / tip / materials drafts.
  - A line is matched to a rate by plain code: same supplier (normalised), same unit (day / wk / hr / t … normalised), and the best overlap of item words.
  - A match below the bar is "pick the rate". When accounts pick or confirm a rate for "this supplier writes this item like this", it's remembered (`RateLink`, like `SiteAlias` for jobs).
- **Flag:** the line's unit price is above the agreed rate (in force on the invoice date) by more than **2%**.
  - *Draft:* one constant. Shown as invoiced vs agreed, with the difference × quantity.
- **Where it's shown:** Accounts → Invoice checks → "Agreed rates" tab, Accounts and Admin only. Never on a link, never for a Manager, never on Tracking.
- *Draft:* hire items also have their own register rate (`hireRate`). The hire checks above use that, because it's the rate the item was booked at. The rate sheet is the "agreed price list" check. Both can flag.

## Schema (all additive)

**`InvoiceDraft`**, new nullable columns: `supplierAbn String?`, `workDays String?`, `hoursTotal Float?`, `lines String?`.

**`Resource.gstRegistered Boolean?`**: null = not recorded. Set by accounts on the ABN screen. Admin-only on the Operations resource screens, alongside the other pay fields.

**`AbnInvoice`** fields:
- `id`, `draftId @unique`;
- `resourceId`, `personName`;
- `periodFrom?`, `periodTo?`;
- `status`: TO_CHECK, APPROVED or QUERY;
- `note?`, `decidedBy?`, `decidedAt?`;
- `history` (JSON list of decisions);
- `attachedBy`, `createdAt`.

**`InvoiceFlagReview`** (append-only): `id`, `subjectKind` (HIRE or RATE), `subjectId`, `flag`, `status` (OK or QUERY), `note?`, `by`, `byId`, `at`.

**`RateLink`**: `id`, `supplierKey`, `lineKey`, `rateId`, `label`, `createdBy`, `createdAt`, with `@@unique([supplierKey, lineKey])`.

## Screens

- **Accounts → Invoice checks** (`/accounts/invoice-checks`), with three tabs:
  - **ABN invoices**: open checks first, each with the day-by-day table, flags (hours, GST, ABN) and approve / query. Also: "attach an inbox invoice to a person", the GST-registered setting per person, and a link to the template.
  - **Hire**: flagged invoices per hire item, with OK / Query.
  - **Agreed rates**: over-rate lines, lines to match, and the rate sheet's status.
- **Accounts To do** gets one line: invoice checks waiting.

## Tests

- **Unit:**
  - `abnInvoices/rules.test.ts`:
    - whose invoice: a single first name waits for a person; the recorded ABN, or a full two-word name, is strong enough; the ABN wins; two people with the same ABN or full name wait;
    - the day-by-day comparison and tolerance;
    - the total-only comparison;
    - the GST flags;
    - the ABN checksum.
  - `hireChecks/rules.test.ts`: outside the period, more days (with delivery allowance and no rate), billed twice (overlapping weekdays only), no period.
  - `rateSheet/rules.test.ts`: unit and supplier normalising, line → rate matching, the remembered link winning, the rate in force by date, the 2% flag.
- **Copy** (fresh off-site backup, never live):
  - an ABN invoice draft goes to a check and isn't on Tracking;
  - approve / query; attach / detach;
  - hire flags on real linked invoices;
  - over-rate with a fixture;
  - permissions (ACCOUNTS / ADMIN only; Managers 403);
  - the template is hours only;
  - Tracking byte-for-byte unchanged;
  - viewer safety; browser.
