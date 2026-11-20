// Office batch upload of tip dockets (20 Nov 2026, Ilies: "we may upload a batch like from whats app but never will we
// need to upload an individual receipts") - the plain rules, no database. Store: ./batch.ts. Each photo becomes a TIP
// Receipt read like a phone-sent one (./runner.ts, ./checks.ts).

export const BATCH_LIMITS = {
  photosPerBatch: 100, // one batch = one project's export; more is a second batch
  photosPerUserPerDay: 300, // one login, 24 hours (a phone link: 60 photos) - Draft
  batchOpenHours: 24, // photos are added to a batch the same session; after a day start a new one
  // DB-004: one photo at most 3.5 MB - the browser shrinks anything bigger first (a docket reads fine at 2400 px).
  photoMaxBytes: Math.round(3.5 * 1024 * 1024),
};
// The most a request carrying one photo can be: base64 is 4/3 the bytes, plus the JSON around it.
export const BATCH_BODY_MAX = Math.ceil((BATCH_LIMITS.photoMaxBytes * 4) / 3) + 8192;

// The marker in Receipt.siteLinkId for an office batch: never a SiteLink id (those are cuids), so resolveLink /
// resolveReceiptLink - which look links up by their secret - can never land on it.
export const batchLinkMarker = (batchId: string) => `office-batch:${batchId}`;

// ---------- which job a docket goes on ----------
// The office picks the project; each docket's job comes from the date read off it:
//   - the project's jobs (not cancelled) on the docket's Sydney day, plus last night's NIGHT job when the docket's
//     time is before 12 noon (a night shift runs past midnight and counts to its start day);
//   - exactly one -> that job;
//   - none -> on the project with no job ("<site> · not on that day", as a phone docket for a site not running);
//   - more than one -> on the project with no job, and To check: "pick the job";
//   - no date read -> on the project with no job (the reading already says the date is missing).
export type JobForMapping = { id: string; day: string; shift: string }; // day = YYYY-MM-DD (the board's date)
export type JobPick = { jobId: string | null; note: string | null };

const prevDay = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

export function jobForDocket(jobs: JobForMapping[], docket: { day: string | null; time: string | null }): JobPick {
  if (!docket.day) return { jobId: null, note: null };
  const morning = !!docket.time && docket.time < "12:00";
  const hits = jobs.filter((j) => j.day === docket.day || (morning && j.shift === "NIGHT" && j.day === prevDay(docket.day!)));
  if (hits.length === 1) return { jobId: hits[0].id, note: null };
  if (hits.length === 0) return { jobId: null, note: null };
  return { jobId: null, note: `${hits.length} jobs on this project that day - pick the job` };
}

// ---------- caps ----------
export function capProblem(n: { inBatch: number; userToday: number }): string | null {
  if (n.inBatch >= BATCH_LIMITS.photosPerBatch) return `A batch holds at most ${BATCH_LIMITS.photosPerBatch} photos - start another batch for the rest.`;
  if (n.userToday >= BATCH_LIMITS.photosPerUserPerDay) return `That's the most photos one login can upload in a day (${BATCH_LIMITS.photosPerUserPerDay}) - carry on tomorrow.`;
  return null;
}

// ---------- the same photo twice ----------
// A photo whose bytes match one already in (same SHA-256) on a receipt that isn't set aside is refused - it would be the
// same docket twice. One that was set aside may come in again (it was set aside, perhaps by mistake).
export function samePhotoProblem(earlier: { receiptStatus: string | null; sentBy: string; at: Date } | null): string | null {
  if (!earlier || earlier.receiptStatus === "REJECTED") return null;
  return `This photo is already in (sent by ${earlier.sentBy} on ${earlier.at.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}) - skipped.`;
}

// A file name from the browser, for messages only (never stored, never a path).
export const shownName = (v: unknown) => (typeof v === "string" ? v.replace(/[^\w .()-]/g, "").trim().slice(0, 80) : "");
