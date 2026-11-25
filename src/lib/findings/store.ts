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
import { assertNoMoney } from "../moneyGuard";
import { FINDINGS_CONFIG, LCI_CLEANUP, lciCleanupOn, lciPushOn, screenFor } from "./config";
import { alertsDue, cleanupCounts, latestByKey, planRun, summarise, type CleanupCounts, type FindingState, type Op } from "./engine";
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
    // The one-off cleanup: only while it hasn't been recorded.
    const cleanup = lciCleanupOn() && !(await prisma.findingCleanup.findUnique({ where: { label: LCI_CLEANUP.label }, select: { id: true } }));
    const latest = latestByKey(rows as (FindingState & { createdAt: Date })[]);
    const ops = planRun(signals, latest, { now, today, sydneyDay, cleanup }, notChecked);
    const counts = cleanup ? cleanupCounts(ops, new Map(rows.map((r) => [r.id, r.ruleCode])), rows.filter((r) => OPENISH.includes(r.status)).length) : null;
    await apply(ops, now, counts);
    await alert(ops);
    return { ...summarise(ops), today, signals: signals.length, cleanup: counts };
  } finally {
    running = false;
  }
}

async function apply(ops: Op[], now: Date, cleanup: CleanupCounts | null) {
  if (!ops.length && !cleanup) return;
  await prisma.$transaction(async (tx) => {
    for (const op of ops) {
      const id = op.type === "create"
        ? (await tx.finding.create({ data: op.data as Parameters<typeof tx.finding.create>[0]["data"], select: { id: true } })).id
        : (await tx.finding.update({ where: { id: op.id }, data: op.data, select: { id: true } })).id;
      if (op.events.length) {
        await tx.findingEvent.createMany({ data: op.events.map((e) => ({ findingId: id, action: e.action, by: "System", fromValue: e.fromValue ?? null, toValue: e.toValue ?? null, note: e.note ?? null, at: now })) });
      }
      if (op.evidence.length) {
        await tx.findingEvidence.createMany({ data: op.evidence.map((e) => ({ findingId: id, kind: e.kind, recordType: e.recordType ?? null, recordId: e.recordId ?? null, label: e.label, value: e.value ?? null, asOf: now, capturedAt: now })) });
      }
    }
    // Written in the same transaction: the cleanup happens exactly once, or not at all.
    if (cleanup) await tx.findingCleanup.create({ data: { label: LCI_CLEANUP.label, closed: cleanup.closed, left: cleanup.left, byRule: JSON.stringify(cleanup.byRule), at: now } });
  }, { timeout: 60_000 });
}

// CRITICAL on open / escalate / reopen -> the configured logins' phones (if
// they've turned alerts on) - the owner only, never every Admin. Words only:
// the title and where to look, never a dollar figure on an Operations one.
async function alert(ops: Op[]) {
  const due = alertsDue(ops, lciPushOn());
  if (!due.length) return;
  const users = await prisma.user.findMany({ where: { email: { in: FINDINGS_CONFIG.criticalAlertRecipients }, active: true }, select: { id: true } });
  if (!users.length) return;
  for (const o of due) {
    const ruleCode = String(o.data.ruleCode ?? o.key.split(":")[0]);
    const directors = screenFor({ ruleCode, audience: String(o.data.audience ?? "") }) === "DIRECTORS";
    const raw = String(o.data.title ?? "Critical finding");
    // No dollar figure in an Operations phone notification - the card has the detail.
    const title = directors || assertNoMoney(raw) ? raw : "Something needs attention on your board";
    await pushToUsers(users.map((u) => u.id), {
      title: `🔴 Critical: ${title}`.slice(0, 120),
      body: directors ? "Needs attention - Directors" : "Needs attention - on your board",
      url: directors ? "/directors" : "/command",
      tag: `finding-${o.key}`, sticky: true,
    }, "high").catch((e) => console.error("finding alert", e));
  }
}
