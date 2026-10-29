// Day Review's site-log extras (30 Oct 2026, Ilies): the all-logs summary at the top of the page, and "What was
// said" - each recording a log used, word for word, next to the tidied text. Pure rules; store.siteLogsForDate reads
// the rows. Names, times and words only - no rate, cost or price, and every transcript passes the money guard.
import { assertNoMoney } from "../moneyGuard";
import { stripMoney } from "./money";
import { cleanedNote, type Cleaned } from "./voiceRules";
import type { DayReviewLogSummaryDTO, VoiceTranscriptDTO } from "./types";

// One job's line in the summary. "No site log" keeps the 19:00 rule (isMissingLog) - information only, it never
// blocks closing the day.
export function summaryState(j: { pilot: boolean; ran: boolean; hasLog: boolean; missing: boolean }): DayReviewLogSummaryDTO["state"] {
  if (j.hasLog) return "LOGGED";
  if (!j.pilot) return "NO_SUPERVISOR";
  if (!j.ran) return "NOT_RUN";
  return j.missing ? "NO_LOG" : "DUE";
}

// Who's on the job for the log: the supervisors (with a supervisor link) assigned to it, in board order; with none,
// whoever sent the log (a stand-in on a hand-over link).
export function supervisorsFor(assigned: { resourceId: string; name: string }[], supervisors: Set<string>, submittedBy: string | null): string[] {
  const names = [...new Set(assigned.filter((a) => supervisors.has(a.resourceId)).map((a) => a.name))];
  return names.length ? names : submittedBy ? [submittedBy] : [];
}

// A recording for the office: its transcript (amounts were taken out when it was saved - taken out again here) and
// the tidied text it gave. One with no transcript, or that still fails the money check, isn't shown.
export function voiceTranscript(row: { id: string; createdAt: Date; seconds: number | null; transcript: string | null; cleaned: string | null }): VoiceTranscriptDTO | null {
  if (!row.transcript?.trim()) return null;
  let tidied: string | null = null;
  try {
    const c = JSON.parse(row.cleaned ?? "null") as Partial<Cleaned> | null;
    const sections = Array.isArray(c?.sections) ? c.sections.filter((s) => s && typeof s.heading === "string" && typeof s.text === "string") : [];
    tidied = sections.length ? cleanedNote({ sections } as Cleaned) : null;
  } catch { tidied = null; }
  const out: VoiceTranscriptDTO = { id: row.id, at: row.createdAt.toISOString(), seconds: row.seconds, transcript: stripMoney(row.transcript).text, tidied };
  return assertNoMoney(JSON.stringify(out)) ? out : null;
}
