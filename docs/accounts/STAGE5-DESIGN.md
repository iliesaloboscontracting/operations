# Accounts stage 5: Compliance & HR (design)

Plan: `docs/accounts/ACCOUNTS-PLAN.md` stage 5 (approved by Ilies, 26 Oct 2026). Built by the Estimating agent on branch
`accounts-s5-compliance` (from `main` `e775052`), for the lead to review. **Draft defaults that need Ilies's eye are
marked D1–D11 in section 7.** Each one is reversible.

## 1. What already exists (extended, not rebuilt)

| Existing | How stage 5 uses it |
|---|---|
| `Resource` (type PERSONNEL) - the Labour register | Workers are Labour-register people. Tickets and onboarding hang off `Resource.id`. No second "worker" table. |
| `Resource.tickets` - free text "Tickets / licences" on the Labour page | **Kept as it is.** It is shown read-only on the worker's compliance page as "From the Labour register", to help data entry. It is never parsed into tickets automatically (CLAUDE.md: never invent worker qualifications). |
| `AccountsItem` + `alertDays` + `alertAccountsDue()` (stage 1) | **The only reminder system.** Every ticket or document with an expiry gets one linked `AccountsItem` (category `TICKET` / `COMPLIANCE`). The Accounts "To do" list, the Due-dates calendar and the phone alert all pick it up unchanged. |
| `guardAccounts()` (ACCOUNTS + Admins) | All stage 5 pages and data routes. Managers never open them. |
| File storage pattern (`lib/invoiceFiles.ts`, `lib/receipts/files.ts`) | Same pattern for `COMPLIANCE_FILE_DIR`: random names, type and content checks, served only through a guarded route. |
| The money guard | No money is stored anywhere in stage 5 (no premiums, cover amounts or pay). The board flag DTO carries a label and a date only. |

## 2. Schema (additive only)

```prisma
model WorkerTicket {           // one ticket / licence / induction held by a worker
  id, resourceId -> Resource
  kind        // WHITE_CARD | DRIVER_LICENCE | HRWL_FORKLIFT | HRWL_EWP | HRWL_DOGGING | HRWL_RIGGING | HRWL_SCAFFOLD | HRWL_OTHER |
              // PLANT_VOC | ASBESTOS_A | ASBESTOS_B | ASBESTOS_SUPERVISOR | ASBESTOS_AWARENESS | FIRST_AID | CPR |
              // CONFINED_SPACE | HEIGHTS | TRAFFIC_CONTROL | GAS_TEST | SILICA | SITE_INDUCTION | OTHER
  label?      // class or detail: "HC", "WP (boom ≥11 m)", "Westfield Parramatta induction"
  number?     // licence / card number (accounts + Admins only; never on the board or a link)
  issueDate?, expiryDate?   // YYYY-MM-DD; no expiry = never expires (e.g. white card)
  status      // ACTIVE | ARCHIVED (replaced or no longer held) - never deleted
  archivedReason?, replacesId?, notes?, createdBy/At, updatedBy/At
  files ComplianceFile[]
}
model ComplianceDocument {     // company and subcontractor documents with expiries
  id, holderType (COMPANY | SUBCONTRACTOR), holderName, kind, title, reference?, issueDate?, expiryDate?,
  status ACTIVE | ARCHIVED, archivedReason?, notes?, createdBy/At, updatedBy/At, files ComplianceFile[]
}
model ComplianceFile {         // photo / PDF of a ticket or document, in COMPLIANCE_FILE_DIR
  id, fileName @unique, originalName, mime, size, ticketId?, documentId?, uploadedBy, createdAt,
  removedAt?, removedBy?       // "remove" hides it; the file stays on disk (never deleted)
}
model WorkerOnboarding {       // onboarding details per worker, kept apart from pay
  id, resourceId @unique -> Resource
  startDate?, employmentType? (EMPLOYEE_FULL_TIME | EMPLOYEE_PART_TIME | CASUAL | ABN_CONTRACTOR | LABOUR_HIRE),
  abn?, address?, dateOfBirth?, emergencyName?, emergencyPhone?, emergencyRelation?,
  xeroSetUp Boolean        // "TFN, bank and super set up in Xero" - a tick only, never the details
  contractSigned?, policiesSigned?, inductionDate?   // dates
  notes?, updatedBy, updatedAt, createdAt
}
AccountsItem  + sourceType String? (WORKER_TICKET | COMPLIANCE_DOC), sourceId String?, @@index([sourceType, sourceId])
Resource      + workerTickets WorkerTicket[], onboarding WorkerOnboarding?   (relations only, no columns)
```

**TFN and bank details are never stored or asked for.** They stay in Xero only. Every free-text field in stage 5 is
checked by `looksLikeTfnOrBank()`. The check refuses words such as "TFN", "tax file", "BSB" or "account number", a
9-digit TFN-shaped number, and a BSB-shaped "123-456" next to an account-shaped number. Onboarding has a single tick,
"set up in Xero".

## 3. Reminders (one system: `AccountsItem`)

`lib/compliance/reminders.ts` `syncReminder()` runs after every ticket or document change:

- **Active with an expiry:**
  - If there is no open linked item, one is created: `{ kind DUE, category TICKET | COMPLIANCE, title "Ticket expires: <worker> – <ticket>" or "<holder>: <document> expires", dueDate = expiry, alertDays 30 }`.
  - If there is one, it is updated. A new expiry date reopens a done item and resets `alertedFor`.
- **Archived, or no expiry:** the open linked item is cancelled.
- Accounts then sees it, with no new screen:
  - **"Due and reminders"** on To do, from 30 days before the expiry (D2);
  - the **Due-dates calendar**;
  - **one phone alert** when it enters the window, from the existing tick.
- **Renewing:** add the new ticket with "Replaces" set. The old one is archived and its reminder is cancelled; the new one gets its own reminder.

## 4. The expired-ticket flag (Operations board)

- `GET /api/compliance/flags` (`guard("MANAGER")`) returns `{ [resourceId]: { expired: [{ label, expiryDate }] } }`, for active tickets whose expiry is before today (Sydney).
  - It returns no numbers, files or onboarding data.
  - Viewers get 403, so a Viewer never sees compliance data.
- The board fetches it once (Managers and Admins only) into a small React context. A person's sidebar card and their chips on jobs show a red **"ticket"** badge, with the ticket names and dates as a tooltip.
- **Information only:** dragging, assigning and saving are untouched and never blocked.

## 5. Screens (Accounts screen, ACCOUNTS + Admins)

- **To do:** expiring and expired tickets and documents appear in "Due and reminders" through their `AccountsItem`. There is also a "Compliance" link.
- **`/accounts/compliance`**, with two tabs:
  - **Workers:** active Labour-register people. Each row shows the worst ticket state (Expired / Expiring within 30 days / OK / No tickets), the ticket count and onboarding progress (x of 6). It can be searched and filtered to "Needs attention".
  - **Company & subcontractors:** documents with holder, kind, reference and expiry state. You can add, edit or archive them and attach files.
- **`/accounts/compliance/workers/[id]`:**
  - **Tickets:** add, edit, renew (replace) or archive; files can be attached, viewed or removed.
  - **Onboarding** form.
  - The Labour register's free-text tickets, read-only.
- **Files:** `POST /api/compliance/files` uploads (PDF, JPG, PNG or WebP; 15 MB; content checked). `GET /api/compliance/files/:id` serves a file inline with `Cache-Control: no-store`, behind `guardAccounts`. **Never on a site link.** The tunnel publishes only `site/*` and `api/site/*`, and these routes are neither.

## 6. Who sees what

| | ACCOUNTS | ADMIN | MANAGER | VIEWER / site links |
|---|---|---|---|---|
| Tickets, numbers, files, onboarding, documents | read + edit | read + edit | - | - |
| Expired-ticket flag on the board (label + date) | - (no board) | yes | yes | - |
| Reminders on To do / calendar | yes | yes (Accounts screen) | - | - |

## 7. Draft defaults for Ilies (all reversible)

1. **D1 Ticket kinds:** the list in section 2, plus "Other" with a free label. It can be added to at any time.
2. **D2 Reminder window:** 30 days before expiry. That is the existing `alertDays` maximum. Per item it can be shortened, never lengthened past 30.
3. **D3 Board flag shows EXPIRED only.** "Expiring within 30 days" shows on the Accounts screen but not on the board, to keep the board quiet.
4. **D4 Expiry is typed by a person from the card.** Nothing is computed from typical validity periods, so nothing is invented.
5. **D5 Onboarding fields:** start date, employment type, ABN (contractors), address, date of birth, emergency contact, "set up in Xero" tick, contract / policies signed dates, company induction date, notes. Date of birth and address are personal data. **Decided 27 Oct 2026:** address kept, date of birth not collected (the field is left in the database, empty, so it can be switched on later).
6. **D6 Who edits:** ACCOUNTS and Admins. Managers only see the board flag.
7. **D7 Nothing is deleted.** Tickets and documents are archived, and a removed file is hidden but stays on disk.
8. **D8 Company holder names:** free text with suggestions ("Lobos Contracting", "Lobos Civil", and labour-hire agencies already on the hire register). There is no subcontractor table yet.
9. **D9 Document kinds:** public liability, workers comp, contract works, professional indemnity, motor vehicle, plant insurance, demolition licence, asbestos licence (Class A/B), SWMS template, WHS / quality certification, other. No cover amounts are recorded (no money).
10. **D10 Legacy `Resource.tickets` text** stays on the Labour page and is shown read-only beside the structured tickets. Someone enters the structured tickets from the cards; there is no automatic conversion.
11. **D11 Labour hire workers** (signed in by name + company, not on the register) have no ticket records here. Their tickets are the agency's documents (a SUBCONTRACTOR document per agency).

## 8. Infrastructure steps for the lead (not done by this branch)

1. **Folder:** on the server, `sudo install -d -o operations -g operations -m 750 /srv/operations/compliance-files`.
2. **Environment:** in `/srv/operations/app/.env`, set `COMPLIANCE_FILE_DIR=/srv/operations/compliance-files`. If it is unset, the app falls back to `../operations-compliance-files` next to the app.
3. **Nightly backup** (`operations-backup` service script): add `compliance-files-*.tar.gz` with the same 14-day retention as `receipt-files`.
4. **Off-site copy:** in `scripts/backup-cloud.ps1`, pull `compliance-files-*.tar.gz` into OneDrive `Operations-Backups\cloud-compliance-files-*`, with the same 30 days as the others.
5. **Schema:** `prisma db push` adds 4 tables, 2 columns and 1 index. It's additive, so no data moves. Test on a copy first, as usual.
6. No new Cloudflare route, no new outbound connection, and no new dependency.

## 9. Tests

**Results on 26–27 Oct 2026** (fresh off-site copy `cloud-dev-20261026-0651`, worktree `operations-s5`, port 3002, throwaway users):
- `tsc` is clean, and `npm test` passed 218 of 218, 9 of them new.
- `npm run build` is OK.
- The end-to-end API run passed 45 of 45 checks, covering access per role, tickets and the TFN / BSB refusals, reminders on To do, renew and archive, the board flag, files, onboarding and documents.
- `check-viewer-safety.ts` passed 13 of 13, including 3 new compliance routes, which are now part of the script.
- A browser check passed:
  - the board badge on a sidebar card and on a job chip, with the assignment not blocked;
  - Accounts To do, Compliance workers, the worker page (the add-ticket form refused a TFN), documents, and the phone width at 375 px;
  - a Manager is refused the screen.

- **`src/lib/compliance/rules.test.ts`:** expiry states (no expiry, valid, expiring at 30 / 31 days, expires today, expired), the worst state for a worker, archived tickets ignored, the TFN / bank detector (catches and allows), kind validation and date order.
- **`src/lib/compliance/reminders.test.ts`:** the reminder sync decisions (create, update, reopen on a new expiry, cancel on archive or no expiry, leave a done item done when nothing changed).
- **On a fresh `.backup` copy (port 3002):**
  - `prisma db push`;
  - the API end to end as an Admin and as ACCOUNTS;
  - a Manager gets flags only, and 403 everywhere else;
  - a Viewer gets 403 on flags;
  - the reminder appears on To do;
  - the board badge shows;
  - `scripts/check-viewer-safety.ts`;
  - `tsc` and `npm test`.
