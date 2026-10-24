# Phase 2 step 2: schema proposal, with the Query variant (for lead review)

Docs only. Director Insights agent, 24 Oct 2026, branch `director-phase2` (main d0cf676 + design update bf00cbe). It builds on `PHASE2-FINDINGS-DESIGN.md` (decisions in §1.4 and §6) and on the signals layer now live (`src/lib/findings/signals.ts`).

Nothing here touches a database until you've reviewed it. The order would be: test copy → row counts unchanged → your review → live, with a backup first.

**What's in it:**
- **2a.** Findings tables: `Finding`, `FindingEvidence`, `FindingEvent`.
- **2b.** Four columns on `SiteRequest` for ACTION and QUERY requests, plus one optional column for an answer attachment.
- **Optional 2c.** `User.personnelId`, so a login and its register person are the same person.
- **Not in step 2:** `Decision`, `DirectorReview` and `Lesson` arrive with steps 6–7 and LCI phase 5. Their shapes are in the design §1.

Everything is **additive**:
- new tables;
- new nullable or defaulted columns;
- no renames, no data rewrites;
- string "enums", as in the rest of the schema (SQLite).

---

## 1. Step 2a: findings tables

```prisma
// One record per problem (not per detection run) - Phase 2, design §1.
// openKey = dedupeKey while the finding is not closed, null once it is:
// SQLite allows any number of NULLs in a unique index, so the database
// itself holds at most one open finding per problem.
model Finding {
  id            String    @id @default(cuid())
  ruleCode      String    // Signal kind, e.g. COST_VS_CONTRACT, HIRE_OVERDUE, DATE_START_MISMATCH
  subjectType   String    // PROJECT | RESOURCE | JOB | COMPANY
  subjectId     String
  subjectName   String    // as last seen - the key uses ids, so a rename never splits a finding
  projectId     String?
  dedupeKey     String    // kind:subjectType:subjectId[:qualifier] (lib/findings/signals.ts)
  openKey       String?   @unique
  severity      String    // CRITICAL | HIGH | MEDIUM | INFO
  audience      String    // OPERATIONAL | COMMERCIAL | DIRECTOR
  title         String
  status        String    @default("OPEN") // OPEN | ACKNOWLEDGED | ACTIONED | RESOLVED | DISMISSED | VERIFIED
  provisional   Boolean   @default(false)
  confidence    String?   // HIGH | MEDIUM | LOW
  source        String    @default("RULE") // RULE | PERSON
  currentValue  String?   // JSON of the latest measured values (history in FindingEvidence)
  href          String?
  firstSeenAt   DateTime  @default(now())
  lastSeenAt    DateTime  @default(now())
  seenCount     Int       @default(1)
  // Verification "asap" (design §1.4): consecutive runs the signal has been
  // clear since it was resolved, and when it first went clear.
  signalClearedAt DateTime?
  clearRuns       Int       @default(0)
  resolvedWhileFiring Boolean @default(false) // never auto-verified
  ownerUserId   String?
  ownerName     String?
  dueDate       String?   // YYYY-MM-DD
  resolvedAt    DateTime?
  resolvedBy    String?
  resolution    String?
  dismissedAt   DateTime?
  dismissedBy   String?
  dismissKind   String?   // FALSE_ALARM | ACCEPTED_RISK
  dismissReason String?
  suppressUntil String?   // YYYY-MM-DD, ACCEPTED_RISK only
  verifiedAt    DateTime?
  verifiedBy    String?   // "System" for automatic verification
  outcomeResult String?   // EFFECTIVE | NOT_EFFECTIVE | RECURRED
  outcome       String?
  reopenedFromId String?  // a new finding after the 30-day window links to the old one
  createdBy     String    @default("System")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  evidence      FindingEvidence[]
  events        FindingEvent[]
  requests      SiteRequest[]

  @@index([dedupeKey])
  @@index([status, severity])
  @@index([projectId])
  @@index([ruleCode])
}

// What a rule saw, from where, and when - append-only (never updated or
// deleted). Written on open and on a material change only.
model FindingEvidence {
  id           String   @id @default(cuid())
  findingId    String
  finding      Finding  @relation(fields: [findingId], references: [id], onDelete: Restrict)
  kind         String   // METRIC | RECORD | DOCUMENT | NOTE (a person's answer, e.g. from a query)
  recordType   String?  // e.g. Project, Resource, InvoicedCost, SiteRequest
  recordId     String?
  label        String
  value        String?  // JSON
  sourceSystem String   @default("Operations")
  asOf         DateTime? // how fresh the source data was
  capturedAt   DateTime @default(now())
  capturedBy   String   @default("System")

  @@index([findingId])
}

// Every change to a finding, with who and why - append-only.
model FindingEvent {
  id        String   @id @default(cuid())
  findingId String
  finding   Finding  @relation(fields: [findingId], references: [id], onDelete: Restrict)
  action    String   // OPENED | ESCALATED | DEESCALATED | ACKNOWLEDGED | ASSIGNED | ACTION_CREATED | QUERY_CREATED |
                     // ANSWERED | ACTIONED | RESOLVED | AUTO_RESOLVED | SIGNAL_CLEARED | NOT_FIXED | DISMISSED |
                     // REOPENED | RECURRED | VERIFIED | COMMENT
  by        String   // name, or "System"
  byUserId  String?
  fromValue String?
  toValue   String?
  note      String?
  at        DateTime @default(now())

  @@index([findingId])
  @@index([at])
}
```

**Why `onDelete: Restrict`:** findings are never deleted (CLAUDE.md, never delete records), and Restrict makes an accidental delete fail instead of taking the history with it.

**The findings run** (engine code, not schema): every 30 min from the `instrumentation.ts` tick, plus after a day close. `loadSignals()` → for each signal, upsert by `openKey`. Then:
- **Clear-run counting:** open findings not seen this run are counted down for verification.
- **Verification:** applies the `FINDINGS_CONFIG` windows (1 run / 2 runs / 7 days). A finding still firing when its check is due gets NOT_FIXED and goes back to OPEN.
- **Recurrence:** a closed finding with the same `dedupeKey` closed within 30 days is REOPENED (status OPEN, `openKey` set again). After 30 days, a new finding with `reopenedFromId`.
- **Dismissed findings** with `suppressUntil` in the future are skipped unless the severity rises.

**Expected size:** about 50 findings at first (50 signals on the 24 Oct copy). Events and evidence grow only on changes, so think hundreds of rows a month, not thousands.

## 2. Step 2b: `SiteRequest` columns (ACTION and QUERY)

```prisma
model SiteRequest {
  // ... existing fields unchanged ...
  origin         String    @default("SITE")        // SITE | FINDING | DIRECTOR | SYSTEM
  findingId      String?
  finding        Finding?  @relation(fields: [findingId], references: [id], onDelete: SetNull)
  audience       String    @default("OPERATIONAL") // OPERATIONAL | COMMERCIAL | DIRECTOR
  assigneeUserId String?   // an app user (accounts login, Nick, Yoel) - alongside assigneeId (Personnel resource)
  answerFile     String?   // QUERY: optional attachment with the answer (e.g. the quote PDF), stored like request photos

  @@index([findingId])
  @@index([assigneeUserId])
  @@index([origin])
}
```

- **Existing rows keep their meaning:** origin SITE, audience OPERATIONAL, the new columns null.
- **No new request statuses in the schema** (status is a string). QUERY adds the value `ANSWERED`, a code change to the decide route's list.
- **Two new system kinds,** never offered on the site form: `ACTION` and `QUERY`.

## 3. The Query variant (a question to fill an information gap)

Ilies (Q3): Nick, Yoel and accounts answer **gap-filling questions only, for now**. The idea: a Queries tab for accounts and "My queries" for Nick.

**What a query is:** a `SiteRequest` with `kind = "QUERY"`, asking one person one question that a finding needs answered. For example:
- "What's the contract value for Vaucluse - Old South Head Rd? (no contract value on file)" to Nick;
- "Is Munster AG10539's second DAY line ($2,145) a duplicate?" to accounts;
- "When is the Mega Hire excavator going back?" to Ilies or a supervisor.

| Part | How |
|---|---|
| Raised by | Ilies (or a director) from a finding: "Ask…" → pick the person. `origin FINDING`, `findingId`, `audience` = the finding's. Later, automatically for an approved list of gap types (LCI A2, which Ilies has approved in principle); not in step 2 |
| The question | `summary` = one line. `details` JSON = `{ question, asks: { recordType, recordId, field } (e.g. Project/…/contractValue), format: "money" \| "date" \| "text" \| "choice", options? }` |
| Assignee | **Exactly one of:** `assigneeUserId` (an app user: the accounts login, Nick, Yoel) **or** `assigneeId` (a Personnel register person, answered on their link) |
| Where it's answered | **In the app** (behind Cloudflare Access and the login): accounts get a **Queries tab on Invoices** (`guardInvoiceInbox`, only queries assigned to the accounts user); Nick and Yoel get **Directors → My queries**. **On a link:** a new link kind `QUERIES` (no schema change, `SiteLink.kind` is a string) that shows only that person's queries. Nick and Yoel already exist in the Labour register as Office (a second, inactive "Nick" too), so their links need no new register entries. For accounts, either a labelled shared link ("Accounts") or app-only |
| **Money on links** | Links are served over the public photos tunnel, protected only by the secret, **not** behind Cloudflare Access. So a link page shows a query in full **only if it's OPERATIONAL and its text passes `assertNoMoney`**. A COMMERCIAL query shows on the link as "A question about <project> is waiting - answer it in Operations", with the app address. Its content stays behind Access |
| Lifecycle | `SENT` (asked) → `SEEN` (opened) → **`ANSWERED`** (the assignee's answer goes in `answer`, plus optional `answerFile`; an event ANSWERED with the full text) → Ilies **closes it**: `DONE` with an outcome (accepted), `ASK` (a follow-up, back to the assignee as NEEDS_INFO) or `DECLINED` / `CANCELLED`. Everything goes into `SiteRequestEvent`, as for site requests |
| Close-out by Ilies | Closing **never changes data by itself.** If the answer is a value for a record (e.g. a contract value), closing opens the usual **propose-then-apply** line (record → field → current → proposed → source = "Query R-0xxx, answered by Nick, 25 Oct"). Ilies applies it, and it goes in the change log. Later this becomes a Decision APPROVAL (step 7). Once the data is fixed, the finding's signal clears on the next run and it auto-resolves and auto-verifies |
| Finding link | On ANSWERED: a FindingEvidence `NOTE` (the answer, by, at, recordType SiteRequest) and a FindingEvent ANSWERED. On DONE: FindingEvent ACTIONED. The finding stays open until its signal clears or a person resolves it |
| No duplicates | One open QUERY per finding per assignee, checked in code (the same pattern as the hire check's "no duplicates while one is open") |
| Reminders | The existing request reminders work unchanged, set by Ilies. A query past its needed-by shows in Directors → overdue actions |
| Who sees what | Assignee: their own queries only (accounts via the Invoices tab, Nick and Yoel via My queries or their link). Ilies and directors: all, on Requests → Actions & queries. Managers: OPERATIONAL and COMMERCIAL queries, read-only. Viewers, TIMESHEETS and supervisors: none |

**Supervisors** can also be asked (e.g. "is the generator still on site?"): `assigneeId` = their register person, shown on their existing SUPERVISOR link, OPERATIONAL and money-free only. That's the same mechanism with no extra schema. It's optional for step 2.

## 4. Optional step 2c: `User.personnelId`

```prisma
model User {
  // ... existing ...
  personnelId String? @unique // the Labour-register person this login belongs to (e.g. Nick's login ↔ Nick, Office)
}
```

This ties a login to its register person, so one query assigned to "Nick" appears both in Directors → My queries and on Nick's QUERIES link. Without it, the asker has to pick "Nick's login" or "Nick's link". It's small and additive.

- **Recommended:** yes.
- **Data needed:** two links (Nick → active Nick, Yoel → Yoel), set by Ilies on the Users page. Data changes go through propose-then-apply; nothing is set by migration.

## 5. Settings (code, not schema)

`src/lib/findings/config.ts`, a `FINDINGS_CONFIG` object with the design §1.4 defaults:
- verify after 1 run / 2 runs / 7 days per rule;
- recurrence 30 days;
- `criticalAlertRecipients` = owner only, until Ilies confirms "me and Nick";
- push CRITICAL only;
- audiences OPERATIONAL Viewer+, COMMERCIAL Manager+, DIRECTOR directors.

If Ilies later wants to change these in the app, that's a small `AppSetting` table. It isn't proposed now.

## 6. Migration and verification plan

1. **On my test copy:** `prisma db push`; row counts in every existing table unchanged; new tables empty; `SiteRequest` defaults applied to existing rows (origin SITE, audience OPERATIONAL).
2. **Regression, byte-identical before/after** (the same method as Tasks B and D):
   - `/api/tracking` (Admin and Manager);
   - `/api/requests` and the site-link request views;
   - `/api/projects`;
   - `/api/directors/overview`.
3. **Engine tests** (`npm test`):
   - first run creates one finding per signal;
   - a second run adds nothing;
   - escalation and de-escalation events;
   - INFO auto-resolves; MEDIUM+ gets signal-cleared and stays open;
   - verification windows per rule; NOT_FIXED → Open; resolved-while-firing needs a person;
   - recurrence ≤ 30 days → REOPENED, > 30 days → new finding with `reopenedFromId`;
   - suppression after dismiss, with an escalation override;
   - two runs racing → one finding (`openKey` unique).
4. **Query tests:**
   - exactly one assignee;
   - one open query per finding per assignee;
   - ANSWERED → evidence and event;
   - close-out never changes the asked-about record;
   - a COMMERCIAL query never shows its text on a link (assertNoMoney on every link payload);
   - accounts sees only its own queries;
   - Managers read-only; Viewers, TIMESHEETS and supervisors none.
5. **Hand over** the branch and commit with all results. You review, test on your copy, merge and deploy.

## 7. Sizes

| Piece | Size |
|---|---|
| 2a schema + engine (upsert, clear runs, verify, recur, suppress) + tests | M |
| 2b `SiteRequest` columns + `QUERY` kind + `ANSWERED` status + decide-route changes + tests | M |
| Query screens: Invoices → Queries, Directors → My queries, the `QUERIES` link page, "Ask…" on a finding | M |
| 2c `User.personnelId` + Users page field | S |

**Questions for you (lead):**
1. Ship 2a and 2b together (one schema change) or separately?
2. `QUERIES` link for accounts: a shared labelled link, or app-only (they already have a login)?
3. Should "Ask…" be offered on INFO / provisional findings only at first (the gap-fillers Ilies described), or on any finding?
