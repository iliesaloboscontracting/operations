# Accounts stage 2: payroll (the unblocked parts)

Design note, 26 Oct 2026 (night). Built on branch `director-accounts-s2`.

Ilies approved the Accounts plan (`ACCOUNTS-PLAN.md`), so this goes ahead without waiting. **Draft defaults are marked "Draft - for Ilies / Victoria"**; each is one setting or a small code change if they want it different.

## What exists already, and what is reused (nothing is entered twice)

- **Sign-ins** (`SiteAttendance`, `lib/signin.ts`) are the only source of hours. Hours are the signed-in time, less the site's unpaid break (`signedHours`).
- **Weekly staff timesheets** (`/timesheets`, `TimesheetWeek`, `lib/timesheets.ts`): a Manager approves and locks a finished week, and an Admin can reopen it. This stays exactly as it is, and stage 2 sits beside it. There is no second timesheet.
- **Labour hire matching** (`lib/labourHireMatch.ts`) puts each hire sign-in on the labour-hire tile it fills on the board.
- **Pay rate tiers** (`lib/labourCost.ts` `tierFor`): Ordinary, Night, Saturday and Sunday. The export uses the same tiers.
- **Accounts screen** (`/accounts`, `guardAccounts`): for the ACCOUNTS login and Admins only. Managers can't open it, and the accounts login can't open Operations.

## The flow, end to end

1. **Supervisor (daily, on their site link).** After crew sign out, they get "Approve today's hours". It lists each job's crew with name, in, out and hours, and they approve the day. They can flag a person with a note, for example "left at 1pm, not 3:30". It shows hours and names only, never money.
   - The sign-in flow itself doesn't change. This is a separate "Approve hours" button on the supervisor's home screen.
2. **Manager (weekly, existing).** The Manager approves and locks the staff week on `/timesheets`, as today. The lock stops anyone changing a sign-in time in that week.
3. **Victoria (weekly, the Accounts screen).** For each person she sees the week day by day:
   - hours;
   - whether the supervisor approved each day, and any flag;
   - the sign-in location (see 4);
   - the Manager's lock.

   She then **approves** or **queries** that person's week, with a note.
4. **Export.** The pay-run CSV includes only people Victoria has approved.

**How the two weekly approvals fit.** *Draft - for Ilies / Victoria.*
- The Manager approval checks that the sign-ins are complete and correct: every sign-out is in, and every poster sign-in is confirmed. It locks the hours.
- Victoria's approval is the pay decision, per person.
- Victoria can approve a staff member's week only once the Manager has locked it, so the hours can't change under her. Labour-hire and other workers with no register record aren't on the Manager timesheet, so she approves them directly once the week has ended.
- A query doesn't unlock anything. It shows on `/timesheets` beside that person ("Accounts query: …"), so the office can fix the sign-in. Fixing a time in a locked week still needs an Admin to reopen it (existing rule). After a reopen and re-lock, Victoria approves again.
- Victoria's approvals are append-only. The latest one per person counts, and history is kept.

## Schema (all additive; nothing renamed or removed)

1. **`HoursApproval`** records a supervisor's approval of one job's hours for one day.
   - Fields:
     - `id`, `jobId`, `date` (YYYY-MM-DD);
     - `siteLinkId`, `approvedBy` (the supervisor's name), `approvedByResourceId`, `approvedAt`;
     - `snapshot`: JSON, one entry per person approved: `{ attendanceId, name, company, in, out, hours, flag? }`;
     - `note?`.
   - Append-only. A later re-approval adds a new row, and the latest row for a job and date counts.
   - Index on `jobId, date`.
   - **"Changed since approved"** is worked out when read, by comparing the snapshot with the live sign-ins. An office edit after the supervisor approved shows up rather than disappearing silently.
2. **`PayWeekReview`** records Victoria's decision for one person's week.
   - Fields:
     - `id`, `weekStart`;
     - `personKey`: a resource id, or `hire:<name>|<company>` for a labour-hire or subcontractor worker;
     - `personName`;
     - `status`: APPROVED or QUERY;
     - `hours`;
     - `snapshot`: JSON, the lines as she saw them;
     - `note?`, `by`, `byId`, `at`.
   - Append-only; the latest row per person and week counts.
   - Index on `weekStart, personKey`.
3. **`Resource.engagement String?`**: EMPLOYEE or ABN. Blank means "not set" and is treated as an employee for the export, with a warning.
   - It's set on the Labour register by an Admin, next to the pay rates. It isn't a pay figure, but it decides who goes in the pay run.
   - It is **not** filled in automatically. 14 people's notes mention "ABN", and the Accounts screen lists them as "check: notes mention ABN, engagement not set". Setting it is an office data change.
4. **`SiteAttendance` GPS**, captured at sign-in only:
   - `gpsLat Float?`, `gpsLng Float?`, `gpsAccuracyM Float?`;
   - `gpsStatus String?`: OK, DENIED, UNAVAILABLE or TIMEOUT. Null means no attempt was made (older sign-ins, office entries, ticked in by a supervisor).

## Rules (pure code, unit-tested: `lib/payroll/rules.ts`)

- **A day is "supervisor-approved" for a person** when the latest `HoursApproval` for that job and day includes their sign-in, and the hours in the snapshot still match the live sign-in. If the hours have changed since, the day shows as "changed since approved".
- **Sign-in points (Office, Yard, truck QR)** have no job and no supervisor, so they show as "no supervisor step" and go straight to the Manager and Victoria. *Draft - for Ilies / Victoria.*
- **Pay items.** Each line is assigned Ordinary, Night, Saturday or Sunday using `tierFor` (date and shift). Point sign-ins are Ordinary on weekdays. The CSV labels these as `Ordinary Hours`, `Night Hours`, `Saturday Hours` and `Sunday Hours`. *Draft:* the names must match the pay item names in Lobos's own Xero, so Victoria checks them against the "Import timesheets" template in Xero Payroll. Xero's public help doesn't pin down one exact template, and the earnings-rate names are each organisation's own. Both the names and the column headers live in one constant (`PAY_ITEMS`, `EXPORT_COLUMNS`).
- **Who goes in the pay-run file.** People with engagement EMPLOYEE, or not set (flagged), and Victoria's status APPROVED for that week.
  - ABN workers and labour hire are in the weekly summary but **not** in the pay-run file: ABN workers invoice (stage 4), and labour hire is paid through the agency's invoice. *Draft - for Ilies / Victoria.*
- **Travel / regional.** The CSV has a `Travel` column filled with "rule to be agreed", and the weekly view shows a "Travel / regional: rule to be agreed with Victoria" line. That's the hook for the blocked driver/passenger and regional rule. Nothing is calculated.
- **Never in any file or screen built here:** bank details, ABA, TFN or pay rates. Hours only. The export is a download for Victoria; Xero stays read-only.

## GPS at sign-in (the sign-in flow doesn't change)

- Same scan, same taps. When the "Sign in" button shows, the phone is asked for its position in the background (one try, up to 8 s, a cached fix up to 2 minutes old is accepted).
- On tapping Sign in, the position is sent if it has arrived. If not, the page waits at most 1.5 s, then signs in without it and records why (TIMEOUT, DENIED or UNAVAILABLE).
  - A refusal or failure **never** blocks sign-in.
  - There is no tracking: nothing is taken at sign-out or in between.
- One line on the sign-in screen: "Lobos notes where you are when you sign in, only at that moment."
  - The browser's own permission prompt appears the first time on each phone. That's the browser, not a change to Lobos's flow.
- **Who sees it:** the Accounts screen (ACCOUNTS role and Admins) only, as "📍 at sign-in" with accuracy and a map link. No other route sends it: every existing route that returns sign-ins picks its fields explicitly, and that's checked on the copy by scanning the responses.

## Screens

- **Supervisor link**: "Approve today's hours" (SUPERVISOR links only; not HANDOVER, OFFICE or DRIVER).
  - Shown on every supervisor link (not hand-over, office or driver links). One card per job for the chosen day: today, or yesterday.
  - Each person shows in, out and hours, with "No sign-out yet" warnings.
  - Each person can be flagged with a note.
  - "Approve the day" button.
  - Money-free: narrow DTO plus `assertNoMoney`.
- **Accounts → Payroll** (`/accounts/payroll`, `guardAccounts`):
  - a week picker;
  - one row per person, grouped Employees, ABN, Labour hire;
  - day by day: hours, supervisor tick or flag, 📍, Manager lock;
  - Approve and Query with a note;
  - the weekly summary: totals by pay item, by person and by site, plus labour hire by agency;
  - two downloads: the pay-run CSV and the summary CSV;
  - the "check: notes mention ABN" list.
- **`/timesheets`**: one added line per person showing Victoria's status (approved or queried, with the note). Nothing else on that page changes.
- **Labour register**: an "Engagement" field (Employee / ABN), Admin only.

## Left out (blocked) and the hooks left for them

- Emails from accounts@ (pay breakdowns): these need Microsoft 365 admin consent. The weekly summary is per person, so a later email step can reuse it.
- Regional tag and the driver/passenger travel rule: these need a session with Victoria. The hook is the `Travel` column and the "rule to be agreed" line.
- ABA and bank files: never built (decision 4 says files, but TFN and bank details stay in Xero).

## Tests

- **Unit** (`lib/payroll/rules.test.ts`):
  - day approval matching, including "changed since approved";
  - pay-item tiers, including a point sign-in and a night shift;
  - who goes in the pay-run file;
  - CSV escaping;
  - no money words or $ in any export;
  - GPS input parsing (bad values dropped, status kept);
  - the person key for hire workers.
- **Copy** (fresh server backup from the OneDrive off-site copy; never live):
  - the supervisor approves, and the office edit after approval shows "changed";
  - the Manager locks the week, then Victoria approves and queries;
  - permissions: the accounts login and an Admin can open Payroll; a Manager or Viewer gets 403; DRIVER, OFFICE and HANDOVER links can't approve hours;
  - GPS stored on IN only;
  - GPS appears in no response except Accounts;
  - export content checks;
  - viewer safety (`scripts/check-viewer-safety.ts`);
  - the sign-in page in the browser.
