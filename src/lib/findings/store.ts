// Findings store (Phase 2 step 2, 24 Oct 2026): runs the engine against the
// database. Today's signals (lib/findings/load.ts) + the stored findings ->
// the plan (lib/findings/engine.ts) -> written in one transaction, then any
// CRITICAL alert to the configured logins (Ilies only for now). Called from
// the instrumentation tick, at most every 30 minutes, never two at once.
//
// LCI Stage 1 (25 Nov 2026): the first run after deploy is the one-off
// cleanup (LCI_CLEANUP label, recorded in FindingCleanup so it never runs
// twice; LCI_CLEANUP=off skips it), and CRITICAL Operations-screen findings
// now push to the owner too (never a kind whose module already alerts;
// LCI_PUSH=off stops them).
import { prisma } from "../prisma";
import { pushToUsers } from "../push";
import { FINDINGS_CONFIG, LCI_CLEANUP, lciCleanupOn, lciPushOn } from "./config";
import { alertsDue, cleanupCounts, cleanupDue, latestByKey, planRun, pushMessages, summarise, type CleanupCounts, type FindingState, type Op } from "./engine";
import { applyOps, type FindingsTx } from "./apply";
import { loadSignals } from "./load";

const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
export const sydneyDay = (d: Date) => SYDNEY_DAY.format(d); // YYYY-MM-DD

let lastRun = 0;
let running = false;

export type FindingsRunResult = ReturnType<typeof summarise> & { today: string; signals: number; cleanup: CleanupCounts | null };

const OPENISH = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];

export async function runFindings(opts: { force?: boolean; now?: Date } = {}): Promise<FindingsRunResult | null> {
  if (running) return null;
  if (!opts.force && Date.now() - lastRun < FINDINGS_CONFIG.runEveryMinutes * 60_000) return null;
  lastRun = Date.now();
  running = true;
  try {
    const now = opts.now ?? new Date();
    const { signals, today, notChecked } = await loadSignals();
    const rows = await prisma.finding.findMany({
      select: {
        id: true, dedupeKey: true, ruleCode: true, severity: true, status: true, currentValue: true, signalClearedAt: true, clearRuns: true,
        resolvedWhileFiring: true, resolvedAt: true, verifiedAt: true, dismissKind: true, suppressUntil: true, seenCount: true, createdAt: true,
        audience: true, outcomeResult: true,
      },
    });
    // The one-off cleanup: only while it hasn't been recorded, and only within its window (LS-004).
    const due = cleanupDue(today, !!(await prisma.findingCleanup.findUnique({ where: { label: LCI_CLEANUP.label }, select: { id: true } })), lciCleanupOn());
    if (due === "LATE" && !lateLogged) {
      lateLogged = true;
      console.log(`findings: the ${LCI_CLEANUP.label} cleanup never ran and its ${LCI_CLEANUP.windowDays}-day window has passed - skipped`);
    }
    const cleanup = due === "RUN";
    const latest = latestByKey(rows as (FindingState & { createdAt: Date })[]);
    const ops = planRun(signals, latest, { now, today, sydneyDay, cleanup }, notChecked);
    const openBefore = rows.filter((r) => OPENISH.includes(r.status)).length;
    const ruleOf = new Map(rows.map((r) => [r.id, r.ruleCode]));
    const { written, counts } = await apply(ops, now, cleanup ? (w) => cleanupCounts(w, ruleOf, openBefore) : null);
    await alert(written, today);
    return { ...summarise(written), today, signals: signals.length, cleanup: counts };
  } finally {
    running = false;
  }
}
let lateLogged = false;

// One transaction: the plan (applyOps - LS-002, a changed finding is skipped), then the cleanup's row with the
// counts of what was actually written - so the cleanup happens exactly once, or not at all.
async function apply(ops: Op[], now: Date, countCleanup: ((written: Op[]) => CleanupCounts) | null) {
  if (!ops.length && !countCleanup) return { written: [] as Op[], counts: null };
  return prisma.$transaction(async (tx) => {
    const written = await applyOps(tx as unknown as FindingsTx, ops, now);
    const counts = countCleanup ? countCleanup(written) : null;
    if (counts) await tx.findingCleanup.create({ data: { label: LCI_CLEANUP.label, closed: counts.closed, left: counts.left, byRule: JSON.stringify(counts.byRule), at: now } });
    return { written, counts };
  }, { timeout: 60_000 });
}

// CRITICAL on open / escalate / reopen -> the configured logins' phones (if
// they've turned alerts on) - the owner only, never every Admin. Words only on
// an Operations one; at most MAX_OPS_PUSHES_PER_RUN of those, then a summary (LS-003).
async function alert(ops: Op[], today: string) {
  const msgs = pushMessages(alertsDue(ops, lciPushOn()), today);
  if (!msgs.length) return;
  const users = await prisma.user.findMany({ where: { email: { in: FINDINGS_CONFIG.criticalAlertRecipients }, active: true }, select: { id: true } });
  if (!users.length) return;
  for (const m of msgs) {
    await pushToUsers(users.map((u) => u.id), { ...m, sticky: true }, "high").catch((e) => console.error("finding alert", e));
  }
}
