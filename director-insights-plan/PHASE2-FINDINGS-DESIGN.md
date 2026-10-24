# Phase 2 design: one model for findings, actions, decisions and approvals

Planning only: no code, no schema change. Director Insights agent, 24 Oct 2026, branch `director-phase2` (from main 5aad599), for lead review.

**Scope.** One design that serves both:
- **Director Insights Phase 2**: management actions, decision log, meeting mode;
- **LCI plan v2**: phase 3 (stored findings with evidence, owner, status, outcome) and phase 4 (approvals).

**Principles** (from LCI v2 §3 and §7):
- rules decide, AI only explains;
- every finding carries evidence;
- missing data gives a *provisional* finding, never a guess;
- approvals need a positive, signed-in action;
- the requester is never the approver;
- the money guard stays.

---

## 1. The data model

Five new tables, plus four additive columns on `SiteRequest`. Actions **are** site requests (section 3), so there's no second to-do or approval queue.

```
Finding ──< FindingEvidence     (append-only: what the rule saw, when)
   │  └──< FindingEvent         (append-only: every status change, with who and why)
   │
   ├──< SiteRequest (kind ACTION, origin FINDING)    = management actions, reusing the existing flow
   │
   └──< Decision                (decision log + approvals; content immutable)
DirectorReview                  (one row per board / director meeting, with a frozen pack)
Lesson                          (LCI phase 5, later; not in this build)
```

### Finding

One record per *problem*, not per detection run.

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| ruleCode | String | e.g. `COST_VS_CONTRACT`, `HIRE_OVERDUE`, `DATE_START_MISMATCH` (catalogue in section 2) |
| subjectType / subjectId | String | `PROJECT` / `RESOURCE` / `JOB` / `COMPANY`, plus the record's id |
| projectId | String? | Denormalised for filtering |
| dedupeKey | String | `ruleCode:subjectType:subjectId[:qualifier]`, stable across runs |
| **openKey** | String? **@unique** | = dedupeKey while the finding is not closed; null once RESOLVED, DISMISSED or VERIFIED. SQLite allows many NULLs in a unique index, so there's **at most one open finding per problem**, enforced by the database |
| severity | String | CRITICAL / HIGH / MEDIUM / INFO (the Directors priorities) |
| audience | String | `OPERATIONAL` (Viewer+, never money) / `COMMERCIAL` (Manager+, the same money Tracking already shows Managers) / `DIRECTOR` (directors and owner only) |
| title, detail | String | Plain words. OPERATIONAL text must pass `assertNoMoney` |
| status | String | OPEN / ACKNOWLEDGED / ACTIONED / RESOLVED / DISMISSED / VERIFIED |
| provisional | Boolean | Data incomplete; the finding says what's missing |
| confidence | String? | HIGH / MEDIUM / LOW (as on the Directors page) |
| source | String | `RULE` or `PERSON` (a director can raise one by hand) |
| currentValue | String? | JSON of the latest numbers (e.g. `{forecast, contract, pct}`), overwritten each run. History lives in FindingEvidence |
| firstSeenAt, lastSeenAt, seenCount | | Repeat detections touch these and nothing else |
| signalClearedAt | DateTime? | The rule stopped firing but a person hasn't closed it (section 1.2) |
| ownerUserId, ownerName, dueDate | | Who's responsible and by when |
| resolution, dismissReason, dismissKind, suppressUntil | | dismissKind: `FALSE_ALARM` (counts towards rule tuning) / `ACCEPTED_RISK` (with suppressUntil) |
| outcome, outcomeResult, outcomeVerifiedBy/At | | outcomeResult: `EFFECTIVE` / `NOT_EFFECTIVE` / `RECURRED` |
| reopenedFromId | String? | When a problem comes back after closing, a new finding links to the old one |
| createdAt, updatedAt | | |

Indexes: `openKey` (unique), `dedupeKey`, `[status, severity]`, `projectId`, `ruleCode`.

### FindingEvidence (append-only)

Each row is one piece of evidence: what was seen, from where, and when.

| Field | Notes |
|---|---|
| findingId | |
| kind | `METRIC` (a number from a rule), `RECORD` (a link to a source row), `DOCUMENT` (SharePoint file + revision), `NOTE` (a person's note) |
| recordType, recordId | e.g. `InvoicedCost`/id, `Resource`/id, `SiteRequest`/id. Lineage: KPI → field → record (brief §9) |
| label, value | value is JSON, e.g. `{forecast: 104200, contract: 100000}` |
| sourceSystem | `Operations`, `Estimating`, `SharePoint` … |
| capturedAt, asOf | asOf = how fresh the source data was |

Written when a finding opens, and again **only when the value changes materially**: the severity changes, a percentage moves by 5 points or more, or the linked record changes. A rule running every 30 minutes doesn't flood the table.

### FindingEvent (append-only)

Same shape as `SiteRequestEvent`:
- `findingId`;
- `action`: OPENED, ESCALATED, DEESCALATED, ACKNOWLEDGED, ASSIGNED, ACTION_CREATED, ACTIONED, RESOLVED, AUTO_RESOLVED, SIGNAL_CLEARED, DISMISSED, REOPENED, OUTCOME_VERIFIED, COMMENT;
- `by` (name, or "System"), `byUserId?`, `from`, `to`, `note`, `at`.

Never updated or deleted. This is the finding's audit trail, and it can later feed LCI phase 0's app-wide audit log.

### SiteRequest: four additive columns (actions reuse requests; section 3)

| Column | Default | Purpose |
|---|---|---|
| origin | `"SITE"` | `SITE` (supervisor link), `FINDING`, `DIRECTOR` (from a meeting), `SYSTEM` (hire check, already system types) |
| findingId | null | The finding this action answers |
| audience | `"OPERATIONAL"` | Same meaning as on Finding. `GET /api/requests` filters on it, so Managers never see DIRECTOR actions |
| assigneeUserId | null | Today `assigneeId` is a **Personnel resource** (Alex's office link). Directors are app users, possibly without a link, so this lets an action be assigned to a user and shown in their "My actions" |

Every existing row keeps its meaning through the defaults. A new system request kind `ACTION` ("Management action") is never offered on the site form, the same as OFF_HIRE / HIRE_MISMATCH / HIRE_EXTEND.

### Decision: decision log and approvals in one table

The content is immutable once written. A correction is a new row with `supersedesId`.

| Field | Notes |
|---|---|
| type | `DECISION` (a director decision recorded in a meeting or on a finding) or `APPROVAL` (LCI A3: a proposed change waiting for sign-off) |
| title, context | What was decided or proposed, and why |
| findingId?, requestId?, reviewId?, kpiId?, projectId? | Links |
| tier | For APPROVAL: `A3`. A4 is never an approval here: it stays manual and LCI only prepares the information |
| proposedChange | JSON of the **exact** change, e.g. `{model:"Resource", id, field:"offHireDate", from:"2026-10-20", to:"2026-11-07"}` |
| changeHash | sha256 of the canonical proposedChange: the "fingerprint". Execution refuses if the stored change no longer hashes the same |
| requestedById / requestedBy / requestedAt | |
| status | APPROVAL: `PENDING → APPROVED / REJECTED / EXPIRED / WITHDRAWN`, then `APPROVED → EXECUTED / FAILED`. DECISION: `RECORDED` (or `SUPERSEDED`) |
| approverId / approverName / decidedAt / reason | Must be **a different user** from requestedById (section 1.3) |
| expiresAt | APPROVAL only, e.g. 72 h. Expired ones can't execute |
| executedAt, executionResult, rollbackNote | The re-check result at execution time, and how to undo |
| decidedBy (DECISION) / ownerName / dueDate | For the decision log. A follow-up becomes an ACTION request |
| supersedesId | Corrections |

### DirectorReview (meeting mode)

| Field | Notes |
|---|---|
| heldOn, periodFrom, periodTo | The review period ("since last review") |
| attendees | Text, e.g. "Ilies, Nick, Yoel" |
| pack | JSON: the board pack **exactly as shown**, frozen (section 4) |
| createdBy, createdAt | Append-only. Decisions made in the meeting link to it via `reviewId` |

### Lesson (LCI phase 5, later)

`statement`, `findingIds`, `ruleCode / activity`, `evidence`, `approvedBy`, `status`. Not built in Phase 2. It's listed so the Outcome fields above already carry what it will need.

### 1.1 Lifecycle

```
            (rule fires / person raises)
                        │
                        ▼
   ┌──────────────── OPEN ───────────────┐
   │ acknowledge         │ create action │  dismiss (reason)
   ▼                     ▼               ▼
ACKNOWLEDGED ──────► ACTIONED        DISMISSED ── suppressUntil passes or severity escalates ──► new OPEN (linked)
   │                     │
   └──────── resolve (resolution note) ─────► RESOLVED ── check period (14 days) ──► VERIFIED (EFFECTIVE / NOT_EFFECTIVE)
                                                │
                                                └── same problem fires again inside the period ──► REOPENED (same finding,
                                                    status back to OPEN, outcomeResult RECURRED)
```

- **Acknowledged**: "seen, it's mine". Sets the owner if there isn't one.
- **Actioned**: an ACTION request exists and is with someone, or the owner records what was done. When the linked request is marked DONE, the finding gets an event and a "ready to resolve?" prompt. It is never closed silently.
- **Resolved**: needs a resolution note.
- **Dismissed**: needs a reason, as either `FALSE_ALARM` or `ACCEPTED_RISK until <date>`.
- **Verified**: after the check period, if the rule hasn't fired again, a director confirms the outcome.

### 1.2 When the signal stops firing (no silent disappearance)

- **INFO / data-gap findings** (e.g. "no contract value") **auto-resolve** with an AUTO_RESOLVED event ("rule no longer fires: contract value added 25 Oct"). Nothing to decide.
- **MEDIUM / HIGH / CRITICAL** findings get `signalClearedAt` and a SIGNAL_CLEARED event, and **stay open** for a person to resolve. A cost problem disappearing (e.g. a contract value raised) is exactly what a director should see.

### 1.3 Who can do what

| Step | Owner (Ilies) | Directors (Nick, Yoel: `directorAccess`) | Managers | Viewers | TIMESHEETS / ACCOUNTS / site links |
|---|---|---|---|---|---|
| See OPERATIONAL findings | yes | yes | yes | yes (read-only) | no |
| See COMMERCIAL findings | yes | yes | yes (same data as Tracking) | **no** | no |
| See DIRECTOR findings / decision log / meeting packs | yes | yes | no | no | no |
| Acknowledge, comment | yes | yes | OPERATIONAL + COMMERCIAL ones they own | no | no |
| Assign owner, create ACTION | yes | yes | no (Managers can action requests assigned to them, as today) | no | no |
| Resolve | yes | yes | ones they own, except CRITICAL | no | no |
| Dismiss | yes | yes | OPERATIONAL INFO only | no | no |
| Verify outcome | yes | yes, not the person who resolved it, for HIGH / CRITICAL | no | no | no |
| Record a DECISION | yes | yes | no | no | no |
| Request an APPROVAL (A3) | yes | yes | yes (OPERATIONAL changes, e.g. move an off-hire date) | no | no |
| **Approve** | yes, **not their own request** | yes, **not their own request** | no | no | no |

**Separation of duties**, enforced on the server and tested:
- `approverId ≠ requestedById`. This applies to the owner too.
- With three people able to approve (Ilies, Nick, Yoel), there's always someone else.
- For HIGH/CRITICAL findings, the verifier ≠ the resolver.
- A system-proposed change counts "System" as the requester. A person must still approve it.

**Append-only:** FindingEvidence, FindingEvent, Decision (content; only status moves forward), DirectorReview, KpiSnapshot (already) and SiteRequestEvent (already). The Finding row itself changes status, but every change is in FindingEvent.

---

## 2. The first stored findings (from signals we already compute)

A **findings run** (`src/lib/insights/findings.ts`, every 30 min from the `instrumentation.ts` tick, plus straight after a day close) turns today's signals into findings.

**No duplicates on repeat runs:**
- **Same problem fires again:** look up by `openKey`.
  - If it's found: update `lastSeenAt` and `seenCount` (no event).
  - If the severity changed: update it and add an ESCALATED or DEESCALATED event plus new evidence.
  - If the value changed materially: add new evidence only.
- **Problem is dismissed:** a `DISMISSED` finding with the same `dedupeKey` and `suppressUntil` in the future suppresses it. Nothing is created unless the severity rises above the dismissed level.
- **Problem is new:** insert with `openKey = dedupeKey`, plus an OPENED event and evidence. If two runs race, the unique key refuses the second insert, so that run updates instead.
- **Open finding not seen this run:** handled as in section 1.2.

| Source today | ruleCode | Subject / dedupeKey | Severity | Audience | Notes |
|---|---|---|---|---|---|
| Tracking `health` (attention list) | `COST_VS_CONTRACT` | `PROJECT:id` | WATCH → MEDIUM, ACT → CRITICAL (escalates in place) | COMMERCIAL | Evidence: forecast, contract, % and the split (locked / estimated / invoiced / still to come) |
| Tracking: hire on hire ≥ 15 working days with no invoice | `HIRE_UNINVOICED` | `RESOURCE:id` | MEDIUM | COMMERCIAL | Today one attention line per item; it stays per item |
| Tracking: hired items not on any job (idle) | `HIRE_IDLE` | `RESOURCE:id` | MEDIUM | COMMERCIAL | Today one grouped line; **split per item** so each can be owned |
| Tracking data gap: active job, no contract value, ≥ $2k spent | `DATA_NO_CONTRACT_VALUE` | `PROJECT:id` | INFO | COMMERCIAL | Auto-resolves |
| Tracking data gap: uncosted allocations | `DATA_UNCOSTED` | `PROJECT:id` | INFO | COMMERCIAL | Value = count. Auto-resolves |
| Tracking data gap: hire with no finish date | `HIRE_NO_FINISH` | `RESOURCE:id` | INFO | OPERATIONAL | Per item (Myers has 3). Auto-resolves |
| Off-hire alerts (`offHireAlert` OVERDUE) | `HIRE_OVERDUE` | `RESOURCE:id` | HIGH | OPERATIONAL | Linked to the hire check (below) |
| Date exceptions (`dateExceptions`) | `DATE_INACTIVE_HAS_JOBS`, `DATE_COMPLETED_HAS_JOBS`, `DATE_NO_START`, `DATE_START_MISMATCH`, `DATE_JOBS_AFTER_COMPLETION`, `DATE_COMPLETION_PASSED`, `DATE_TBC_REVIEW_DUE`, `DATE_JOBS_NO_TIMES` | `PROJECT:id` | MEDIUM (mismatches) / INFO (missing) | OPERATIONAL | Needs a small refactor: `dateExceptions()` returns `{code, text}` instead of bare strings. The Projects page keeps using `.text` unchanged |
| Overview: starts not ready (`upcomingStarts`) | `START_NOT_READY` | `PROJECT:id:startDate` | ≤ 2 days CRITICAL, else HIGH | OPERATIONAL | The start date is in the key, so a moved start is a new problem |
| Overview: crew but no supervisor | `NO_SUPERVISOR` | `PROJECT:id:date` (`JOB:id` for one-off jobs) | ≤ 2 days CRITICAL, else MEDIUM | OPERATIONAL | Auto-resolves once a lead is allocated, or the day passes |
| Overview: days not closed | `DAYS_NOT_CLOSED` | `COMPANY:days` | > 10 HIGH, > 3 MEDIUM (draft) | COMMERCIAL | One company finding. The oldest date is in evidence |
| Overview: plant use under 10% | `DATA_PLANT_NOT_BOOKED` | `COMPANY:plant` | INFO | OPERATIONAL | The 24 Oct finding: plant isn't booked on the board |
| Overview: crew short on a day | `CREW_SHORT` | `COMPANY:date` | MEDIUM | OPERATIONAL | |
| **Hire check** (`HireCheck`) | no new finding for a site-raised request | | | | `HIRE_MISMATCH` / `HIRE_EXTEND` / `OFF_HIRE` are **already work items** with an owner and history. A finding for the same item (e.g. `HIRE_OVERDUE`) **links the request as evidence** and moves to ACTIONED. The hire check's own "no duplicate while one is open" rule stays as it is |
| Site requests past needed-by | not a finding | | | | The request is the work item. The Directors list keeps showing overdue requests straight from requests, so nothing is double-tracked |

**Thresholds stay in one place.** Tracking's own values (`WATCH_AT`, `ACT_AT`, the 15-day uninvoiced rule, the $2k data-gap floor) get exported from `trackingData.ts`. The findings run reads Tracking's per-project fields (`health`, `hireItems`, `uncostedCount`, `hireNoFinish`) rather than parsing attention text, so the attention list and the Tracking page stay exactly as they are.

**Expected volume** (from the 24 Oct copy): about 8 no-contract, about 20 uncosted-by-project, 3–5 hire, 1 days-not-closed, 1 plant-data, and a handful of date findings. That's **about 40–50 open findings at first, mostly INFO**. The Directors page shows CRITICAL/HIGH first and groups INFO by rule, as it does today.

---

## 3. Reusing the site-requests flow, not a second engine

**Management actions = `SiteRequest` rows with kind `ACTION`.** Everything the requests flow already does then works for them unchanged:
- decide / assign (APPROVE onto someone's to-do, MINE);
- ASK and answer;
- DONE with an outcome, and REOPEN;
- reminders and AI reminder suggestions;
- push alerts;
- the full `SiteRequestEvent` history;
- Alex's office-link to-do.

| Flow | How |
|---|---|
| "Create action" on a finding | `insertRequest({kind:"ACTION", origin:"FINDING", findingId, audience: finding.audience, priority from severity, neededBy = due date, requestedBy = the director, project if any})` then the existing APPROVE (assign) step. The finding gets an ACTION_CREATED event and status ACTIONED |
| Action done | The existing PATCH `DONE {outcome}`. A small hook adds an ACTIONED event to the finding with that outcome and prompts "resolve?" |
| A director with no office link | `assigneeUserId` → shows in **Directors → My actions** (a filter of requests). No new queue |
| Supervisors | Never see ACTION requests: they have no `siteLinkId`, and site links only list their own |
| Managers | `GET /api/requests` filters `audience`: COMMERCIAL and OPERATIONAL yes, DIRECTOR no |
| Requests page | A filter: **From site / Actions / All**. One list, one count badge |

**Approvals (LCI phase 4)** use the `Decision` table above, **modelled on the requests flow** (list → decide → history) and sharing its screens' patterns. They aren't a separate engine with its own to-do.

**Executing an approved A3 change:**
1. Re-load the target and re-check that the `from` value still holds.
2. Re-hash `proposedChange` and compare it with `changeHash`.
3. Check it hasn't expired.
4. Apply it through the **same server function the normal API uses** (e.g. the hire register update), so validation and money-guard rules apply.
5. Write `executionResult`.

Anything that doesn't match fails safe, with the reason recorded.

---

## 4. Meeting mode / board pack

`/directors/meeting` (directors only). On-screen, printable, and a PDF with the `@react-pdf/renderer` already in the app. It's built only from stored and computed facts:

| Section | From |
|---|---|
| Snapshot header: period, as at, data confidence | Overview + period chosen (default: since the last `DirectorReview`) |
| What moved since last review | `KpiSnapshot` (full weeks only, never a partial one) vs the last review; findings OPENED / ESCALATED / RESOLVED / VERIFIED in the period (`FindingEvent`) |
| Money position | Cost this period vs last, jobs by health, still to come, labour hire share (last full month). Always says "cost vs contract value, not margin" |
| Project exceptions | Open CRITICAL/HIGH COMMERCIAL findings, worst first, with evidence lines |
| Operations | Starts not ready, crew short days, no-supervisor days, days not closed |
| Plant & hire | Overdue / uninvoiced / idle hire findings. The plant data-gap note if it still applies |
| Safety | Open SAFETY site requests, and the standing "no incident register yet" line |
| People | Hours trend (sign-ins), active crew |
| Upcoming workload | Starting / completing in 30 days |
| **Decisions needed** | Decision `APPROVAL` PENDING, plus findings flagged by a director as "needs a decision" |
| **Overdue actions** | ACTION requests past needed-by, by owner |
| **Decisions made today** | Recorded in the meeting → `Decision` (DECISION), with optional follow-up ACTION requests |

"Close the review" saves a `DirectorReview` with the **frozen pack JSON**, so later anyone can see exactly what the directors were shown and what they decided. The next review's "since last review" starts there.

---

## 5. Migration, impact, risks and tests

**Schema for lead review** (all additive, no existing data changed):
1. `Finding`, `FindingEvidence`, `FindingEvent`, `Decision`, `DirectorReview` (new tables).
2. `SiteRequest`: `origin` default "SITE", `findingId` null, `audience` default "OPERATIONAL", `assigneeUserId` null.
3. `Lesson`: deferred to LCI phase 5.

Order on the server: back up → `db push` on a copy → row counts the same → live.

**Impact on existing code:**
- `dateExceptions()` returns `{code, text}`; its two callers use `.text` (Projects list and page). Small.
- `trackingData.ts` exports its thresholds. The Tracking output must stay byte-identical, re-proven with the Task B before/after capture.
- `GET /api/requests` gets an audience filter; the PATCH `DONE` path gets a finding hook; the Requests page gets a filter; there's a new system request kind `ACTION`. Site links are unchanged.
- The Directors "Needs attention" list switches from computed alerts to stored findings, with the same look plus owner and status.

**Risks:**
| Risk | Mitigation |
|---|---|
| Alert fatigue (about 40–50 findings at start) | INFO grouped and never pushed. Only CRITICAL/HIGH push, and only on open or escalate, not on every run |
| A finding vanishes when data changes | No silent close for MEDIUM+ (signalClearedAt) |
| Duplicates on repeat runs or races | `openKey` unique; tested |
| Commercial detail leaking to Viewers or site links | `audience` on Finding and SiteRequest, filtered on the server, plus `assertNoMoney` on OPERATIONAL text; tested |
| Requests page gets noisy with actions | The From site / Actions filter, with the default view unchanged for Alex |
| An approved change altered or replayed | Fingerprint + expiry + re-check at execution; tested |
| Rule thresholds drift between Tracking and findings | Exported constants, one source |
| SQLite `openKey` NULL semantics | SQLite allows many NULLs in a unique index; covered by a test |

**Tests** (`npm test`, plus checks on a copy):
- **Unit:**
  - dedupe (same signal twice → one finding, no extra events);
  - escalation and de-escalation events;
  - auto-resolve for INFO only;
  - signal-cleared for MEDIUM+;
  - dismissal suppression and escalation override;
  - recurrence within the check period → REOPENED;
  - dateExceptions codes;
  - severity mapping per rule.
- **Approvals:**
  - requester = approver → 403, including the owner;
  - verifier = resolver on HIGH → 403;
  - fingerprint mismatch → refused;
  - expired → refused;
  - re-check failure → FAILED with reason.
- **Access matrix:** Owner / Director / Manager / Viewer / TIMESHEETS / ACCOUNTS / site link × OPERATIONAL / COMMERCIAL / DIRECTOR findings and ACTION requests.
- **Money guard:** every OPERATIONAL finding title and detail passes `assertNoMoney`.
- **Regression:**
  - Tracking JSON byte-identical before and after;
  - the requests flow is unchanged for site-origin requests (existing smoke test);
  - the hire check still creates its own requests and no duplicate finding.
- **On a copy:** a first run creates the expected set; running it twice adds nothing; row counts unchanged in existing tables.

---

## 6. Sizes and build order

| # | Piece | Size | Notes |
|---|---|---|---|
| 1 | Signals: export Tracking thresholds; `dateExceptions` → codes; one `signals()` function producing `{ruleCode, subject, severity, audience, value, evidence}` from existing loaders. Pure, tested | **S** | No schema. Tracking stays byte-identical |
| 2 | Schema (Finding, Evidence, Event) + findings run (dedupe, escalate, auto-resolve, signal-cleared) + tests | **M** | First schema review |
| 3 | Directors "Needs attention" from stored findings (read-only, history visible) | **S** | The page already groups by priority |
| 4 | Lifecycle actions (acknowledge / assign / resolve / dismiss / verify) with the role matrix | **M** | |
| 5 | ACTION requests: SiteRequest columns, create-from-finding, DONE hook, audience filter, Requests filter, My actions | **M** | Touches the requests flow; the lead reviews closely |
| 6 | Decision log (DECISION) + meeting mode page + PDF + DirectorReview freeze | **M–L** | |
| 7 | Approvals A3 (Decision APPROVAL, fingerprint, expiry, execute through existing functions) + A2 reminder list and kill switches | **L** | LCI phase 4; the plan gives phases 0–4 to the lead |

**Suggested order:** 1 → 2 → 3 ships read-only stored findings with their history, with no change to anyone's workflow. Then 4 → 5 (actions through requests) → 6 (meeting mode, ideally before the first monthly directors' meeting) → 7.

Per LCI v2, the lead owns phases 3–4. I'd suggest:
- **lead:** 2 (schema and engine) and 7 (approvals);
- **Director Insights agent:** 1, 3, 4, 6;
- piece 5 by whoever the lead picks, reviewed by the other.

**Open questions for Ilies / the lead:**
1. Do Managers see COMMERCIAL findings? They see the same money on Tracking today. If Ilies wants findings to be directors-only, the default audience becomes DIRECTOR.
2. Check period before outcome verification: 14 days?
3. Should directors without an office link get one (a site link for "My to-do"), or is Directors → My actions enough?
4. Push: CRITICAL to all three approvers, or to the finding owner only?
