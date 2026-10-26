# Accounts screen - plan (approved by Ilies, 26 Oct 2026)

Source: Victoria's (accounts / office manager) list of 16 needs, sent to Ilies 26 Oct 2026. Ilies: "build this for
accounts without duplicating anything ... a separate log in for accounts and separate to operations" - "approved".

## Principle

One Accounts screen (`/accounts`) for the ACCOUNTS login (and Admins to look in). The accounts login can't open
Operations pages or data; Operations staff (Managers) can't open the Accounts screen. Everything on it READS the
records Operations already keeps (sign-ins, timesheets, receipts, invoices inbox, hire register, Xero, projects,
registers) - nothing entered twice.

## Decisions so far (Ilies)

1. GPS: yes, "with sign in" - but "do not change the way the current sign in works". So: the same scan / tap,
   the phone's location recorded at that moment only (never tracked in between), a line telling workers; if a phone
   refuses location, sign-in still works. Stage 2.
2. Sending emails from accounts@ (pay breakdowns, ABN discrepancies, reimbursements paid) - YES (26 Oct). Workers'
   emails saved on their Labour-register records 26 Oct (33 people; logged). Needs Microsoft 365 admin consent to send as
   accounts@ only. Demo Dump (info@demodump.au) is a subcontractor; Chris bills as Pro Ground Solutions; dunks88 is no
   longer with Lobos; neither is tasman.misionare@hotmail.com (Ilies, 26 Oct) - neither saved.
3. Reading the accounts@ mailbox automatically (Microsoft 365 admin consent, that mailbox only) - not answered yet.
4. Payroll into Xero - YES to files (pay run + ABA); Xero stays read-only (26 Oct).
5. Bank transactions - recommended: through Xero bank feeds (one more read-only Xero scope) - not answered yet.
6. Bunnings PowerPass - no public connection; statements/invoices through the inbox - not answered yet.

## Stages (Victoria's priorities first)

1. **Accounts screen + login separation, due-dates calendar, "pending for me"** - built 26 Oct 2026 (`src/lib/accounts/`,
   `/accounts`, `/accounts/calendar`, `AccountsItem`).
2. Payroll: supervisor approves hours daily; Victoria's final approval; regional tag + driver/passenger travel rule
   (agree with Victoria); ABN and labour hire included; GPS at sign-in; export files; weekly summaries.
3. Full labour cost per job (super, workers comp, payroll tax on-costs, following her spreadsheets); reimbursements
   (Receipts + paid tick + no double claims).
4. ABN invoices vs approved hours (standard Lobos invoice, discrepancy screen, GST flag); supplier invoice vs hire
   register check; equipment rate sheets with over-rate flags.
5. Compliance & HR: tickets with expiries per worker, reminders, expired-ticket flag on the board, onboarding details,
   company / subcontractor documents with expiries. TFN and bank details stay in Xero only.
6. Assets & fleet (insurance, service history from mechanic invoices, fault reports), purchase requests
   (Alex asks -> Victoria checks -> Nick approves), messaging.
7. Bank / card tracking (bonds, double charges, direct debits) and tax projections (payroll tax, BAS, IAS - estimates).
