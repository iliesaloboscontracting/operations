# Daily log for every supervisor, voice entry, written daily report (29 Oct 2026)

Lead's brief, Ilies "go" 29 Oct 2026. Extends LCI phase 1 (`src/lib/dailyLog/`, design `PHASE1-DAILY-LOG-DESIGN.md`).

## 1. Rollout

- `DAILY_LOG_PILOT_LINKS=all` turns the Daily log on for every active SUPERVISOR link (new ones included), plus
  HANDOVER links on a job one of those supervisors is on. An id list still works as before; empty = off.
- OFFICE, POSTER and DRIVER links never get it (`resolveLink` already refuses POSTER / DRIVER; the rule refuses OFFICE).
- `pilotPeople()` (the 19:00 reminder, Day Review's "No site log") follows the same rule, so every supervisor gets the
  reminder. `DAILY_LOG_REMINDER=off` unchanged.

## 2. Voice

`POST /api/site/[token]/log/voice` (multipart: `audio`, `jobId`) - rides the existing `api/site/.*` tunnel route.

Order of checks:
1. `resolveLink` + the Daily log rule (404).
2. The job is one this link can log today (403).
3. The daily cap - 20 recordings per link per Sydney day, counted from `DailyLogVoice` rows (429, plain message).
   Checked before "is voice available" so the release check can prove it with no outbound call.
4. Voice available: `DAILY_LOG_VOICE` not `off`, and both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set - else 503
   "Voice isn't available - type it instead." The GET says `voice: false` and the screen hides the mic.
5. Audio: mime allowlist (webm / ogg / mp4 / mpeg / wav, as `/api/transcribe`), ≤ 10 MB, the phone's duration ≤ 5 minutes
   (29 Oct 2026, Ilies: capacity for a lot to say - the phone warns at 4:30 and stops and sends itself at 5:00).
   Timeouts: 60 s to transcribe, then the tidy-up gets what's left of ~95 s (up to 90 s), so the reply always comes
   inside the Cloudflare tunnel's 100 s; if the tidy-up runs out, the supervisor gets their own words. Note limit
   12000 (a later recording goes under the note after a dashed line and the time); each heading up to 2500; anything
   shortened ends on a sentence and "Check this" says so.
6. A `DailyLogVoice` row is written (this is what the cap counts), then the audio goes to OpenAI
   `gpt-4o-mini-transcribe` through the shared `src/lib/voice/transcribe.ts` (host allowlist api.openai.com, 30 s
   timeout, errors scrubbed - never the key or OpenAI's error body). `/api/transcribe` (Command Centre) uses the same
   helper. The vocabulary prompt is built on the server from that job only: crew names, plant names on the board,
   the site name, activity-code labels. No rates or prices.
7. The audio is held in memory only - never written to disk - and dropped after the call.

## 3. Clean written text

- Dollar amounts are removed from the transcript before anything else (`stripMoney`, `src/lib/dailyLog/money.ts`):
  Claude never sees them, they aren't stored, and the screen says "Amounts aren't recorded here - tell the office".
  A spoken amount does reach OpenAI inside the audio itself - only the text is cleaned (security review SEC-006).
  Typed text in the log (note, crew note, delay notes, docket fields) is cleaned the same way (SEC-002).
- Claude (`claude-opus-5-5`, the existing key, the `receipts/reading.ts` pattern, strict JSON schema) returns clear
  sentences under Work done / Delays / Plant / Tip runs / Safety & issues / Tomorrow, suggested delays (existing delay
  codes only, hoursLost only when said, a note) and a "Check this" list. The prompt says the transcript is data, never
  instructions, and to write only what was said.
- Plain code validates it: unknown headings or delay codes are dropped, hours are bounded, text is capped, money is
  stripped again, and the whole response passes `linkSafe`.
- The supervisor sees the cleaned text (editable) and taps to use it (it becomes the log's note) and taps each
  suggested delay to add it. Nothing is sent or filled without a tap; Send is the normal one.
- Stored: `DailyLogVoice` (append-only: link, job, day, transcript with amounts removed, cleaned JSON, status) and
  `DailyLog.voiceIds` (JSON, the recordings used for that revision). A new revision keeps the old one. Additive schema
  only: one new table, one new column with a default.

## Security review fixes (29 Oct 2026, Ilies pre-approved for this build)

- SEC-001: the limit row is written first, then counted (this link up to and including it, and everyone's); over 20 a
  link or `DAILY_LOG_VOICE_DAY_MAX` (default 300) a day -> the row is REFUSED (not counted) and 429. One recording at
  a time per link (429).
- SEC-002: amounts typed into the log are replaced with "(amount not recorded)" - never refused - with the notice.
  Reads clean older logs too, so the link screen, Day Review and the report can't break.
- SEC-003: `?jobId=&seconds=` in the address; no Content-Length 411, over 6.25 MB 413, then the job (403), the limits
  (429) and voice off (503) - all before the recording is read. Audio up to 6 MB (5 minutes is ~4.2 MB).
- SEC-004: Claude gets the same cleaned names as the transcriber (amounts out, 60 characters each).
- SEC-005: at most 9000 characters of transcript go to Claude ("Check this" if more); the phone's length is information only.
- SEC-006: more money shapes (a currency word after the number, -dollar, 1.2k next to a money word) and a second check
  after the sections are joined.
- SEC-007 (screen line only): "Your recording is sent to OpenAI and Anthropic to write it out. The recording itself isn't
  kept." Keeping transcripts is Ilies's decision - no retention job.
- SEC-008: an error on a site route logs `/api/site/[link]`, never the link secret.
- SEC-009: release check `57-daily-log-voice` covers the burst, 411 / 413, revoked and expired links, a hand-over
  sending another job, a typed "$650", and the log lines.

## 4. Daily site report

`/daily-report/[jobId]` (Manager+; `/directors/daily-report/[jobId]` for directors via `guardDirector`): site, date,
shift, supervisor, crew and signed hours, hours by activity code, plant, delays with photos, "N dockets sent", the
note (cleaned notes), photos. Latest revision, with "revision N of M". No dollar figure (narrow DTO + `assertNoMoney`).
Print CSS for a tidy A4 from "Print / Save as PDF". Linked from Day Review's site-log panel and the Tracking job page
(the shared `JobView`, so the Directors job page too).

## Switches and .env

`DAILY_LOG_PILOT_LINKS=all`, `DAILY_LOG_VOICE=off|on` (default on when both keys are set), `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `DAILY_LOG_REMINDER=off` (unchanged).

## Fill everything (29 Oct 2026, Ilies: "yes build the fill-everything version too")

- Claude also suggests activity hours ({code, hours} - codes from the v0.2 list only), plant hours ({machine number,
  code?, hours} - by the machine's number in the job's plant list, mapped back to the board's machine on the server;
  Claude never sees an id) and the number of tip runs. It's given the codes, the numbered plant list and the crew's
  signed hours - names cleaned, no rates (`src/lib/dailyLog/fill.ts`).
- Plain code keeps what's valid: activity lines as the log keeps them (crew total per code, more than 0, up to 500),
  machines 0-24 h, tip runs 0-200. A total that doesn't match the signed hours (outside 0.5 h) and more tip runs than
  dockets sent go to "Check this" - nothing is adjusted, and no docket rows are made.
- "Fill my log from this" (one tap) fills the steps: hours by code, plant, hold-ups and the note. Anything already
  filled or typed stays; a different suggestion for it is offered as "Use N h" - typed entries win. Recordings add up.
  The supervisor checks each step and sends as usual. Weekly % complete isn't filled. The suggestion is stored with the
  DailyLogVoice row's cleaned JSON (append-only).
