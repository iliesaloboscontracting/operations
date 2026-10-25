# LCI phases 4 and 5: controlled changes, lessons and production benchmarks (design)

*Director Insights agent, 25 Oct 2026, for the lead builder's review (Task M). **Design only: no code, no schema
change.** Sources:*
- *`docs/lci/LCI-plan-v2.md` §3.5 (autonomy tiers A0–A4), §3.7 (reuse the request flow), §6 (phase rows 4 and 5);*
- *what Operations already has: findings with VERIFIED outcomes, the site-request decide/history flow, BudgetDecision,
  HIRE_EXTEND requests, information requests (QUERY), the daily log and budget.v1 (Task K);*
- *the lead's current manual routine: propose-then-apply as the Building Agent, logged in
  `operations-agent-log/change-log.csv`.*

## 0. In one paragraph

**Phase 4.** Today, when an answer or a site request means a record should change, the lead writes the change out,
Ilies approves it in chat, the lead applies it through the API as the Building Agent, and a row goes into a CSV file.
Phase 4 puts exactly that routine into Operations, for three small kinds of change to start with:
- a hire item's off-hire date;
- a project's contract value;
- a project's job or quote number.

The system (or a person) writes the **proposal**: record, field, before, after and source. A **different named
person** approves it on screen. The approved change is fingerprinted, so it can't be altered after approval. It's
re-checked at the moment it runs (the "before" must still be true), runs through the same code the normal edit
screen uses, and lands in an append-only change log that replaces the CSV for these kinds. Nothing runs without
approval, and one switch turns it all off.

**Phase 5.**
- **Lessons:** a verified finding can be turned into a short lesson by a named reviewer. It's kept and searchable,
  and nothing is automatic.
- **Production benchmarks:** the daily logs plus the approved budget give real labour hours per unit for each activity
  code. Those are offered to Estimating as **suggestions**. The estimator accepts or rejects each one inside
  Estimating; Operations never changes Estimating's data.

---

## 1. Phase 4: controlled changes (A3)

### 1.1 The three first kinds, and where each comes from

| Kind | Changes | Comes from | Who drafts the proposal | Who may approve (proposed, §6) |
|---|---|---|---|---|
| `HIRE_OFF_HIRE_DATE` | `Resource.offHireDate` of a hire-register item | (1) a **HIRE_EXTEND** request (supervisor: "still needed"); (2) a **HIRE_OVERDUE** finding | **System**, when the supervisor gave a "needed until" date (§1.6); otherwise a **person**, who types the date and says where it came from (e.g. "Hire Express, phone, 25 Oct") | An **Admin** (Ilies; Nick's ADMIN login when covering), as for site requests today |
| `PROJECT_CONTRACT_VALUE` | `Project.contractValue` (+ `contractValueNotes`) | An **answered information request** (QUERY) asking for it | A **person** (the lead as Building Agent, or Ilies) types the figure from the answer, linking the query. Free-text answers are never parsed into money automatically | **Nick and Yoel** (Ilies, 25 Oct; whether the owner may too is to confirm), and never the person who gave the answer |
| `PROJECT_JOB_NO` / `PROJECT_QUOTE_NO` | `Project.jobNo` / `Project.quoteNo` | An **answered information request** | A **person**, linking the query | An **Admin** |

**Why not more yet:** these are exactly the changes the lead makes by hand today. Each is a single field, has an
obvious "before", and is easy to reverse. Board changes, benchmarks and anything costed come later, once these have
run for a few weeks. A4 stays manual, as the plan says: money spent, employment, contracts and safety documents.

> **Note on the contract value.** It's a money *field*, but recording a figure someone has confirmed isn't spending
> or committing money. So it fits A3, with a stricter approver (owner or director access) and its own kill switch.
> If Ilies would rather keep it A4 (manual only), drop that one kind; nothing else changes (decision 2).

### 1.2 The lifecycle

```
PROPOSED ──approve (different person, same fingerprint)──► APPROVED ──re-check passes──► EXECUTED
   │  ╲                                                        │
   │   ╲ reject (reason) ──► REJECTED                          └─ re-check fails ──► STALE (nothing changed)
   │    ╲ withdraw (requester) ──► WITHDRAWN
   └─ past its expiry ──► EXPIRED                       EXECUTED ──"propose undo"──► a new PROPOSED (the reverse)
```

- **Approve and execute happen in one step.** When the approver taps Approve, the server:
  1. checks the fingerprint the approver saw;
  2. checks who they are;
  3. re-reads the record;
  4. applies the change and writes the log, all in one transaction.

  There's no queue of approved-but-not-run changes to go stale.
- **Expiry:** a proposal that isn't decided in time expires and does nothing.
  - Off-hire dates: 3 days, because they get overtaken by events.
  - Project fields: 14 days.
  - An expired proposal can be re-proposed in one tap. That makes a fresh fingerprint and a fresh before-value.
- **Re-check at execution:** the field's current value must still equal the proposal's `before`.
  - Someone edited it meanwhile → STALE, nothing is written, and the screen says "changed since it was proposed
    (now X) - propose again".
  - The record has gone (archived project, hire item returned or deactivated) → STALE.
  - The record now fails the edit screen's own validation (e.g. the off-hire date would fall before the on-hire date) →
    STALE with that message.
- **One open proposal per record and field.** A second one is refused ("already waiting: P-0012"), the same way the
  findings and hire check avoid duplicates.

### 1.3 Separation of duties

- **Requester ≠ approver**, compared by **person**, not by login. Nick has a DIRECTOR login and an ADMIN login, so
  the comparison uses the person's name, as `cannotDecide()` already does for budgets. "System" proposals can be
  approved by any eligible approver.
- **The source person can't approve either.** If Nick answered "contract value is $1.2m", Nick can't approve putting
  it in. Ilies or Yoel does.
- **The Building Agent can never approve.** It's a MANAGER login used by the lead and isn't on any approver list. That
  keeps the lead's own proposals (§1.5) under Ilies's eye, as they are today.
- **Approval needs a positive, signed-in action.** Silence or an expired proposal never counts.

### 1.4 The fingerprint

`sha256` over a canonical JSON (keys sorted, no whitespace) of:
`{ kind, recordType, recordId, field, before, after, sourceRefs[], requestedBy, expiresAt }`.

- It's stored on the proposal, and its first 8 characters are shown on the card.
- The Approve button sends back the full hash the approver was looking at. If anything in the proposal differs, the
  server refuses with 409 "this proposal changed - reload". This is the same protection as Estimating's `version` on
  budget decisions.
- Each **log entry** stores the hash, so every applied change can be traced to the exact approved proposal.

### 1.5 How the approved change is applied (and by whom)

- **The same code as the edit screens.** Today the checks live inside two route handlers:
  - `PATCH /api/resources/:id`: `pickResourceData`, `hireDateError`, `hireRegisterError`;
  - `PATCH /api/projects/:id`: `pickProject`, `validateProjectFile`.

  Step 4a moves each handler's "check, then update" body into a small library function, `applyResourcePatch()` and
  `applyProjectPatch()`. The routes then call it, so their behaviour and output stay byte-identical, and the
  controlled-change executor calls the same function. One set of rules; nothing is duplicated.
- **Who it runs as:** a **system actor** recorded as `LCI (approved by <name>)`. It doesn't impersonate the
  Building Agent's login. There's no session or password to hold, and the approval *is* the authority. The log row
  records both:
  - `executedAs = "LCI"`;
  - `requestedBy` / `approvedBy` = the real people (the Building Agent's name when the lead drafted it).
- **The lead's manual routine maps straight on:**
  - "propose" = a proposal drafted as the Building Agent;
  - "Ilies approves" = Ilies taps Approve;
  - "apply + re-read" = the executor;
  - "CSV row" = the change log.

  The lead stops writing CSV rows for these three kinds once this is live. The existing CSV stays as it is, as
  history (decision 5).
- **Side effects:** nothing extra is needed, because these fields are read live. Each card lists what will move so
  the approver knows:
  - **Off-hire date:** the hire estimate and "still to come" (Tracking forecast) recalculate, and the hire check stops
    asking if the new date is more than 3 days out.
  - **Contract value:** Tracking's Watch/Act status recalculates, and the COST_VS_CONTRACT and DATA_NO_CONTRACT_VALUE
    findings follow on their next run.
  - **Job/quote number:** budget, won-tender, invoice and Xero matching all use it. The proposal is **refused if
    another project already has that number**, a new check at proposal time.

### 1.6 Where proposals come from (screens)

- **Hire check (a small change):** when a supervisor answers "Still needed" past the item's finish, the link asks
  "Until about when?" (an optional date). If they give one, the HIRE_EXTEND request carries it, and the **system
  proposes** the off-hire date with the request as its source. If not, the request shows **Propose new off-hire
  date** for the office to fill in. A date is never made up.
- **HIRE_OVERDUE finding**, and the **Hire page** item: a **Propose new off-hire date** button. A person enters the
  date and its source.
- **Answered QUERY** (Directors → My queries tracker, and the request detail): a **Propose a change from this
  answer** button. It offers contract value, job number or quote number for the query's project (or a project the
  person picks), prefills nothing it can't read exactly, and links the query as the source.
- **Changes to approve:**
  - A new page, **`/changes`**. Manager+ can see it. Proposals are shown by the audience rules: contract-value
    proposals are COMMERCIAL, and never on any link.
  - Approvers see Approve and Reject (with a reason); the requester sees Withdraw.
  - Each card shows: record → field → before → after, the source links, the requester, the expiry, the fingerprint,
    "what this also moves", and "Approve as <name>".
  - Contract-value proposals also appear in a **"Changes to approve"** box on the Directors overview, next to
    "Budgets to approve", for the owner and director logins.
- **Change log tab** (on `/changes`): every executed, stale, expired and rejected proposal, filterable by record,
  with **Propose undo** on executed ones. Undo makes a new proposal with before and after swapped, which goes through
  the same approval.
- **Alerts:** a new proposal pushes nothing by itself, consistent with the Attention tab's removal. The `/changes`
  count shows in the nav badge the way the requests count does. An approver opening Requests sees "2 changes to
  approve" at the top.

### 1.7 Schema proposal (additive; for the lead's OK)

Two tables, following BudgetDecision's pattern: append-only events, and the payload never edited.

```prisma
// A proposed change to one field of one record (LCI phase 4, A3). The payload and fingerprint never change after
// creation; only `status` moves, and every move is a ChangeProposalEvent. Never deleted.
model ChangeProposal {
  id          String   @id @default(cuid())
  number      Int      @unique            // shown as P-0001
  kind        String                      // HIRE_OFF_HIRE_DATE | PROJECT_CONTRACT_VALUE | PROJECT_JOB_NO | PROJECT_QUOTE_NO
  recordType  String                      // Resource | Project
  recordId    String
  recordName  String                      // as at proposal, for the log
  field       String                      // offHireDate | contractValue | jobNo | quoteNo
  before      String?                     // JSON of the value read at proposal time
  after       String                      // JSON of the proposed value (+ contractValueNotes where relevant)
  reason      String                      // why, in words
  sourceRefs  String   @default("[]")     // JSON [{type: SiteRequest|Finding|Query|Phone|Email|Document, id?, label}]
  audience    String                      // OPERATIONAL | COMMERCIAL
  requestedBy String                      // a person's name, or "System"
  requestedByUserId String?
  sourcePerson String?                    // who gave the information (e.g. the query's answerer) - can't approve
  fingerprint String                      // sha256 of the canonical payload (§1.4)
  expiresAt   DateTime
  status      String   @default("PROPOSED") // PROPOSED | EXECUTED | REJECTED | WITHDRAWN | EXPIRED | STALE
  openKey     String?  @unique            // recordType:recordId:field while PROPOSED, null after - one open per field
  undoOfId    String?                     // set on an "undo" proposal
  createdAt   DateTime @default(now())
  events      ChangeProposalEvent[]

  @@index([status])
  @@index([recordType, recordId])
}

// Every step, append-only. The EXECUTED row is the change log entry that replaces the CSV for these kinds.
model ChangeProposalEvent {
  id          String   @id @default(cuid())
  proposalId  String
  proposal    ChangeProposal @relation(fields: [proposalId], references: [id], onDelete: Restrict)
  action      String   // PROPOSED | APPROVED | EXECUTED | STALE | REJECTED | WITHDRAWN | EXPIRED | REFUSED
  by          String   // a name, "System" or "LCI"
  byUserId    String?
  fingerprint String?  // the hash the approver saw (APPROVED / REFUSED)
  valueAtExec String?  // JSON: the value re-read at execution (EXECUTED / STALE)
  note        String?  // reason, refusal message, or the rollback note
  at          DateTime @default(now())

  @@index([proposalId])
  @@index([at])
}
```

- **The CSV's columns map one to one:** date/time = `at`; record type and ID; field; before; after; source =
  `sourceRefs`; approved by; API result = `action` + `note`.
- **A refused approval attempt is logged too** (`REFUSED`: wrong person, wrong fingerprint, switched off, expired),
  as BudgetDecision does, so attempts to get round the rules are visible.
- **Why not reuse `SiteRequest`:** requests are already carrying site asks, actions and queries. A change proposal
  needs an immutable payload, a fingerprint, expiry and a one-open-per-field key that requests don't have. Proposals
  *link to* the request or query they came from (`sourceRefs`) and show on it, so the request flow stays the inbox
  people know.

### 1.8 Kill switch and the approved list

- **`A3_RULES`** in code: one entry per kind, each `{ enabled, approvers, expiryDays, audience }`. A new kind is a
  code change with Ilies's OK, the same as the A2 list.
- **`CONTROLLED_CHANGES=off`** in `.env` stops everything. Proposals can still be read; Approve answers "Controlled
  changes are switched off" and logs REFUSED, and system proposals aren't created.
- **Per-kind switches:** `CONTROLLED_CHANGES_OFF=PROJECT_CONTRACT_VALUE,…`.
- **Expiry sweep:** runs from the `instrumentation.ts` tick, marks EXPIRED, and pushes nothing.

### 1.9 Phase 4 tests

- **Unit (`npm test`):**
  - canonical fingerprint (key order and whitespace don't matter; any payload change does);
  - requester ≠ approver by person, across Nick's two logins;
  - the source person can't approve;
  - the Building Agent can never approve;
  - approver lists per kind;
  - expiry;
  - one open per field;
  - undo swaps before and after;
  - the job/quote number uniqueness check;
  - the kill switches.
- **Bypass and replay** (the plan's exit test), on a copy:
  - approve twice → the second is refused (no longer PROPOSED);
  - approve with an old or wrong fingerprint → 409, nothing written;
  - approve after expiry → refused;
  - approve by the requester, the source person, the Building Agent or a Manager → 403, logged REFUSED;
  - edit the field after proposing → STALE, nothing written;
  - switch off → refused;
  - a direct POST to the executor with no proposal doesn't exist as a route (there's no "execute" endpoint, only
    Approve).
- **"No action runs without approval":** a fingerprint of Project, Resource, Job, Assignment and costs is identical
  before and after a run of proposals that are rejected, expired, withdrawn and stale. After one approval, exactly
  one field on one record differs.
- **Byte-identical:** the resource and project PATCH routes give the same responses before and after step 4a (the
  refactor), and Tracking, Hire and the Directors overview are unchanged until a change is approved.
- **Money guard:** contract-value proposals never appear for a Viewer or on any link (`assertNoMoney` on
  operational lists).

---

## 2. Phase 5a: verified lessons

### 2.1 What and who

- **When a lesson can be made:** once a finding is **VERIFIED**. That means verified automatically after its signal
  stayed clear, or by a person, and it carries `outcomeResult` EFFECTIVE, NOT_EFFECTIVE or RECURRED.
- **Who makes it:** a named reviewer (owner or director access, decision 7) taps **Make a lesson**. Not-effective and
  recurred outcomes make useful lessons too ("chasing the agency by email didn't work; a call did").
- **What a lesson holds:** a short title, the situation, what was done, the result and the lesson in one or two
  sentences. It also has tags (rule code, activity code, client, kind of job) and links back to the finding and its
  evidence.
- **Drafting:** Claude may draft the text from the finding's own events and evidence, the "AI explains" rule. The
  draft quotes only recorded values. The reviewer edits it and publishes. Nothing is published automatically.
- **Where lessons show:** a **Lessons** page on the Directors screen, searchable by tag. They also show on a new
  finding with the same rule and subject ("last time on this job: …"). Later (phase 6) the assistant can cite them.
- **Corrections:** published text is never edited. A wrong lesson is **retired** with a reason, and a corrected one
  can replace it (`supersedesId`).

### 2.2 Schema proposal (additive)

```prisma
model Lesson {
  id           String   @id @default(cuid())
  findingId    String                  // the VERIFIED finding it came from
  ruleCode     String
  projectId    String?
  title        String
  situation    String
  action       String
  result       String                  // EFFECTIVE | NOT_EFFECTIVE | RECURRED (copied from the finding)
  lesson       String
  tags         String   @default("[]") // JSON: rule, activity codes, client, job type
  audience     String                  // as the finding's (DIRECTOR / COMMERCIAL / OPERATIONAL)
  status       String   @default("DRAFT") // DRAFT | PUBLISHED | RETIRED
  draftedBy    String                  // a person, or "Claude (draft)"
  reviewedBy   String?                 // the named reviewer who published it
  reviewedById String?
  publishedAt  DateTime?
  retiredAt    DateTime?
  retiredBy    String?
  retiredReason String?
  supersedesId String?
  createdAt    DateTime @default(now())
  @@index([ruleCode])
  @@index([status])
}
```

The history goes in the existing **FindingEvent** (new actions `LESSON_DRAFTED`, `LESSON_PUBLISHED`,
`LESSON_RETIRED`), so no new event table is needed.

---

## 3. Phase 5b: production benchmarks offered to Estimating

### 3.1 What can honestly be measured

Sites don't measure quantities (the Task K evidence). So production is worked out from what *is* recorded, and every
figure says how it was worked out:
- **Labour hours per unit, per activity code** = labour hours logged on the code ÷ (the approved budget's quantity
  for that package × the latest % complete). For example: STR-02, 400 m² budgeted, 50% complete after 32 h →
  0.16 h/m², against the budget's 64 h ÷ 400 m² = 0.16 h/m².
- **Tonnes per hour for DEM-10 / CIV-02**, measured directly from tip dockets (t or m³ by waste class) ÷ the hours
  logged on the code.
- **Hours lost to delays** are shown alongside, so a slow week caused by weather isn't read as slow work.

**Evidence bar before anything is offered (draft, decision 8):**
- the package is at least **50% complete**, or the job is finished;
- **at least 5 logs** on the code;
- the unit matches the budget package's unit;
- no more than 20% of the logs had the crew entered by hand.

Below the bar, the figure shows in Operations as "early" and is never offered.

### 3.2 Where it shows in Operations

A **Production** page (director access, Manager+ read) lists each code with:
- actual h/unit against the budget's h/unit;
- the jobs and logs behind it;
- the date range;
- hours lost to delays;
- a confidence word.

It's hours only, never dollars. Estimating's supplier rates aren't involved at all.

### 3.3 Offering to Estimating

- **Contract `production-suggestion.v1`** (no money). Operations sends it to Estimating on the same server, through
  `estimatingCall`, as it does today for budgets. The payload:
  `{ schema_version, suggestion_id, code, unit, labour_hrs_per_unit, budget_hrs_per_unit, sample: { jobs[], logs, from, to }, delays_hrs, confidence, evidence_hash }`.
  - It's idempotent by `suggestion_id`: a resend is ignored.
  - It's protected by a shared key, `x-lobos-actuals`, set only on the server, like the budget-approval key.
- **Who triggers it:** a named person (owner or director access) taps **Offer to Estimating** on a code that meets
  the bar. That's one deliberate step per suggestion, not a nightly stream (decision 9).
- **Inside Estimating (built by the Estimating agent):** a "Production suggestions" list. For each one, the
  estimator chooses **Accept** (into a **production library**, as the reference for that code with its evidence) or
  **Reject** (with a reason).
  - **Never automatic.**
  - **Never into the supplier rate library:** that holds dollar rates, and these are hours.
  - Estimating's own estimates still choose their production rates per package. The library is a reference shown
    beside them.
- **Status comes back:** Operations reads `GET api/production-suggestions/:id` for the estimator's decision and shows
  it on the Production page. Operations never writes to Estimating's data beyond posting the suggestion.

### 3.4 Schema proposal (additive)

```prisma
// What Operations offered Estimating, and what the estimator decided (mirrored back). Append-only events.
model BenchmarkOffer {
  id            String   @id @default(cuid())
  code          String                // activity code, e.g. STR-02
  unit          String
  labourHrsPerUnit Float
  budgetHrsPerUnit Float?
  sample        String                // JSON: jobs, log ids, date range, delay hours
  confidence    String
  evidenceHash  String                // sha256 of the sample - the same data can't be offered twice
  offeredBy     String
  offeredById   String
  sentStatus    String                // SENT | FAILED (Estimating down / key missing)
  estimatingStatus String?            // PENDING | ACCEPTED | REJECTED (read back)
  decidedBy     String?               // the estimator, as Estimating reports it
  decidedAt     DateTime?
  decisionNote  String?
  createdAt     DateTime @default(now())
  @@unique([evidenceHash])
  @@index([code])
}
```

### 3.5 Phase 5 tests

- **Lessons:**
  - only a VERIFIED finding can be promoted;
  - only named reviewers can promote;
  - published text can't be edited (retire and replace only);
  - the audience is kept (a DIRECTOR lesson never shows to a Manager);
  - a Claude draft never adds a number that isn't in the finding's evidence (a test compares the numbers).
- **Benchmarks:**
  - the h/unit maths, including several packages sharing one code;
  - the evidence bar;
  - dockets maths per waste class;
  - delay hours shown but not subtracted silently;
  - no dollar figure in the payload (`assertNoMoney` plus a key check);
  - idempotent resend;
  - Estimating down → FAILED, nothing marked as offered.
- **Contract tests** against an Estimating copy on 4350–4359, never 4310: a suggestion arrives as PENDING, Accept
  and Reject read back correctly, and Estimating's rates and estimates are byte-identical before and after.

---

## 4. Sizes and build order

| # | Piece | Size | Depends on |
|---|---|---|---|
| 4a | Move the resource and project PATCH bodies into `applyResourcePatch` / `applyProjectPatch` (routes byte-identical) | S | - |
| 4b | ChangeProposal + events, `A3_RULES`, fingerprint, the person check, expiry sweep, kill switches, unit tests | M | 4a, the schema OK |
| 4c | `/changes` page (approve / reject / withdraw, change log, undo) + nav count | M | 4b |
| 4d | "Propose" buttons: Hire page item, HIRE_EXTEND request, HIRE_OVERDUE finding, answered QUERY | S–M | 4c |
| 4e | Hire check "Until about when?" → system proposals | S | 4b |
| 4f | Directors "Changes to approve" box (contract value) | S | 4c |
| 4g | Bypass/replay copy run; the lead switches CSV logging off for these kinds | S | 4c–4f |
| 5a | Lessons: table, Make a lesson (optional Claude draft), Directors Lessons page, the same-rule hint on findings | S–M | phase 4 not needed |
| 5b | Production page: h/unit per code, the evidence bar, the dockets maths | M | Task K pilot data + an approved budget |
| 5c | `production-suggestion.v1`: offer + read-back in Operations; suggestions list + production library in Estimating (Estimating agent) | M (split across 2 agents) | 5b; the Estimating agent's design |

- **Phase 4 exit test (the plan's):** bypass and replay tests pass, and no action runs without approval (4g).
- **Phase 5 exit test:** the first benchmark accepted by the estimator, with its evidence.
- **Order:** 5a can be built in parallel with phase 4, because it only reads findings. 5b needs at least 2–4 weeks of
  pilot logs on a job with an approved budget, so it naturally comes last.

## 5. What stays manual (A4) and what phase 4 never does

- **Changes nothing else:** no board changes, no costs, invoices, rates, pay, people or contracts, and no SWMS or
  safety documents.
- **No bulk changes:** one field on one record per proposal. A batch is several proposals, each approved.
- **No change from an email or document by itself:** a person drafts the proposal and cites it. Content is data, not
  instructions.
- **Nothing on supervisor links** except the optional "Until about when?" date on the hire check.

## 6. Decisions for the lead / Ilies

1. **Schema:** ChangeProposal + ChangeProposalEvent (phase 4), Lesson (5a) and BenchmarkOffer (5c), all additive. OK?
2. **The contract value as A3** (approved by the owner or director access, never the person who answered), or keep it
   manual (A4)?
3. **Approvers:** Admin for off-hire dates and job/quote numbers; owner or director access for the contract value.
   Should the directors' DIRECTOR logins approve contract values, or only Ilies?
4. **Expiry:** 3 days for off-hire dates, 14 days for project fields (drafts).
5. **The CSV change-log:** leave it as history and stop adding rows for these kinds (proposed), or import its past
   rows for these kinds into the new log once?
6. **Hire check:** may the supervisor's "Still needed" answer ask "Until about when?" (optional), so the system can
   propose the date itself?
7. **Lessons:** who may publish (owner and director access, proposed)? Must the reviewer be someone other than the
   person who resolved the finding?
8. **Benchmark evidence bar:** 50% complete, 5 logs, ≤ 20% crew-by-hand logs (drafts).
9. **Offering to Estimating:** a deliberate "Offer" tap by owner or director access (proposed), or automatic once the
   bar is met? The estimator decides either way.
10. **Estimating's side:** suggestions go into a new **production library** (hours per unit), not the supplier rate
    library. This needs the Estimating agent's design and your OK.

### Answers so far (Ilies, 25 Oct 2026, in this session)

Ilies answered four questions, put to him in plain words. His replies are quoted as written, with how they read:

| Question | Ilies | Reads as |
|---|---|---|
| Decision 2: approve the contract value on screen (A3), or keep it a manual change? | "nick and yoel" | On screen (A3), approved by Nick and Yoel |
| Decision 3: who approves contract values, only Ilies or also Nick's and Yoel's director logins? | "nick and yoel" | **Nick and Yoel approve contract values.** *Still to confirm: whether Ilies (the owner) may also approve them, or only the two directors.* |
| Decision 6: may the hire check's "Still needed" answer ask "until about when?" | "yes" | Yes: an optional date, so the system can propose the off-hire date itself |
| Decision 9: offering a benchmark to Estimating, deliberate tap or automatic? | "deliberate tap until other wise said so" | A deliberate "Offer to Estimating" tap, until Ilies says otherwise |

Still open: 1, 4, 5, 7, 8, 10, and the owner question in 3.
