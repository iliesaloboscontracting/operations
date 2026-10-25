// Findings store (Phase 2 step 2, 24 Oct 2026): runs the engine against the
// database. Today's signals (lib/findings/load.ts) + the stored findings ->
// the plan (lib/findings/engine.ts) -> written in one transaction, then any
// CRITICAL alert to the configured logins (Ilies only for now). Called from
// the instrumentation tick, at most every 30 minutes, never two at once.
import { prisma } from "../prisma";
import { pushToUsers } from "../push";
import { FINDINGS_CONFIG } from "./config";
import { latestByKey, planRun, summarise, type FindingState, type Op } from "./engine";
import { loadSignals } from "./load";

const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
export const sydneyDay = (d: Date) => SYDNEY_DAY.format(d); // YYYY-MM-DD

let lastRun = 0;
let running = false;

export type FindingsRunResult = ReturnType<typeof summarise> & { today: string; signals: number };

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
      },
    });
    const latest = latestByKey(rows as (FindingState & { createdAt: Date })[]);
    const ops = planRun(signals, latest, { now, today, sydneyDay }, notChecked);
    await apply(ops, now);
    await alert(ops);
    return { ...summarise(ops), today, signals: signals.length };
  } finally {
    running = false;
  }
}

async function apply(ops: Op[], now: Date) {
  if (!ops.length) return;
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
  }, { timeout: 60_000 });
}

// CRITICAL on open / escalate / reopen -> the configured logins' phones (if
// they've turned alerts on). Never every Admin.
async function alert(ops: Op[]) {
  const due = ops.filter((o) => o.alert);
  if (!due.length) return;
  const users = await prisma.user.findMany({ where: { email: { in: FINDINGS_CONFIG.criticalAlertRecipients }, active: true }, select: { id: true } });
  if (!users.length) return;
  for (const o of due) {
    const title = String(o.data.title ?? "Critical finding");
    await pushToUsers(users.map((u) => u.id), { title: `🔴 Critical: ${title}`.slice(0, 120), body: "Needs attention - Directors", url: "/directors", tag: `finding-${o.key}`, sticky: true }, "high")
      .catch((e) => console.error("finding alert", e));
  }
}
