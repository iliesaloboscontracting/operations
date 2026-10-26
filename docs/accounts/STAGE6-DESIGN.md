# Accounts stage 6: Assets & fleet, and purchase requests (design)

Plan: `docs/accounts/ACCOUNTS-PLAN.md` stage 6 (approved by Ilies, 26 Oct 2026). Branch `accounts-s6-assets`, built on the
lead's `7c41426` (main `64c8e08` + stage 5). **Draft defaults for Ilies are D1–D12 in section 6.** Each one is
reversible. Messaging is out of scope; the questions for it are in section 7.

## 1. What already exists, and how stage 6 extends it

| Existing | Stage 6 |
|---|---|
| `Resource` VEHICLE / EQUIPMENT / ATTACHMENT (Vehicles and Plant pages), `serviceDue` (free text), rego in `identifier`, rego expiry often typed into `notes` | Unchanged. The assets list is these resources (owned, active), plus tools. The free text is shown read-only beside the dated items; nothing is parsed (nothing is invented). |
| `ComplianceDocument` + `ComplianceFile` + `syncReminder()` (stage 5): a dated document with files and a 30-day `AccountsItem` reminder | **Reused for asset dates.** New optional `resourceId` / `toolId` link the document to an asset, and `issuer` holds the insurer or issuing authority. New kinds: `REGO`, `ASSET_INSURANCE`, `SERVICE_DUE`, `PLANT_INSPECTION`. Reminders keep going through `AccountsItem`, using the existing calendar categories REGO and INSURANCE, plus a new SERVICE category. No second dated-document or reminder system. |
| `ServiceRecord` (service history per resource: date, mechanic, invoice no., work, amounts; Vehicles page, Manager+) | **Reused.** "Link a mechanic invoice" makes a `ServiceRecord` from an invoices-inbox line (`InvoiceDraft`): date, supplier, invoice no., description and amounts are copied. New `ServiceRecord.invoiceDraftId` (unique) stops one invoice being linked twice. **No second upload:** accounts pick from what is already in the inbox. The inbox's own job-cost decision on that line is untouched. |
| Faults: `ToolIssue` (tool register), `Resource.status` DOWN + `notes`, and daily-log delays coded `PLANT_BREAKDOWN` (no machine id) | **Shown, not copied.** A tool shows its `ToolIssue`s. Plant shows its DOWN status and notes, plus breakdown delays logged on jobs where that machine was booked that day, labelled "logged on a site this machine was on" (an inference, D6). |
| Site requests (`SiteRequest`, `requestTypes.ts`, `OFFICE_KINDS`, Admins decide, alerts to all Admins or the assignee) | **Not reused for purchase requests** (section 3 says why). The link page, push helpers (`pushToUsers`, `pushToSiteLinks`), numbering pattern, `assertNoMoney` and the "same person by name" rule are reused. |

## 2. Assets & fleet

### Screens (ACCOUNTS + Admins, `guardAccounts`)

- **`/accounts/assets`**, with tabs Vehicles / Plant & attachments / Tools. Each row shows:
  - the next rego, insurance and service dates with their state (Expired / Expiring within 30 days / OK / not recorded);
  - open faults;
  - the free-text "Service due" from the register.

  Search, and "Needs attention".
- **`/accounts/assets/resource/[id]`** (vehicles, plant) and **`/accounts/assets/tool/[id]`**:
  - **Dates and documents:** add, edit, archive, restore, files (the stage 5 machinery).
  - **Service history**, vehicles and plant only: the existing records, plus "Link a mechanic invoice". This searches inbox lines from the last 12 months that aren't already linked: supplier, invoice no., date, description and amount (accounts side only).
  - **Faults**, read-only.
- **To do:** reminders show up there automatically, through `AccountsItem`.

### Access

- Accounts and Admins see and edit dates and service links.
- Managers keep the Vehicles and Plant pages exactly as today. No new data reaches a Manager, a Viewer or a link (D4).

## 3. Purchase requests

### Why not a `SiteRequest` kind

- **Different decision chain.** Site requests are decided by Admins, who approve the request onto someone's to-do list. A purchase goes requester → accounts check → director approve → accounts order. Bending `SiteRequest`'s status machine and its alert routing (`alertRouteFor`) for this would change behaviour that supervisors and Alex rely on.
- **Amounts would reach a link.** A `SiteRequest`'s text and status are what a link shows. The amount must live where a link can never read it, so purchases get their own small table with a narrow link DTO.

### Model (additive)

```prisma
model PurchaseRequest {
  id, number Int @unique (P-0001), what, why?, qty?, supplier?, linkUrl?, neededBy? (YYYY-MM-DD), projectId?,
  requestedBy (name), requestedByUserId?, siteLinkId?, source LINK | APP,
  status REQUESTED | NEEDS_INFO | CHECKED | APPROVED | DECLINED | ORDERED | CLOSED | CANCELLED,
  infoQuestion?, infoAnswer?,            // shown on the link: money-guarded
  amountExGst Float?, accountsNote?,     // ACCOUNTS / DIRECTORS only - never in a link or Manager DTO
  checkedBy/At, decidedBy/At, decisionNote?, orderedBy/At, closedReason?, version, createdAt, updatedAt
  events PurchaseRequestEvent[]          // append-only: status, by, at, note
}
```

### The rules (`lib/purchases/rules.ts`, tested)

| From | Action | By | To |
|---|---|---|---|
| (new) | ask | Alex's OFFICE link (personal, not shared) or a Manager / Admin / Accounts login | REQUESTED |
| REQUESTED | check (amount ex GST **required**, note optional) | ACCOUNTS / Admin | CHECKED |
| REQUESTED | ask for info (question, no money) | ACCOUNTS / Admin | NEEDS_INFO |
| NEEDS_INFO | answer (no money) | the requester (same link or login) | REQUESTED |
| REQUESTED / NEEDS_INFO | close: not needed or a duplicate (reason) | ACCOUNTS / Admin | CLOSED |
| REQUESTED / NEEDS_INFO | cancel | the requester | CANCELLED |
| CHECKED | approve, or decline (reason) | a **DIRECTOR login**, and not the requester (same name across logins) | APPROVED / DECLINED |
| APPROVED | ordered | ACCOUNTS / Admin | ORDERED |

Every action is version-checked and recorded as an event with the person's name.

### Money

- `amountExGst` exists only in the Accounts and Directors DTOs.
- The link and Manager DTOs are built without it (narrow types), and the link DTO is checked with `assertNoMoney`.
- Text that can reach the link (`what`, `why`, `infoQuestion`, `infoAnswer`, `decisionNote`) is refused if it contains a dollar figure.

### Screens

- **Alex's OFFICE link:**
  - an **"Ask to buy something"** button with a form: what, why, how many, supplier, a link, needed by, and a job (optional);
  - a **"My purchase requests"** list: number, what, status in words ("With accounts", "Accounts need more info: …", "Approved", "Declined: …", "Ordered"), answering a question, cancelling.
  - It never shows an amount.
- **In-app:** `/purchases`, for Manager+ and Accounts. The same form, plus the person's own requests with their status. No amounts for Managers.
- **Accounts:**
  - **`/accounts/purchases`**: requests to check (enter the amount), questions waiting, approved ones to order, and history.
  - **To do** gets a "Purchase requests waiting for you" section.
- **Directors:** **`/directors/purchases`**, "Purchases to approve". It shows what, why, requester, job, amount ex GST, accounts' note, approve or decline. Others with director access see a note instead of buttons, the same as budgets.

### Alerts (existing push only)

- **New request:** the ACCOUNTS logins.
- **Checked:** the DIRECTOR logins.
- **Needs info, approved, declined or ordered:** the requester's link (`pushToSiteLinks`) or their login (`pushToUsers`). Push text is status words only, never an amount.

## 4. Schema additions (additive)

- **`ComplianceDocument`:** `resourceId` (Resource, Restrict), `toolId` (Tool, Restrict), `issuer`, and an index on each link.
- **`Resource` and `Tool`:** an `assetDocuments` relation only.
- **`ServiceRecord`:** `invoiceDraftId` @unique and `createdBy`.
- **New tables:** `PurchaseRequest` (with an optional `project` relation, Restrict) and `PurchaseRequestEvent`.
- `Project` gains a `purchaseRequests` relation list only.

## 5. Tests

- **`lib/purchases/rules.test.ts`:**
  - every transition is allowed or refused;
  - only a DIRECTOR login, and not the requester, may decide;
  - an amount is required to check;
  - no money in link-facing text;
  - the link DTO has no amount.
- **`lib/assets/rules.test.ts`:** the next-due and worst-state per asset, the reminder category per kind, and the inbox-line filter (linkable, not already linked).
- **On a copy (port 3002):** the API end to end, for every role and the link; viewer-safety; a browser check.

### Results (27 Oct 2026, on a copy of the server backup `cloud-dev-20261027-0130`)

- `tsc` clean; `npm test` 260 / 260; `next build` passes.
- End to end, 80 / 80 checks (throwaway users and links, on the copy only):
  - access for each role: assets and accounts purchases are ACCOUNTS + Admin only, directors' purchases need director access, Viewers can't ask;
  - asset dates: added to a vehicle, a plant item and a tool; the reminder appears on To do with the calendar's category, follows an edit, and is cancelled on archive; company documents stay separate;
  - service history: an inbox line linked to a vehicle; linking it again (any asset) is 409; a tool or a person isn't a vehicle / plant item;
  - purchases: the full chain (ask on the link, question, answer, check with amount, director approves, ordered), the event history, the closed / cancel cases, and five asked at once getting five different numbers;
  - money: a dollar figure is refused in the request, the question, the answer and a director's note; the link and Manager JSON carry no amount or accounts note;
  - approver: a DIRECTOR login with the requester's name is refused with the reason shown; an Admin without director access can't see the page.
- `scripts/check-viewer-safety.ts`: 18 / 18, including 5 new stage 6 checks.
- Browser: the assets list and a vehicle's page, Accounts purchases, Directors purchases, and the OFFICE link at phone width (`?go=purchases`).

## 6. Draft defaults for Ilies (all reversible)

1. **D1 Asset dates are `ComplianceDocument`s.** Kinds: Rego, Insurance, Service due, Plant inspection / certificate.
2. **D2 Reminder 30 days ahead**, the same as tickets.
3. **D3 Service due by date only.** By-kilometre servicing stays in the free-text "Service due" for now.
4. **D4 Managers see nothing new.** The Vehicles and Plant pages are unchanged. Should Managers see rego and insurance expiry (operational: an unregistered truck)? A board-style flag like the ticket one would be easy.
5. **D5 Linking a mechanic invoice copies its amounts into the service record**, which Managers already see on the Vehicles page today. Keep it, or hide amounts from Managers there?
6. **D6 Plant faults** show the DOWN status and notes, plus PLANT_BREAKDOWN delays on jobs the machine was booked on that day (an inference, labelled). A proper "which machine broke down" field on the daily log would need the daily-log owner's OK.
7. **D7 Tools in the assets list** get dates and files plus their existing `ToolIssue`s, but no service history (tools aren't `Resource`s).
8. **D8 Purchase requests from a link:** personal OFFICE links only (Alex). Supervisors keep using site requests for materials and tools.
9. **D9 The amount is entered by accounts** at the check step, and is required. The requester never enters one, not even in the app.
10. **D10 Approvers:** any DIRECTOR login (Nick, Yoel), never the requester. Not the owner, the same as budgets. Is there a value under which accounts can approve without a director?
11. **D11 "Ordered"** is set by accounts. There is no purchase-order number or supplier invoice matching yet; that could come with the inbox later.
12. **D12 Nothing is deleted.** Requests close, cancel or decline, with events kept.

## 7. Messaging: questions for Ilies (not built)

1. Who messages whom: accounts ↔ workers (pay questions), accounts ↔ office, directors ↔ accounts?
2. Which channel: in-app only, the worker's site link, email from accounts@ (decision 2 in the plan), or SMS?
3. One-to-one threads, or messages attached to a record (a pay week, an invoice, a purchase request)?
4. Does anything need a read receipt or a reply-by date?
5. How long are messages kept? Can a sent message be edited or deleted?
6. Should pay or money ever be discussed in a message that could reach a link? (Today the rule is never.)

## 8. Infrastructure

No new folder: asset files use `COMPLIANCE_FILE_DIR` from stage 5. No new route, outbound connection or dependency. `prisma db push` is additive.
