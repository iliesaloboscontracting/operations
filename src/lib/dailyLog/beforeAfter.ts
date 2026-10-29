// Before and after site photos on the daily log (30 Oct 2026, Ilies: "with the site logs we want the guys to also
// upload site photos before and after"). Pure rules - the 6-a-set limit, the "No before / after photos" flags and the
// reminder's wording. Expected, never blocking: the log can always be sent without them. `npm test`.
export const PHASES = ["BEFORE", "AFTER"] as const;
export type Phase = (typeof PHASES)[number];

// Up to 6 shown per job per day for each set. A removed photo is hidden (never deleted) and frees its place; at most
// 20 rows a set in all, so add-remove-add can't go on for ever.
export const BEFORE_AFTER_LIMITS = { perPhase: 6, rowsPerPhase: 20 } as const;

export const parsePhase = (x: unknown): Phase | null => (PHASES as readonly unknown[]).includes(x) ? (x as Phase) : null;
export const PHASE_LABEL: Record<Phase, string> = { BEFORE: "Before", AFTER: "After" };

// Why another photo can't go in this set, or null when it can. shown: photos in the set now; rows: every one ever sent.
export function addRefusal(shown: number, rows: number): string | null {
  if (shown >= BEFORE_AFTER_LIMITS.perPhase) return `That's ${BEFORE_AFTER_LIMITS.perPhase} photos already - remove one to add another.`;
  if (rows >= BEFORE_AFTER_LIMITS.rowsPerPhase) return "That's the most photos for this job today - call the office.";
  return null;
}

// The missing-set flags. "No before photos" once the job ran with none; "No after photos" only once the log is in or
// it's past the log's due time (19:00, or after a night shift) - not at 7am. Information only, never a block.
export function photoFlags(x: { ran: boolean; before: number; after: number; hasLog: boolean; pastDue: boolean }) {
  return { noBefore: x.ran && x.before === 0, noAfter: x.ran && x.after === 0 && (x.hasLog || x.pastDue) };
}

// THE SWITCH (Ilies to choose, 30 Oct 2026): true = the reminder also goes when the log is in but a photo set is
// missing; false = photos are only mentioned in the "no daily log" reminder (no push once the log is in).
export const REMIND_PHOTOS_WITH_LOG_IN = true;

// The one 19:00 reminder per job (ShiftReminder DAILY_LOG): what it says, or null when nothing is missing.
export function reminderText(site: string, m: { noLog: boolean; noBefore: boolean; noAfter: boolean }, withLogIn = REMIND_PHOTOS_WITH_LOG_IN): string | null {
  const photos = m.noBefore && m.noAfter ? "before and after photos" : m.noBefore ? "before photos" : m.noAfter ? "after photos" : null;
  if (m.noLog) return `No daily log for ${site} yet${photos ? ` (and no ${photos})` : ""} - 60 seconds: tap to log.`;
  return photos && withLogIn ? `No ${photos} for ${site} yet - tap to add them.` : null;
}
