// CT-001 (Ilies approved 25 Nov 2026): caps on "Read again" (READ_AGAIN on /receipts) for every role - each press is
// another Claude reading. At most 3 manual re-reads per receipt (`manualReads` in its reading log, kept with it) and at
// most 40 per login per Sydney day (a counter on globalThis, shared by every route bundle on this server, like the
// runner's being-read set). The automatic reading (runner.readReceipt's `tries`) is unchanged. No server imports.
export const READ_AGAIN_LIMITS = { perReceipt: 3, perLoginPerDay: 40 } as const;
export const RECEIPT_CAP_MESSAGE = "Read again used up for this docket - correct it by hand.";
export const DAILY_CAP_MESSAGE = "Read again limit reached for today.";

// The receipt's own cap: null when another manual re-read may go ahead.
export function receiptCapProblem(log: { manualReads?: unknown }): string | null {
  const n = typeof log.manualReads === "number" && Number.isFinite(log.manualReads) ? log.manualReads : 0;
  return n >= READ_AGAIN_LIMITS.perReceipt ? RECEIPT_CAP_MESSAGE : null;
}
export const nextManualReads = (log: { manualReads?: unknown }) =>
  (typeof log.manualReads === "number" && Number.isFinite(log.manualReads) ? log.manualReads : 0) + 1;

// The Sydney day an instant falls on (YYYY-MM-DD).
export const sydneyDayOf = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const shared = globalThis as unknown as { __receiptReadAgain?: Map<string, number> };
const counts = (shared.__receiptReadAgain ??= new Map<string, number>());

// Takes one of the login's 40 for today: true = go ahead (counted), false = the limit is reached (nothing counted).
// Keys from earlier days are dropped as it goes.
export function takeDailyReadAgain(loginKey: string, now = new Date()): boolean {
  const day = sydneyDayOf(now);
  for (const k of counts.keys()) if (!k.endsWith(`|${day}`)) counts.delete(k);
  const key = `${loginKey}|${day}`;
  const used = counts.get(key) ?? 0;
  if (used >= READ_AGAIN_LIMITS.perLoginPerDay) return false;
  counts.set(key, used + 1);
  return true;
}
export const dailyReadAgainUsed = (loginKey: string, now = new Date()) => counts.get(`${loginKey}|${sydneyDayOf(now)}`) ?? 0;
