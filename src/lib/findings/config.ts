// Findings settings (Phase 2, decided 24 Oct 2026) - one place, read by the
// engine and its tests. Design: director-insights-plan/PHASE2-FINDINGS-DESIGN.md §1.4.
// No server imports.
import { OWNER_EMAIL } from "../owner";
import type { Priority } from "../insights/kpis";

export const FINDINGS_CONFIG = {
  // The engine runs from the instrumentation tick, at most this often.
  runEveryMinutes: 30,
  // Verify "asap" (Ilies, delegated to the lead): a resolved finding is
  // verified automatically once its signal has stayed clear this many days -
  // 1 for data gaps, dates, readiness and days not closed; 2 for hire and
  // crew (they flicker with board edits); 7 for cost (invoices land late).
  verifyAfterDays: {
    default: 1,
    byPrefix: [
      { prefix: "HIRE_", days: 2 },
      { prefix: "CREW_SHORT", days: 2 },
      { prefix: "COST_VS_CONTRACT", days: 7 },
    ],
  },
  // The same problem again within this many days of being resolved or
  // verified reopens the same finding; after that it's a new one.
  recurrenceWindowDays: 30,
  // These severities close themselves the moment the rule stops firing. Since
  // LCI Stage 1 (Ilies, 25 Nov 2026: "approve all defaults") every other
  // severity closes itself too, once its signal has stayed clear for the
  // rule's verify window (below) - "Resolved by System: the rule no longer
  // fires" - except a CRITICAL finding on the Directors screen (Xero
  // reconnect, Act-level cost), which still waits for a person.
  autoResolveSeverities: ["INFO"] as Priority[],
  // Phone alerts: CRITICAL only, to these logins (Ilies only, until he
  // confirms otherwise - he told the lead "me and Nick", this agent "just me").
  pushSeverities: ["CRITICAL"] as Priority[],
  criticalAlertRecipients: [OWNER_EMAIL],
  // New evidence only when the measured values move this much: 5 points on
  // a percentage, 5% on any other number; any change of text or flag.
  materialChange: { pctPoints: 0.05, relative: 0.05 },
};

export function verifyAfterDays(ruleCode: string): number {
  return FINDINGS_CONFIG.verifyAfterDays.byPrefix.find((p) => ruleCode.startsWith(p.prefix))?.days ?? FINDINGS_CONFIG.verifyAfterDays.default;
}

// Which screen each finding belongs on (Task J, 25 Oct 2026; Ilies: the
// directors' box shouldn't show operational outstanding matters). Director-
// level kinds go on the Directors overview; every other kind is operational -
// stored, but not listed anywhere (the Operations "Attention" page was removed
// 25 Oct 2026: Ilies, "all other tabs flag and raise the issues") - since LCI
// Stage 1 (25 Nov 2026) they're on the board's "Needs attention" card
// (lib/findings/card.ts), and a CRITICAL one pushes to the owner. Move a kind between
// screens by adding it to or taking it off this list. Anything with the
// DIRECTOR audience always stays on the Directors screen. Display and
// permission routing only - the engine and the findings don't change.
export const DIRECTOR_KINDS: ReadonlySet<string> = new Set([
  "COST_VS_CONTRACT",
  "DATA_NO_CONTRACT_VALUE",
  "TENDER_WON_NO_PROJECT",
  "XERO_UNMATCHED",
  "XERO_REAUTH",
  "LABOUR_HOURS_VS_BUDGET", // Task K: a code at "Act" in the daily log's hours vs budget (Ilies, 25 Oct 2026)
]);

export type FindingScreen = "DIRECTORS" | "OPERATIONS";
export const screenFor = (f: { ruleCode: string; audience: string }): FindingScreen =>
  DIRECTOR_KINDS.has(f.ruleCode) || f.audience === "DIRECTOR" ? "DIRECTORS" : "OPERATIONS";

// ---------- LCI Stage 1 (Ilies, 25 Nov 2026: "approve all defaults") ----------
// Plan: operations-agent-log/reports/LCI full coverage plan (25 Nov 2026).md, sections 1 and 3.

// Rules taken out of service. Their open findings close with this reason; the
// rule never fires again. DATE_INACTIVE_HAS_JOBS: "inactive" means "doesn't need
// attention right now" - jobs are staged and called back (Ilies). A call-back is
// checked like a start instead (START_NOT_READY on the restart day).
export const RETIRED_RULES: ReadonlyMap<string, string> = new Map([
  ["DATE_INACTIVE_HAS_JOBS", "inactive with jobs booked is normal (jobs are staged and called back) - restarts are checked like starts"],
]);

// Not a site: the Yard and internal test projects never raise a supervisor gap
// or a missing start date. Matched on the project's name (trimmed, any case).
export const NOT_A_SITE: readonly RegExp[] = [/^yard$/i, /^test\b/i];
export const isNotASite = (name: string | null | undefined) => !!name && NOT_A_SITE.some((re) => re.test(name.trim()));
// A test project's allocations are never a cost gap either (the Yard's still are - its costs are real).
export const isTestProject = (name: string | null | undefined) => !!name && /^test\b/i.test(name.trim());

export const LCI_RULES = {
  // DATE_START_MISMATCH: only a difference of more than this many days (staged
  // starts are normal), and only on projects whose first board day is no older
  // than recentBoardDays.
  startMismatchOverDays: 7,
  startMismatchRecentBoardDays: 60,
  // A booked day on an inactive project with no running job in this many days
  // before it is a restart, checked like a start (within the start window).
  restartGapDays: 14,
  restartWindowDays: 7,
  // DATA_UNCOSTED: only allocations from the last 30 days, or on a day not yet closed.
  uncostedRecentDays: 30,
} as const;

// The one-off cleanup of stale findings (Decision 2, default yes): the engine's
// first run after deploy closes what the new rules no longer flag, once, with
// this reason on every closed finding. Recorded in FindingCleanup (one row per
// label) so it never runs twice. LCI_CLEANUP=off skips it.
// LS-004 (Ilies approved, 25 Nov 2026): it runs only within windowDays of the
// label date (Sydney); after that it's skipped (logged once). In the cleanup run
// the "the new rule no longer flags it" close applies only to the rules Stage 1
// changed (CLEANUP_RULES) - every other rule closes the normal way, after its
// clear window.
export const LCI_CLEANUP = { label: "2026-11-25", prefix: "Closed in the 25 Nov cleanup", windowDays: 7 } as const;
export const CLEANUP_RULES: ReadonlySet<string> = new Set([
  "NO_SUPERVISOR", "START_NOT_READY", "DATE_START_MISMATCH", "DATE_NO_START", "DATA_UNCOSTED", "DATE_INACTIVE_HAS_JOBS",
]);

// LS-001: a snooze (accepted risk until a date) is at most this many days ahead.
export const SNOOZE_MAX_DAYS = { everyone: 90, coordinator: 14 } as const;

// LS-003: at most this many individual Operations-screen CRITICAL pushes per
// engine run; any more go as one summary push to the owner.
export const MAX_OPS_PUSHES_PER_RUN = 3;

// Outcomes that are a close, not a fix - never auto-verified as "effective".
//   LAPSED       a dated finding whose day passed before it was fixed
//   RETIRED      the rule was taken out of service
//   RULE_CHANGED the cleanup closed it because the new rule no longer flags it
export const NOT_A_FIX_OUTCOMES: ReadonlySet<string> = new Set(["LAPSED", "RETIRED", "RULE_CHANGED"]);

// The "Needs attention" card (plan section 3.1): at most this many lines,
// worst first; a rule with groupFrom or more items is one expandable line.
export const CARD = { maxLines: 8, groupFrom: 3 } as const;

// What the coordinator (Alex) sees on his "For you" card: operational,
// money-free kinds he can already fix from his own pages (Hire: off-hire /
// extend). Stage 2 adds tools, faults, bins, sign-ins and site requests.
export const COORDINATOR_KINDS: ReadonlySet<string> = new Set(["HIRE_OVERDUE"]);

// Kinds whose own module already sends a phone alert: LCI lists them but never
// pushes them again (plan: "never doubling an existing alert"). None of the
// Stage 1 kinds do; Stage 2 adds pre-starts, urgent requests and faults here.
export const MODULE_ALERTED_KINDS: ReadonlySet<string> = new Set<string>([]);

// Kill switches (env). LCI_RULES_OFF=<CODE,CODE>: those rules aren't run and
// their findings are left exactly as they are (and kept off the card).
// LCI_CARD=off hides the card; LCI_PUSH=off stops LCI's own operational pushes
// (the Directors-screen alerts are unchanged); LCI_CLEANUP=off skips the cleanup.
export const rulesOff = (env: string | undefined = process.env.LCI_RULES_OFF): Set<string> =>
  new Set((env ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
const isOff = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "off";
export const lciCardOn = () => !isOff(process.env.LCI_CARD);
export const lciPushOn = () => !isOff(process.env.LCI_PUSH);
export const lciCleanupOn = () => !isOff(process.env.LCI_CLEANUP);
