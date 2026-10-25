# LCI phase 1: the supervisor's daily site log (design)

*Director Insights agent, 25 Oct 2026, for the lead builder's review. **Design only: no code, no schema change.**
Sources: `docs/lci/LCI-plan-v2.md` (phase 1 row, revised 25 Oct), the Estimating agent's
`demo-civil-estimator/docs/ACTIVITY-CODES-REVIEW.md` (activity codes v0.2, D1–D4 approved by Ilies 25 Oct), and
what Operations already has: supervisor links, crew sign-ins, `JobActual`, Day Review, the findings engine and
site-link push.*

## 0. In one paragraph

Damien and Tom open their existing supervisor link at the end of the day and tap **Daily log**. The crew and
today's signed hours are already there, taken from sign-ins. They split those hours across the activity codes they
worked on, say whether anything held them up, and add any tip dockets with a photo. That takes about 60 seconds.
Once a week, on the same screen, they move a "% complete" slider for each package. Nothing on the link carries a
dollar figure. The office sees it all in Day Review. If a job ran and there's no log by 7pm, the supervisor's phone
gets one reminder (A2, approved by Ilies). Once a job has an approved budget, labour hours by code are compared
with the budgeted hours.

**Why this shape (evidence, review §2 and §6):** sites never measure m². What sites actually record is:
- hours per task;
- tip dockets (t or m³ by waste class);
- visits.

Claims are made as % complete per trade line. So the log asks for exactly those, and never asks for measured
quantities. Measured quantities stay optional, for later.

---

## 1. Where it lives and who uses it

- **On the supervisor link** (`/site/<token>`, kind SUPERVISOR), as a new card, **"Daily log"**. A stand-in lead's
  HANDOVER link can log the one job it covers. The OFFICE and POSTER links can't log.
- **Which jobs:** the open jobs the link's person is allocated to today (`openJobsFor`, as sign-in uses). That means
  today's date, plus last night's night shift until midday. If there's one job, it opens straight away; if there
  are several, they pick one first.
- **Pilot:** Damien and Tom only. A setting holds a list of SiteLink ids, `DAILY_LOG_PILOT`. Everyone else sees no
  card until Ilies widens it. Kill switch: an empty list means no card for anyone.
- **The ~60-second budget:** one screen per step, big tap targets, everything prefilled, and every step skippable
  except the hours split. The time from opening to Submit is recorded (`durationSec`), so the pilot measures the
  60 seconds instead of assuming them.

---

## 2. The screens (phone first)

```
┌ Daily log ─ Swiss Hotel · Tue 27 Oct ┐   Step 1 of 4 ─ Who and how long (read-only, from sign-ins)
│ Crew today (signed in)    6 · 46.5 h │   · Staff 4 (32.0 h), labour hire 2 (14.5 h)
│ Still signed in: Sam (since 6:58)    │   · Anyone still signed in is shown; their hours count up to now
│ Plant on the board: 5t excavator,    │   · Plant from today's board allocations
│   bobcat                             │   [ Looks right → ]   [ Something's wrong ] → note to the office
└──────────────────────────────────────┘

┌ What did the crew do? ── 46.5 h ─────┐   Step 2 of 4 ─ split the crew hours across codes (required)
│ STR-02 Ceilings ........ [ 24.0 h ]  │   · Codes offered first: the job's budget packages (if approved),
│ STR-03 Partitions ...... [ 14.5 h ]  │     then codes logged on this job before, then "+ another code" (search)
│ DEM-10 Waste load-out .. [  8.0 h ]  │   · Tapping a code gives it the hours left; − / + in 0.5 h steps;
│ Left to place: 0.0 h ✓               │     "Split evenly" button. Must add up (± 0.5 h) before Next
│ Plant: 5t excavator → STR-03 (8 h)   │   · Plant: each machine gets one code (defaults to the biggest code)
│        bobcat → DEM-10 (6 h)         │     and its hours (default: the shift length from the board)
└──────────────────────────────────────┘

┌ Anything hold you up? ───────────────┐   Step 3 of 4 ─ delays (one tap for "No")
│ [ No ]  Weather  Access  Client      │   · Code + about how many hours lost + who was affected (crew/plant)
│ Plant breakdown  Waiting on others   │   · Note (optional), photos (optional, up to 4)
│ Other                                │   · Several delays allowed
└──────────────────────────────────────┘

┌ Tip dockets today ───────────────────┐   Step 4 of 4 ─ dockets (one tap for "None")
│ + Add a docket                       │   · Waste class (from codes v0.2): GSW · VENM/ENM · Asbestos (ACM) ·
│   Mixed C&D · 6.2 t · #A12345 📷     │     Mixed C&D · Clean heavy · Metal · Recyclable
│   Clean heavy · 3 m³ · 📷            │   · Amount + unit: t | m³ | loads | bins; docket number (optional)
│ [ None today ]                       │   · Photo of the docket (strongly asked for; required for ACM)
└──────────────────────────────────────┘

┌ Done? ───────────────────────────────┐   Review ─ a note and photos of the day (optional), then Submit
│ Note for the office (optional)       │   · "Logged 4:52pm ✓". The card turns green for today
│ 📷 Add photos of the day             │   · Re-open the same day to correct: that saves a new version;
│ [ Submit ]                           │     earlier versions are kept
└──────────────────────────────────────┘
```

**Weekly % complete** (the same card shows "This week's progress"). It's asked on Fridays, or on the first log of the
next week if Friday was missed:

```
┌ Progress this week ─ Swiss Hotel ────┐   · One slider per budget package (approved budget.v1 for the job);
│ Level 2 soft strip (STR-01)  [ 60% ] │     without a budget, one per activity code logged on the job so far
│ Ceilings (STR-02)            [ 35% ] │   · 0–100 in 5% steps, prefilled with last week's value
│ Waste load-out (DEM-10)      [ 40% ] │   · Going down needs a reason (e.g. rework, scope change)
│ [ Save progress ]                    │   · Package names and codes only - never budget hours or money
└──────────────────────────────────────┘
```

**Home card states:** "Daily log - not done today" (amber), "Logged 4:52pm ✓" (green), "Progress due this week" (a
badge on Fridays).

---

## 3. Activity codes: where the list comes from

There are three options:
- **(a)** call Estimating's `api/state`;
- **(b)** a pinned copy in Operations;
- **(c)** a new small Estimating endpoint.

**Recommendation: (b) now, then (c).**
- **Not (a).** `api/state` also returns the estimates and the rate library. Even read only on the server, Operations
  shouldn't pull supplier rates just to get a code list.
- **(b)** `src/lib/activityCodes.ts`: the v0.2 list as data, holding code, group, name, units, siteReport and
  attrs.wasteClass, plus `VERSION = "activity-codes.v0.2"`. It's a mechanical copy of Estimating's
  `lib/activity-codes.js` and carries no prices. A test pins the code count (61) and the waste classes, so a
  change is deliberate.
- **(c)** Ask the Estimating agent for `GET api/activity-codes` (an `activity-codes.v1` contract: the same fields,
  no rates). Operations then checks its pinned VERSION against it nightly; if they differ, it logs a warning and
  shows a note on the Day Review site-log panel.
- **Codes are stable:** never renamed or reused (review §3). So a log stays readable even after the list moves on.
  Each log stores the codes VERSION it used.

---

## 4. Schema proposal (additive; for the lead's OK)

The log itself is **append-only by revision**:
- A correction saves a new revision; nothing is edited or deleted.
- "The log" means the latest revision for the job.
- Child rows belong to one revision.

```prisma
// One supervisor's daily log for one job (a project's work on one date/shift). Append-only:
// a correction is a new revision; the latest revision is the log.
model DailyLog {
  id            String   @id @default(cuid())
  jobId         String
  job           Job      @relation(fields: [jobId], references: [id], onDelete: Restrict)
  projectId     String?
  date          String   // YYYY-MM-DD - the job's date (as sign-ins; a night shift keeps its start date)
  revision      Int      // 1, 2, 3 ... per job
  siteLinkId    String   // the link used (SUPERVISOR or HANDOVER)
  submittedBy   String   // the person's name on the link
  codesVersion  String   // "activity-codes.v0.2"
  crewCount     Int      // snapshot at submit, from sign-ins
  labourHours   Float    // snapshot at submit: signed hours (staff + hire), less unpaid breaks
  splitHours    Float    // total placed on codes (must be within 0.5 h of labourHours)
  crewOk        Boolean  @default(true) // false = "something's wrong" with the crew list
  crewNote      String?
  note          String?
  photoIds      String   @default("[]") // JSON array of stored photo names (savePhoto, TOOL_PHOTO_DIR - backed up)
  noDelays      Boolean  @default(false)
  noDockets     Boolean  @default(false)
  durationSec   Int?     // open -> submit, to measure the 60-second target
  createdAt     DateTime @default(now())
  hours         DailyLogHours[]
  delays        DailyLogDelay[]
  dockets       TipDocket[]
  @@unique([jobId, revision])
  @@index([date])
  @@index([projectId, date])
}

model DailyLogHours {
  id         String   @id @default(cuid())
  logId      String
  log        DailyLog @relation(fields: [logId], references: [id], onDelete: Restrict)
  code       String   // activity code, e.g. "STR-02"
  kind       String   // LABOUR | PLANT | TRUCK
  resourceId String?  // PLANT / TRUCK: the machine from the board (none for LABOUR - the crew is a total)
  hours      Float
  @@index([logId])
  @@index([code])
}

model DailyLogDelay {
  id         String   @id @default(cuid())
  logId      String
  log        DailyLog @relation(fields: [logId], references: [id], onDelete: Restrict)
  delayCode  String   // WEATHER | ACCESS | CLIENT | PLANT_BREAKDOWN | WAITING_ON_OTHERS | OTHER
  hoursLost  Float?   // about how long
  affects    String   @default("CREW") // CREW | PLANT | BOTH
  note       String?
  photoIds   String   @default("[]")
  @@index([logId])
}

model TipDocket {
  id         String   @id @default(cuid())
  logId      String
  log        DailyLog @relation(fields: [logId], references: [id], onDelete: Restrict)
  code       String   @default("DEM-10") // DEM-10 waste load-out, or CIV-02 spoil export
  wasteClass String   // from codes v0.2 attrs.wasteClass
  quantity   Float
  unit       String   // t | m3 | loads | bins
  docketNo   String?
  facility   String?  // tip / recycler, if written on the docket
  photoId    String?  // the docket photo (required for Asbestos (ACM))
  @@index([logId])
  @@index([wasteClass])
}

// Weekly % complete per package (or per code before a budget exists). Append-only.
model WeeklyProgress {
  id          String   @id @default(cuid())
  projectId   String
  weekStart   String   // Monday, YYYY-MM-DD
  revision    Int
  siteLinkId  String
  submittedBy String
  basis       String   // BUDGET (lines are budget packages) | CODES (no approved budget yet)
  budgetRef   String?  // "<estimateId>/r<revision>" of the approved budget.v1 used
  createdAt   DateTime @default(now())
  lines       WeeklyProgressLine[]
  @@unique([projectId, weekStart, revision])
}

model WeeklyProgressLine {
  id          String         @id @default(cuid())
  progressId  String
  progress    WeeklyProgress @relation(fields: [progressId], references: [id], onDelete: Restrict)
  packageId   String?        // budget.v1 package_id (BUDGET basis)
  code        String         // activity code
  label       String         // package name or code name, as shown
  pctComplete Int            // 0-100
  reason      String?        // required when lower than last week
  @@index([progressId])
}
```

- **No new table for reminders:** the 7pm reminder reuses `ShiftReminder` with kind `DAILY_LOG`, which is already
  unique per job and kind.
- **No new photo store:** photos go through `savePhoto()`, the same as site requests, which is in the nightly backup.
- **Deploy:** `db push` adds 7 empty tables, with no change to existing ones.

---

## 5. Reusing what's there: sign-ins, JobActual, the board

- **Crew and hours come from sign-ins:**
  - `signInHoursForJobs([jobId])` (lib/attendanceView), the same numbers Day Review and timesheets use: signed time
    less the project's unpaid break, with staff and labour hire both counted.
  - The log **doesn't re-enter hours**; it **splits** them.
  - If sign-ins are corrected later (the office edits a time), the log's snapshot stays as it was, and Day Review
    shows "split 46.5 h, signed now 48.0 h". There's no silent rewrite.
- **JobActual stays the per-person record** of Day Review hours, filled from sign-ins as today. The log adds the
  per-code split on top and touches nothing in JobActual.
- **Plant** comes from today's board allocations (Assignments of EQUIPMENT / ATTACHMENT / VEHICLE / HIRE, not labour
  hire). The default hours are the job's shift length (effective times), and the supervisor can change them.
  Allocations themselves are never changed.
- **If no one signed in** (e.g. a sign-in day missed): step 1 says so and offers "enter crew hours by hand"
  (crewOk = false, a total only, flagged in Day Review). This keeps the log possible without inventing hours.
- **Costs are untouched:** job costs still come from allocations and job times (as CLAUDE.md says of JobActual).
  The log is a production record, not a cost source.

---

## 6. How Day Review shows it

Each job card gets a **"Site log"** panel (read-only for the office; Manager+ as Day Review is today):
- **header:** "Logged by Damien 4:52pm (v2)", or a red **"No log"** badge once it's past 7pm;
- **hours by code:** a small bar per code (labour, plus plant per machine), the total vs signed hours, and a warning
  if they differ by more than 0.5 h;
- **delays:** code, hours lost, note and photo thumbnails;
- **dockets:** waste class, amount and unit, docket number and photo; **ACM dockets highlighted**;
- **this week's progress**, if submitted, with last week's value beside it;
- **"Earlier versions"**, collapsed;
- **no money:** the panel's data type has no money fields, and `assertNoMoney` applies to the link responses.

**Day Review's close-the-day check** gets one more line: "2 jobs have no site log". This is information only. The
pilot shouldn't block closing a day.

---

## 7. Missing logs and log problems: Day Review and the reminder only

*Revised 25 Oct 2026: Ilies removed the Operations Attention tab (main bf47b2f). Operational findings are still
stored but not listed, and they don't push alerts. So the daily log adds **no new list and no new findings**.
Missing logs and log problems show in exactly two places: **Day Review** and **the supervisor's own reminder**.*

| What | Where it shows | Rule |
|---|---|---|
| **Missing log** | Day Review: a red "No site log" badge on the job card once it's past 19:00, plus the close-the-day line "2 jobs have no site log" (information only during the pilot). **The supervisor:** the 19:00 reminder below | A pilot supervisor's job ran that day (sign-ins, or crew on the board) and there's no log. Worked out when Day Review loads, so nothing is stored or listed. It clears as soon as the log arrives |
| **Split no longer matches sign-ins** | Day Review site-log panel: "split 46.5 h, signed now 48.0 h", amber | Signed hours changed by more than 0.5 h after the latest log revision. Clears when the supervisor re-logs (a new revision) or the office accepts it as is |
| **Crew entered by hand / "something's wrong"** | Day Review site-log panel: a grey "entered by hand" tag, and the supervisor's note | From the log itself (crewOk = false) |
| **Labour hours vs budget** (once a job has an approved budget.v1) | **Not a list item.** A small "hours vs budget" table per code on the Day Review job card (week to date) and on the job's Tracking page / Directors job page. Each code is marked Ahead / On track / Watch / Act | Hours used % (logged labour ÷ budget labour_hrs for the package) minus the latest weekly % complete: more than 15 points = Watch, more than 30 = Act (draft). Needs at least 2 logs and one weekly %. Whether it should *also* be a Directors finding is a decision for Ilies (§11) |

Nothing here goes through the findings engine. These are plain read-time checks (`src/lib/dailyLog/checks.ts`,
unit-tested), the same way Day Review already flags uncosted lines.

**The A2 reminder** (Ilies approved automatic internal reminders, on an approved list, with rate limits and a kill
switch):
- **What:** at 19:00 Sydney (night shifts: 2 hours after their finish), if a pilot job has no log, one push goes to
  the job's supervisor link(s): **"No daily log for Swiss Hotel yet - 60 seconds: tap to log."** This uses
  `pushToSiteLinks`, the same as the sign-out reminder.
- **Rate limits:** at most one reminder per job per day (`ShiftReminder` kind `DAILY_LOG`), and none after 21:00
  (the next morning's 7:00 brief carries it instead).
- **Kill switch:** `A2_RULES.DAILY_LOG_REMINDER.enabled` in config (off = no pushes; Day Review still shows the badge).
- **Approved list:** `A2_RULES` lists only this rule. A new reminder type is a code change with Ilies's OK.

---

## 8. Link API (all under the existing token check; money-free)

| Route | Does |
|---|---|
| `GET /api/site/:token/log` | Today's loggable jobs, plus for each: prefill (crew, signed hours, plant, last codes, budget packages by name and code), today's latest log, whether weekly progress is due |
| `POST /api/site/:token/log` | Submit a log revision: `{jobId, hours[], plant[], delays[], dockets[], note, photos[], noDelays, noDockets, crewOk, crewNote, durationSec}`. Checked: the job is the link's; the split is within 0.5 h; codes are in the pinned list; waste classes are valid; ACM has a photo; not a closed day |
| `POST /api/site/:token/progress` | Weekly % complete for a project: `{projectId, lines[{packageId?, code, pct, reason?}]}`; a drop needs a reason |
| `GET /api/day-review` (extend) | Adds the job's latest log, earlier revisions and progress; Manager+ as today |

Photos are uploaded as data URLs, shrunk in the browser (as site requests do), up to 4 per log and 1 per docket.

---

## 9. Tests

- **Unit (`npm test`):**
  - the split rule (± 0.5 h);
  - code and waste-class validation against the pinned list (61 codes, 7 classes);
  - ACM needs a photo;
  - a progress drop needs a reason;
  - revision numbering;
  - the missing-log rule and the reminder timing (19:00, night shifts, none after 21:00);
  - the hours-vs-budget maths and thresholds;
  - the split-mismatch check;
  - that the daily log adds no findings kinds (the engine's signal list is unchanged).
- **Money guard:** every link response from `log` and `progress` passes `assertNoMoney`, and the link DTO types have
  no money fields. Budget hours and costs never reach the link; only package names and codes do.
- **Role / link matrix:**
  - a SUPERVISOR link logs only its own jobs; a HANDOVER link logs only its one job;
  - OFFICE and POSTER links can't log;
  - a revoked link gets 404;
  - a link outside the pilot sees no card and gets 404 on the routes.
- **No data change:** sign-ins, JobActual, allocations, costs and closed days are unchanged by a log (a fingerprint,
  as in the director's-day check). Tracking, requests and links are byte-identical apart from the new card.
- **The reminder:** exactly one push per job per day, with the kill switch honoured. Push keys are blank on the test
  copy, so nothing really sends.
- **A copy run:** a script submits a week of logs for a pilot job, with dockets, a delay, a correction (v2) and a
  weekly %. Day Review shows it: the "No site log" badge appears after 19:00 and clears when the log arrives.

---

## 10. Sizes and build order

| # | Piece | Size | Depends on |
|---|---|---|---|
| 1 | Pinned codes v0.2 (`activityCodes.ts`) + the 7 tables + validation rules + unit tests | S–M | Lead OKs the schema |
| 2 | Link: Daily log card, steps 1–4, submit, corrections (revisions), photos | M–L | 1 |
| 3 | Day Review "Site log" panel + the close-the-day line | S–M | 1 |
| 4 | 19:00 A2 reminder + the Day Review checks (missing log, split mismatch, entered by hand) | S | 1, 2 |
| 5 | Weekly % complete (codes basis first) | M | 2 |
| 6 | Budget packages on the link and in the weekly %; the hours-vs-budget table (Day Review + job page) | M | An approved budget.v1 for the pilot job (Task H is live); the lead's LCI phase 2 import when it lands |
| 7 | Pilot report: completeness (logs ÷ jobs run, per supervisor per day), median time to log, codes used, dockets per job | S | 2 weeks of pilot data |
| 8 | (Later) Estimating `GET api/activity-codes` + nightly version check | S (Estimating agent) | - |

The phase-1 exit test from the plan is **"pilot supervisors log 2 weeks; completeness measured"**. That is pieces
1–5 plus 7. Piece 6 can follow once the pilot job has an approved budget.

---

## 11. Decisions for the lead / Ilies

1. **Schema (§4):** the 7 additive tables, append-only by revision. OK?
2. **Codes source (§3):** a pinned copy now, then an Estimating endpoint. OK, or wait for the endpoint?
3. **Labour hours vs budget:** shown on the Day Review job card and the job page only (proposed). Should a job at
   "Act" *also* appear on the Directors "Needs attention" box? That would be a director-level finding kind and a
   one-line `DIRECTOR_KINDS` addition.
4. **Thresholds:** 15 / 30 points over % complete, and 19:00 for the reminder. These are drafts, marked draft.
5. **Closing a day without a log:** information only during the pilot (proposed), or should it block?
6. **Pilot jobs:** which of Damien's and Tom's jobs. Ideally one with an approved budget.v1 soon, so piece 6 can be
   tested on real data.
