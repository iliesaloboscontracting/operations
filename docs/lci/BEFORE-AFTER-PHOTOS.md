# Before and after site photos on the daily log

30 Oct 2026. Ilies: "with the site logs we want the guys to also upload site photos before and after". Branch
`log-before-after`.

## What he chose

- **Timing.** "Before photos" first thing, on any job the link can log today: on the job list, and at the top of the
  log's first step. "After photos" when the job is done: on the job list, and on the log's send step. Each photo is
  saved the moment it's sent, without waiting for the log, so a Before photo is safe even if the log is never sent.
- **Expected, not blocking.** The log can always be sent without them.
  - A missing set shows "No before photos" / "No after photos" on the link's log, on Day Review (the card and the top
    summary) and in the daily report. Information only.
  - "No after photos" waits until the log is in or it's past the log's due time (19:00, or after a night shift).
- **6 a set.** Up to 6 Before and up to 6 After per job per day. Day Review, the daily site report and the directors'
  copy show them side by side, each with its time and who sent it.

## How it works

- **Table.** `SiteLogPhoto`, additive and append-only: jobId, day, phase BEFORE | AFTER, fileName, siteLinkId,
  takenBy, createdAt, hiddenAt / hiddenBy / hiddenLinkId.
  - "Remove" hides a photo; nothing is deleted. A hidden photo frees its place.
  - At most 20 rows a set in all, so add-remove-add can't go on for ever.
- **Files.** `savePhoto` (lib/toolPhotos.ts), the same as the daily log's other photos:
  - JPEG / PNG / WebP, 6 MB max, random name, `safePath` on read;
  - stored in `TOOL_PHOTO_DIR`, which is in the nightly server backup (tool-photos tar) and the off-site copy
    (scripts/backup-cloud.ps1).
- **Link.** `POST /api/site/[token]/log/photos`:
  - `{ jobId, phase, photo }` saves a photo; `{ hide: id }` removes one.
  - `GET ?id=` returns a photo for the link's own screen.
  - Only for a job the link can log today (`loggableJobs`, the voice route's check); 403 for any other job.
  - 409 once the set has 6, or once the office has closed the day.
  - One upload at a time per job and set on the server.
  - Not on the daily log (office, poster, driver links): 404.
  - Replies are names and times only (`linkSafe`).
- **Phone.**
  - Big "Take photo" (camera) and "Gallery" buttons; each photo is shrunk in the browser first (lib/imageResize.ts).
  - A progress bar while it sends.
  - A photo that didn't get through waits with Retry, and goes again by itself when the phone is back online.
- **Office.**
  - Day Review's site-logs DTO carries the sets and flags for Managers and Admins only; a Viewer's reply has neither.
  - Photos come from `/api/day-review/site-logs/before-after?job=&id=` (Manager+).
  - The daily site report has a "Before and after" section.
  - The directors' copy uses `/api/directors/daily-report/before-after` (guardDirector).
  - Both routes serve only a shown photo of that job.
- **Reminder.** It is still the one 19:00 reminder per job (ShiftReminder DAILY_LOG); there is no new kind.
  - It now also goes when the log is in but a set is missing, and says which: "No after photos for X yet - tap to add
    them."
  - With no log it says "No daily log for X yet (and no before photos) - ...".
- **Not touched.**
  - The log's "photos of the day" (4) and the delay photos.
  - No AI reading, no outside call, no money anywhere.
- **Checks.** Unit tests in `src/lib/dailyLog/beforeAfter.test.ts`; release check `59-before-after`.
