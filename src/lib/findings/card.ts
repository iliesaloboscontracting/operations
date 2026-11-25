// The "Needs attention" card (LCI Stage 1, Ilies 25 Nov 2026: "approve all
// defaults"; plan §3.1 / §3.3). Plain rules, no database - the route
// (/api/findings/card) reads the stored findings and the card shows this.
//   - Who: the owner, Admins and Managers get the Operations card (operational
//     and commercial Operations-screen findings, never a Directors-only one);
//     the coordinator gets a money-free "For you" card of the kinds he can fix
//     (COORDINATOR_KINDS); every other login gets nothing (the route says 403).
//   - What: worst first (CRITICAL, HIGH, MEDIUM), then the longest-standing;
//     a rule with 3+ items is one line that expands; at most CARD.maxLines
//     lines, the rest behind "+ N more". INFO ("data gaps") never makes the
//     top lines - the Operations card lists them in the drawer.
//   - No doubling with the board: a start not ready (the board's own "starting
//     soon" strip shows it) stays off the card - a restart, which the strip
//     doesn't show, is on it.
//   - "Done" while the rule still fires: the line stays, marked so, instead of
//     disappearing.
import { isOwner } from "../owner";
import { assertNoMoney } from "../moneyGuard";
import { CARD, COORDINATOR_KINDS, SNOOZE_MAX_DAYS, screenFor } from "./config";

export type CardViewer = { email: string; role: string; directorAccess?: boolean | null };
export type CardVariant = "OPERATIONS" | "COORDINATOR";

export function cardVariant(u: CardViewer): CardVariant | null {
  if (u.role === "COORDINATOR") return "COORDINATOR";
  if (isOwner(u.email) || u.role === "ADMIN" || u.role === "MANAGER") return "OPERATIONS";
  return null; // VIEWER, DIRECTOR, ACCOUNTS, TIMESHEETS, YARD
}

export type CardFinding = {
  id: string; ruleCode: string; severity: string; audience: string; status: string; title: string; href: string | null;
  firstSeenAt: Date; signalClearedAt: Date | null; resolvedWhileFiring: boolean; currentValue: string | null;
};

export type CardLine = {
  id: string; rule: string; label: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "INFO"; title: string; href: string | null;
  since: string; // when it was first seen (ISO)
  doneButStillShowing: boolean; // marked Done while the rule still fires
  cleared: boolean; // the rule has stopped firing - it closes itself after its window
};
export type CardEntry = { kind: "ONE"; line: CardLine } | { kind: "GROUP"; rule: string; label: string; severity: CardLine["severity"]; since: string; items: CardLine[] };
export type CardDTO = {
  variant: CardVariant;
  counts: { urgent: number; toDo: number; dataGaps: number }; // urgent = CRITICAL + HIGH, to do = MEDIUM (lines, not groups)
  top: CardEntry[]; more: CardEntry[]; dataGaps: CardLine[];
  snoozeMaxDays: number; // LS-001: the furthest a snooze may go for this login (the route refuses later dates too)
};

const OPENISH = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];
const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

// How each rule reads as a line or group heading on the card.
export const CARD_LABEL: Record<string, string> = {
  NO_SUPERVISOR: "Crew with no supervisor or lead",
  LONE_WORKER: "One person alone on site",
  DAY_NO_LEAD: "Day shift with no lead",
  NIGHT_NO_LEAD: "Night shift with no lead",
  START_NOT_READY: "Restart not ready",
  CREW_SHORT: "Crew short",
  DAYS_NOT_CLOSED: "Days not closed",
  HIRE_OVERDUE: "Hire past its off-hire date",
  HIRE_IDLE: "Hire not on a job",
  HIRE_UNINVOICED: "Hire with no invoice yet",
  HIRE_NO_FINISH: "Hire with no finish date",
  DATE_COMPLETED_HAS_JOBS: "Completed project with jobs booked",
  DATE_START_MISMATCH: "Start date doesn't match the board",
  DATE_JOBS_AFTER_COMPLETION: "Jobs booked after planned completion",
  DATE_COMPLETION_PASSED: "Planned completion has passed",
  DATE_NO_START: "No start date",
  DATE_TBC_REVIEW_DUE: "Completion TBC - review due",
  DATE_JOBS_NO_TIMES: "Jobs with no times",
  DATA_UNCOSTED: "Can't be costed",
  DATA_PLANT_NOT_BOOKED: "Plant not booked on the board",
  TIP_DOCKET_UNINVOICED: "Tip docket on no invoice",
  TIP_INVOICE_NO_DOCKET: "Tip invoice with no docket",
};
export const cardLabel = (rule: string) => CARD_LABEL[rule] ?? rule.charAt(0) + rule.slice(1).toLowerCase().replace(/_/g, " ");

const valueOf = (f: CardFinding): Record<string, unknown> => { try { return f.currentValue ? JSON.parse(f.currentValue) : {}; } catch { return {}; } };

// Is this finding for this card at all?
export function onCard(f: CardFinding, variant: CardVariant, off: ReadonlySet<string> = new Set()): boolean {
  if (off.has(f.ruleCode)) return false;
  const live = OPENISH.includes(f.status) || (f.status === "RESOLVED" && f.resolvedWhileFiring && !f.signalClearedAt);
  if (!live) return false;
  if (screenFor(f) !== "OPERATIONS") return false; // never a Directors-only item
  if (f.ruleCode === "START_NOT_READY" && !valueOf(f).restart) return false; // the board's own strip shows starts
  if (variant === "OPERATIONS") return f.audience === "OPERATIONAL" || f.audience === "COMMERCIAL";
  // The coordinator: his kinds only, operational, never INFO, never a dollar figure.
  return COORDINATOR_KINDS.has(f.ruleCode) && f.audience === "OPERATIONAL" && f.severity !== "INFO" && assertNoMoney(f.title) && assertNoMoney(f.href ?? "");
}

const toLine = (f: CardFinding): CardLine => ({
  id: f.id, rule: f.ruleCode, label: cardLabel(f.ruleCode), severity: (RANK[f.severity] != null ? f.severity : "INFO") as CardLine["severity"],
  title: f.title, href: f.href, since: f.firstSeenAt.toISOString(),
  doneButStillShowing: f.status === "RESOLVED", cleared: !!f.signalClearedAt && f.status !== "RESOLVED",
});

// Worst first; still firing before "cleared"; then the longest-standing; then by title.
export const sortLines = (a: CardLine, b: CardLine) =>
  RANK[a.severity] - RANK[b.severity] || Number(a.cleared) - Number(b.cleared) || a.since.localeCompare(b.since) || a.title.localeCompare(b.title);

export function buildCard(findings: CardFinding[], variant: CardVariant, off: ReadonlySet<string> = new Set()): CardDTO {
  const lines = findings.filter((f) => onCard(f, variant, off)).map(toLine).sort(sortLines);
  const main = lines.filter((l) => l.severity !== "INFO");
  const dataGaps = variant === "OPERATIONS" ? lines.filter((l) => l.severity === "INFO") : [];
  // Group: a rule with groupFrom+ lines is one entry, where its worst / oldest line would be.
  const byRule = new Map<string, CardLine[]>();
  for (const l of main) byRule.set(l.rule, [...(byRule.get(l.rule) ?? []), l]);
  const entries: CardEntry[] = [];
  const placed = new Set<string>();
  for (const l of main) {
    const same = byRule.get(l.rule)!;
    if (same.length < CARD.groupFrom) { entries.push({ kind: "ONE", line: l }); continue; }
    if (placed.has(l.rule)) continue;
    placed.add(l.rule);
    entries.push({ kind: "GROUP", rule: l.rule, label: l.label, severity: l.severity, since: same.reduce((m, x) => (x.since < m ? x.since : m), l.since), items: same });
  }
  return {
    variant,
    snoozeMaxDays: variant === "COORDINATOR" ? SNOOZE_MAX_DAYS.coordinator : SNOOZE_MAX_DAYS.everyone,
    counts: {
      urgent: main.filter((l) => l.severity === "CRITICAL" || l.severity === "HIGH").length,
      toDo: main.filter((l) => l.severity === "MEDIUM").length,
      dataGaps: dataGaps.length,
    },
    top: entries.slice(0, CARD.maxLines),
    more: entries.slice(CARD.maxLines),
    dataGaps,
  };
}

// The coordinator's card must never carry money (also checked by the route before it answers).
export const cardIsMoneyFree = (c: CardDTO) => assertNoMoney(JSON.stringify(c));
