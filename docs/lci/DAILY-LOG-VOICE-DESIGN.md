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
5. Audio: mime allowlist (webm / ogg / mp4 / mpeg / wav, as `/api/transcribe`), ≤ 5 MB, the phone's duration ≤ 120 s.
6. A `DailyLogVoice` row is written (this is what the cap counts), then the audio goes to OpenAI
   `gpt-4o-mini-transcribe` through the shared `src/lib/voice/transcribe.ts` (host allowlist api.openai.com, 30 s
   timeout, errors scrubbed - never the key or OpenAI's error body). `/api/transcribe` (Command Centre) uses the same
   helper. The vocabulary prompt is built on the server from that job only: crew names, plant names on the board,
   the site name, activity-code labels. No rates or prices.
7. The audio is held in memory only - never written to disk - and dropped after the call.

## 3. Clean written text

- Dollar amounts are removed from the transcript before anything else (`stripMoney`): Claude never sees them, they
  aren't stored, and the screen says "Amounts aren't recorded here - tell the office".
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

## 4. Daily site report

`/daily-report/[jobId]` (Manager+; `/directors/daily-report/[jobId]` for directors via `guardDirector`): site, date,
shift, supervisor, crew and signed hours, hours by activity code, plant, delays with photos, "N dockets sent", the
note (cleaned notes), photos. Latest revision, with "revision N of M". No dollar figure (narrow DTO + `assertNoMoney`).
Print CSS for a tidy A4 from "Print / Save as PDF". Linked from Day Review's site-log panel and the Tracking job page
(the shared `JobView`, so the Directors job page too).

## Switches and .env

`DAILY_LOG_PILOT_LINKS=all`, `DAILY_LOG_VOICE=off|on` (default on when both keys are set), `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `DAILY_LOG_REMINDER=off` (unchanged).
