// Findings engine - the decisions (Phase 2 step 2, 24 Oct 2026). Given this
// run's signals (lib/findings/signals.ts) and the latest stored finding for
// each problem, it works out what to write: open a new finding, refresh an
// open one, escalate, clear, auto-resolve, verify, reopen. Plain functions,
// no database - lib/findings/store.ts applies the plan in one transaction,
// and engine.test.ts checks every rule. Settings: lib/findings/config.ts.
//
// The lifecycle (design §1.1-1.2, decisions §1.4):
//  - same problem next run -> the same open finding (keyed by dedupeKey);
//    new evidence only on a severity change or a material move in the values
//  - rule stops firing: INFO resolves itself; MEDIUM+ is marked "signal
//    cleared" and stays open for a person - nothing important disappears
//  - resolved and clear for the rule's window (1 / 2 / 7 days) -> verified
//  - fires again before that -> back to Open ("fix didn't take")
//  - fires again within 30 days of verified -> the same finding reopens
//    ("recurred"); after 30 days a new finding, linked to the old one
//  - resolved by a person while still firing -> never auto-verified
//  - dismissed: an accepted risk stays quiet until its date, a false alarm
//    until the rule has stopped once - unless the severity rises
import type { Signal } from "./signals";
import type { Priority } from "../insights/kpis";
import { daysBetween } from "../dates";
import { FINDINGS_CONFIG, verifyAfterDays } from "./config";

export type FindingStatus = "OPEN" | "ACKNOWLEDGED" | "ACTIONED" | "RESOLVED" | "DISMISSED" | "VERIFIED";
const OPENISH: FindingStatus[] = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];
const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

// The stored finding as the engine needs it.
export type FindingState = {
  id: string;
  dedupeKey: string;
  ruleCode: string;
  severity: Priority;
  status: FindingStatus;
  currentValue: string | null;
  signalClearedAt: Date | null;
  clearRuns: number;
  resolvedWhileFiring: boolean;
  resolvedAt: Date | null;
  verifiedAt: Date | null;
  dismissKind: string | null;
  suppressUntil: string | null;
  seenCount: number;
};

export type EventInput = { action: string; fromValue?: string | null; toValue?: string | null; note?: string | null };
export type EvidenceInput = { kind: "METRIC" | "RECORD"; recordType?: string | null; recordId?: string | null; label: string; value?: string | null };
export type FindingFields = Record<string, unknown>;

export type Op =
  | { type: "create"; key: string; data: FindingFields; events: EventInput[]; evidence: EvidenceInput[]; alert: boolean }
  | { type: "update"; key: string; id: string; data: FindingFields; events: EventInput[]; evidence: EvidenceInput[]; alert: boolean };

export type RunContext = { now: Date; today: string; sydneyDay: (d: Date) => string };

// ---------- helpers ----------

const json = (v: unknown) => JSON.stringify(v);
const parse = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
};

// Has the measured picture moved enough to be worth recording again?
export function isMaterialChange(prev: Record<string, unknown> | null, next: Record<string, unknown>): boolean {
  if (!prev) return true;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const a = prev[k], b = next[k];
    if (typeof a === "number" && typeof b === "number") {
      if (/pct/i.test(k)) { if (Math.abs(a - b) >= FINDINGS_CONFIG.materialChange.pctPoints) return true; }
      else if (Math.abs(a - b) / Math.max(Math.abs(a), 1) >= FINDINGS_CONFIG.materialChange.relative) return true;
    } else if (a !== b) return true;
  }
  return false;
}

const metric = (s: Signal): EvidenceInput => ({ kind: "METRIC", label: "Measured", value: json(s.values) });
const records = (s: Signal): EvidenceInput[] =>
  s.evidence.map((e) => ({ kind: "RECORD", recordType: e.recordType, recordId: e.recordId, label: e.label }));

// Everything a signal says about its finding, refreshed on every sighting.
const fromSignal = (s: Signal, now: Date): FindingFields => ({
  subjectName: s.subject.name, projectId: s.projectId, title: s.title, audience: s.audience,
  provisional: s.provisional, confidence: s.confidence, currentValue: json(s.values), href: s.href, lastSeenAt: now,
});

const pushable = (sev: string) => FINDINGS_CONFIG.pushSeverities.includes(sev as Priority);

function createOp(s: Signal, now: Date, reopenedFromId: string | null, note: string | null): Op {
  return {
    type: "create",
    key: s.dedupeKey,
    data: {
      ...fromSignal(s, now),
      ruleCode: s.kind, subjectType: s.subject.type, subjectId: s.subject.id, dedupeKey: s.dedupeKey, openKey: s.dedupeKey,
      severity: s.severity, status: "OPEN", firstSeenAt: now, seenCount: 1, reopenedFromId,
    },
    events: [{ action: "OPENED", toValue: s.severity, note }],
    evidence: [metric(s), ...records(s)],
    alert: pushable(s.severity),
  };
}

// ---------- one problem ----------

export function planKey(signal: Signal | null, f: FindingState | null, ctx: RunContext): Op | null {
  const { now, today } = ctx;
  if (signal && !f) return createOp(signal, now, null, null);
  if (!f) return null;
  const key = f.dedupeKey;
  const daysClear = f.signalClearedAt ? daysBetween(ctx.sydneyDay(f.signalClearedAt), today) : 0;

  // ----- the rule fired this run -----
  if (signal) {
    const base = { ...fromSignal(signal, now), seenCount: f.seenCount + 1 };
    if (OPENISH.includes(f.status)) {
      const events: EventInput[] = [];
      const evidence: EvidenceInput[] = [];
      let alert = false;
      if (signal.severity !== f.severity) {
        const up = RANK[signal.severity] < RANK[f.severity];
        events.push({ action: up ? "ESCALATED" : "DEESCALATED", fromValue: f.severity, toValue: signal.severity });
        evidence.push(metric(signal));
        alert = up && pushable(signal.severity);
      } else if (isMaterialChange(parse(f.currentValue), signal.values)) {
        evidence.push(metric(signal));
      }
      const data: FindingFields = { ...base, severity: signal.severity };
      if (f.signalClearedAt) {
        Object.assign(data, { signalClearedAt: null, clearRuns: 0 });
        events.push({ action: "SIGNAL_RETURNED" });
      }
      return { type: "update", key, id: f.id, data, events, evidence, alert };
    }
    if (f.status === "RESOLVED") {
      // A person closed it knowing it still fired: their call - just keep it current.
      if (f.resolvedWhileFiring) return { type: "update", key, id: f.id, data: base, events: [], evidence: [], alert: false };
      return {
        type: "update", key, id: f.id,
        data: { ...base, severity: signal.severity, status: "OPEN", openKey: key, signalClearedAt: null, clearRuns: 0 },
        events: [{ action: "NOT_FIXED", note: "The rule fired again before the fix was verified" }],
        evidence: [metric(signal)],
        alert: pushable(signal.severity),
      };
    }
    if (f.status === "VERIFIED") {
      const since = f.verifiedAt ?? f.resolvedAt;
      if (since && daysBetween(ctx.sydneyDay(since), today) <= FINDINGS_CONFIG.recurrenceWindowDays) {
        return {
          type: "update", key, id: f.id,
          data: { ...base, severity: signal.severity, status: "OPEN", openKey: key, outcomeResult: "RECURRED", signalClearedAt: null, clearRuns: 0 },
          events: [{ action: "RECURRED", note: "The same problem came back within the recurrence window" }],
          evidence: [metric(signal)],
          alert: pushable(signal.severity),
        };
      }
      return createOp(signal, now, f.id, "Came back after the recurrence window");
    }
    if (f.status === "DISMISSED") {
      const escalated = RANK[signal.severity] < RANK[f.severity];
      const suppressed = f.dismissKind === "ACCEPTED_RISK"
        ? !!f.suppressUntil && f.suppressUntil >= today
        : !f.signalClearedAt; // a false alarm: quiet until the rule has stopped once
      if (suppressed && !escalated) return { type: "update", key, id: f.id, data: { lastSeenAt: now, seenCount: f.seenCount + 1 }, events: [], evidence: [], alert: false };
      return createOp(signal, now, f.id, escalated ? "Dismissed earlier; the severity has risen" : "Dismissed earlier; it has come back");
    }
    return null;
  }

  // ----- the rule did not fire this run -----
  if (OPENISH.includes(f.status)) {
    if (FINDINGS_CONFIG.autoResolveSeverities.includes(f.severity)) {
      return {
        type: "update", key, id: f.id,
        data: { status: "RESOLVED", openKey: null, resolvedAt: now, resolvedBy: "System", resolution: "The rule no longer fires", signalClearedAt: now, clearRuns: 0, resolvedWhileFiring: false },
        events: [{ action: "AUTO_RESOLVED", note: "The rule no longer fires" }],
        evidence: [], alert: false,
      };
    }
    if (!f.signalClearedAt) {
      return { type: "update", key, id: f.id, data: { signalClearedAt: now, clearRuns: 0 }, events: [{ action: "SIGNAL_CLEARED", note: "The rule no longer fires - a person decides whether it's resolved" }], evidence: [], alert: false };
    }
    return daysClear !== f.clearRuns ? { type: "update", key, id: f.id, data: { clearRuns: daysClear }, events: [], evidence: [], alert: false } : null;
  }
  if (f.status === "RESOLVED") {
    if (!f.signalClearedAt) {
      return { type: "update", key, id: f.id, data: { signalClearedAt: now, clearRuns: 0 }, events: [{ action: "SIGNAL_CLEARED" }], evidence: [], alert: false };
    }
    if (!f.resolvedWhileFiring && daysClear >= verifyAfterDays(f.ruleCode)) {
      return {
        type: "update", key, id: f.id,
        data: { status: "VERIFIED", verifiedAt: now, verifiedBy: "System", outcomeResult: "EFFECTIVE", clearRuns: daysClear },
        events: [{ action: "VERIFIED", note: `Clear for ${daysClear} day${daysClear === 1 ? "" : "s"}` }],
        evidence: [], alert: false,
      };
    }
    return daysClear !== f.clearRuns ? { type: "update", key, id: f.id, data: { clearRuns: daysClear }, events: [], evidence: [], alert: false } : null;
  }
  if (f.status === "DISMISSED" && !f.signalClearedAt) {
    return { type: "update", key, id: f.id, data: { signalClearedAt: now }, events: [{ action: "SIGNAL_CLEARED" }], evidence: [], alert: false };
  }
  return null; // VERIFIED, or a dismissed one already clear
}

// ---------- the whole run ----------

// The finding each problem is judged against: its open one if any, else the
// most recent closed one.
export function latestByKey<T extends FindingState & { createdAt: Date }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const cur = out.get(r.dedupeKey);
    const isOpen = OPENISH.includes(r.status);
    if (!cur) { out.set(r.dedupeKey, r); continue; }
    const curOpen = OPENISH.includes(cur.status);
    if ((isOpen && !curOpen) || (isOpen === curOpen && r.createdAt > cur.createdAt)) out.set(r.dedupeKey, r);
  }
  return out;
}

export function planRun(signals: Signal[], latest: Map<string, FindingState>, ctx: RunContext): Op[] {
  const ops: Op[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    if (seen.has(s.dedupeKey)) continue; // one problem, one finding (keys are unique by construction)
    seen.add(s.dedupeKey);
    const op = planKey(s, latest.get(s.dedupeKey) ?? null, ctx);
    if (op) ops.push(op);
  }
  for (const [key, f] of latest) {
    if (seen.has(key)) continue;
    const op = planKey(null, f, ctx);
    if (op) ops.push(op);
  }
  return ops;
}

export function summarise(ops: Op[]) {
  const actions: Record<string, number> = {};
  for (const o of ops) for (const e of o.events) actions[e.action] = (actions[e.action] ?? 0) + 1;
  return {
    created: ops.filter((o) => o.type === "create").length,
    updated: ops.filter((o) => o.type === "update").length,
    events: ops.reduce((n, o) => n + o.events.length, 0),
    evidence: ops.reduce((n, o) => n + o.evidence.length, 0),
    alerts: ops.filter((o) => o.alert).length,
    actions,
  };
}
