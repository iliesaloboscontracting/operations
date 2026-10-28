# Admin change kinds (controlled changes, 28 Oct 2026)

Lead's task, Ilies confirmed part by part ("option 2"). Extends LCI phase 4
(`src/lib/changes/`, design `PHASE4-5-DESIGN.md` §1) with seven kinds that the
Building Agent (Operations AI, a MANAGER login) can **propose** and an Admin
**applies by approving** - through the same fingerprint and "before" re-check
flow as the first four kinds. Nothing changes until an eligible person
approves the exact proposal they saw.

## The kinds

| Kind | Record | Before → after | Applied through |
|---|---|---|---|
| `TIP_RATE_ADD` | a new tip rate (site + waste + start date) | no rate from that date → $/t from date | `addRate()` (`lib/receipts/tipStore.ts`, the Admin tip-rate route's code) |
| `TIP_RATE_RETIRE` | a TipRate | in use → retired (reason = the proposal's why) | `retireRate()` |
| `INVOICED_COST_REMOVE` | an InvoicedCost | supplier, number, amount, job → removed | `removeInvoicedCost()` (moved out of DELETE `/api/invoiced-costs/[id]`, which now calls it too; tip dockets re-match, a hire item's estimated days come back because the invoice no longer covers them) |
| `RESOURCE_RATE` | a Resource | the pay fields (people) or day rate (plant / vehicles) named in the proposal | `applyResourcePatch()` as an Admin (the resource PATCH's code) |
| `RESOURCE_ENGAGEMENT` | a person | EMPLOYEE / ABN | `applyResourcePatch()` as an Admin |
| `WORKER_TICKET` | create, or update a WorkerTicket | type (+ class / detail) and expiry only - never a card or licence number | `createTicket()` / `actOnTicket()` (`lib/compliance/store.ts`; the one linked AccountsItem reminder is kept by those functions) |
| `COMPLIANCE_DOC` | create, or update a ComplianceDocument (COMPANY / SUBCONTRACTOR / ASSET) | type, insurer / issuer, expiry - never a policy number | `createDocument()` / `actOnDocument()` |

The "before" re-check at approval: the record still reads what it read when
proposed (a tip rate: no rate yet for that site + waste from that date - the
rate in force is shown for context only, so retiring the old rate first
doesn't make the new one stale). Changed meanwhile → STALE, nothing applied.

## Who

- **Propose:** an Admin, or Operations AI (`isOperationsAi`: the Building
  Agent's email on a MANAGER login). Other Managers and director logins can't.
- **See:** Admins see every admin-kind proposal on `/changes`. Operations AI
  sees its own (with values). Other Managers and director logins don't see
  them at all - rates and amounts stay Admin / Director only. The Directors
  overview still shows commercial kinds only.
- **Approve:** the owner or another Admin. The Building Agent never approves.
- **The narrow exception:** SAME_PERSON pairs the owner and the Building Agent
  (PUR-001). For these admin kinds only, a proposal whose proposer is
  Operations AI *at the time of the decision* is shown "Proposed by
  Operations AI" and the owner **may** approve it. The owner's own proposals
  still can't be approved by the owner (or the Building Agent); a Building
  Agent proposal of any other kind (job number, off-hire date...) still can't
  be approved by the owner; contract values stay DIRECTOR-only; purchases are
  unchanged.

## Around it

- Every proposal carries before → after, why, and a source (document + path
  / row) - `sources` is required as for the other kinds.
- Phone alert to the owner when an admin-kind proposal comes in - at most one
  every 2 minutes (an `ALERTED` event on the proposal records it); the alert
  says how many are waiting, never an amount. The Changes badge counts them.
- `CONTROLLED_CHANGES=off` / `CONTROLLED_CHANGES_OFF=<kind>` switch them off
  like the others.
- Undo: rates and engagement can be undone ("Propose undo" = a new proposal
  with the old values). A removed invoice, a tip rate and a ticket / document
  change are undone by proposing the opposite change.
- No schema change. Admin kinds are stored with audience `ADMIN`.
- Proposing from the screen stays for the first four kinds; admin kinds are
  proposed through `POST /api/changes` (the Building Agent's route).
