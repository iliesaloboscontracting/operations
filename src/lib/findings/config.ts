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
  // Only these severities close themselves when the rule stops firing;
  // the rest get "signal cleared" and wait for a person.
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
// level kinds go on the Directors overview; every other kind goes on the
// Operations "Attention" page (/attention, Manager+). Move a kind between
// screens by adding it to or taking it off this list. Anything with the
// DIRECTOR audience always stays on the Directors screen. Display and
// permission routing only - the engine and the findings don't change.
export const DIRECTOR_KINDS: ReadonlySet<string> = new Set([
  "COST_VS_CONTRACT",
  "DATA_NO_CONTRACT_VALUE",
  "TENDER_WON_NO_PROJECT",
  "XERO_UNMATCHED",
  "XERO_REAUTH",
]);

export type FindingScreen = "DIRECTORS" | "OPERATIONS";
export const screenFor = (f: { ruleCode: string; audience: string }): FindingScreen =>
  DIRECTOR_KINDS.has(f.ruleCode) || f.audience === "DIRECTOR" ? "DIRECTORS" : "OPERATIONS";
