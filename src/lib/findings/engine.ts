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
//    cleared", and (LCI Stage 1, 25 Nov 2026) closes itself once it has
//    stayed clear for the rule's window - except a CRITICAL Directors-screen
//    finding, which still waits for a person
//  - a dated finding (key ends in a YYYY-MM-DD day) whose day has passed
//    closes as LAPSED - "the day has passed", which is not "fixed"
//  - a retired rule's findings close as RETIRED
//  - the one-off cleanup run (ctx.cleanup) closes every open finding the new
//    rules no longer flag, with "Closed in the 25 Nov cleanup: <reason>"
//  - resolved and clear for the rule's window (1 / 2 / 7 days) -> verified
//  - fires again before that -> back to Open ("fix didn't take")
//  - fires again within 30 days of verified -> the same finding reopens
//    ("recurred"); after 30 days a new finding, linked to the old one
//  - resolved by a person while still firing -> never auto-verified
//  - dismissed: an accepted risk stays quiet until its date, a false alarm
//    until the rule has stopped once - unless the severity rises
import type { Signal } from "./signals";
import type { Priority } from "../insights/kpis";
import { addDays, daysBetween } from "../dates";
import { assertNoMoney } from "../moneyGuard";
import { CLEANUP_RULES, FINDINGS_CONFIG, LCI_CLEANUP, MAX_OPS_PUSHES_PER_RUN, MODULE_ALERTED_KINDS, NOT_A_FIX_OUTCOMES, RETIRED_RULES, screenFor, verifyAfterDays } from "./config";

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
  audience?: string | null; // decides the screen (a CRITICAL Directors-screen finding waits for a person)
  outcomeResult?: string | null; // LAPSED / RETIRED / RULE_CHANGED are never auto-verified
};

export type EventInput = { action: string; fromValue?: string | null; toValue?: string | null; note?: string | null };
export type EvidenceInput = { kind: "METRIC" | "RECORD"; recordType?: string | null; recordId?: string | null; label: string; value?: string | null };
export type FindingFields = Record<string, unknown>;

export type Op =
  | { type: "create"; key: string; data: FindingFields; events: EventInput[]; evidence: EvidenceInput[]; alert: boolean }
  // fromStatus (LS-002): the status the plan was made from - the store writes the op only if the finding still has
  // it, so a person's tap in the meantime is never overwritten.
  | { type: "update"; key: string; id: string; data: FindingFields; events: EventInput[]; evidence: EvidenceInput[]; alert: boolean; fromStatus?: string };

// cleanup: the one-off cleanup run (lib/findings/store.ts runs it once, LCI_CLEANUP).
export type RunContext = { now: Date; today: string; sydneyDay: (d: Date) => string; cleanup?: boolean };

// ---------- closing (LCI Stage 1) ----------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// The day a dated finding is about (NO_SUPERVISOR, START_NOT_READY, CREW_SHORT: the key's last part), else null.
export function datedDay(dedupeKey: string): string | null {
  const last = dedupeKey.split(":").pop() ?? "";
  return dedupeKey.split(":").length > 3 && ISO_DAY.test(last) ? last : null;
}
// A CRITICAL finding on the Directors screen never closes itself.
const waitsForPerson = (f: FindingState) =>
  f.severity === "CRITICAL" && screenFor({ ruleCode: f.ruleCode, audience: f.audience ?? "" }) === "DIRECTORS";

export type CloseReason = { outcome: "LAPSED" | "RETIRED" | "RULE_CHANGED" | "EFFECTIVE"; why: string; short: string };

// Why an open finding the rule didn't flag this run should close now - or null to leave it open.
export function closeReason(f: FindingState, ctx: RunContext, daysClear: number): CloseReason | null {
  const retired = RETIRED_RULES.get(f.ruleCode);
  if (retired) return { outcome: "RETIRED", why: `Rule retired: ${retired}`, short: "rule retired" };
  const day = datedDay(f.dedupeKey);
  if (day && day < ctx.today) return { outcome: "LAPSED", why: `The day has passed (${day}) - it wasn't fixed in time`, short: "past day" };
  if (waitsForPerson(f)) return null;
  // The cleanup run (LS-004): only a rule Stage 1 changed closes straight away; every other rule the normal way.
  if (ctx.cleanup && CLEANUP_RULES.has(f.ruleCode)) {
    if (f.signalClearedAt) return { outcome: "EFFECTIVE", why: "The problem had already gone - the rule no longer fires", short: "the problem had already gone" };
    return /^DATA_UNCOSTED:PROJECT:[^:]+$/.test(f.dedupeKey)
      ? { outcome: "RULE_CHANGED", why: "Regrouped: one item per resource with no rate, instead of one per project", short: "regrouped by cause" }
      : { outcome: "RULE_CHANGED", why: "The new rule no longer flags it", short: "the new rule no longer flags it" };
  }
  const gone = ctx.cleanup ? "the problem had already gone" : "the rule no longer fires";
  if (FINDINGS_CONFIG.autoResolveSeverities.includes(f.severity)) return { outcome: "EFFECTIVE", why: "The rule no longer fires", short: gone };
  if (f.signalClearedAt && daysClear >= verifyAfterDays(f.ruleCode)) {
    return { outcome: "EFFECTIVE", why: `Clear for ${daysClear} day${daysClear === 1 ? "" : "s"} - the rule no longer fires`, short: gone };
  }
  return null;
}

function closeOp(f: FindingState, r: CloseReason, ctx: RunContext): Op {
  const note = ctx.cleanup ? `${LCI_CLEANUP.prefix}: ${r.short} - ${r.why}` : r.why;
  return {
    type: "update", key: f.dedupeKey, id: f.id,
    data: {
      status: "RESOLVED", openKey: null, resolvedAt: ctx.now, resolvedBy: "System", resolution: note,
      signalClearedAt: f.signalClearedAt ?? ctx.now, resolvedWhileFiring: false,
      outcomeResult: r.outcome === "EFFECTIVE" ? null : r.outcome,
    },
    events: [{ action: "AUTO_RESOLVED", fromValue: f.status, toValue: r.outcome, note }],
    evidence: [], alert: false,
  };
}

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
  const op = planKeyFor(signal, f, ctx);
  return op && op.type === "update" && f ? { ...op, fromStatus: f.status } : op;
}

function planKeyFor(signal: Signal | null, f: FindingState | null, ctx: RunContext): Op | null {
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
        data: { ...base, severity: signal.severity, status: "OPEN", openKey: key, signalClearedAt: null, clearRuns: 0, outcomeResult: null },
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
    const close = closeReason(f, ctx, daysClear);
    if (close) return closeOp(f, close, ctx);
    if (!f.signalClearedAt) {
      const note = waitsForPerson(f)
        ? "The rule no longer fires - a person decides whether it's resolved"
        : `The rule no longer fires - it closes itself after ${verifyAfterDays(f.ruleCode)} day${verifyAfterDays(f.ruleCode) === 1 ? "" : "s"} clear`;
      return { type: "update", key, id: f.id, data: { signalClearedAt: now, clearRuns: 0 }, events: [{ action: "SIGNAL_CLEARED", note }], evidence: [], alert: false };
    }
    return daysClear !== f.clearRuns ? { type: "update", key, id: f.id, data: { clearRuns: daysClear }, events: [], evidence: [], alert: false } : null;
  }
  if (f.status === "RESOLVED") {
    if (!f.signalClearedAt) {
      return { type: "update", key, id: f.id, data: { signalClearedAt: now, clearRuns: 0 }, events: [{ action: "SIGNAL_CLEARED" }], evidence: [], alert: false };
    }
    // A close that isn't a fix (day passed, rule retired or changed) is never verified as effective - and
    // nothing more is written to it (no daily clear-day counting on a closed record).
    if (f.outcomeResult && NOT_A_FIX_OUTCOMES.has(f.outcomeResult)) return null;
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

// notChecked: rule codes not evaluated this run (their source didn't answer,
// e.g. Estimating for won tenders) - their findings are left exactly as they
// are, never treated as "the rule no longer fires".
export function planRun(signals: Signal[], latest: Map<string, FindingState>, ctx: RunContext, notChecked: readonly string[] = []): Op[] {
  const ops: Op[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    if (seen.has(s.dedupeKey)) continue; // one problem, one finding (keys are unique by construction)
    seen.add(s.dedupeKey);
    const op = planKey(s, latest.get(s.dedupeKey) ?? null, ctx);
    if (op) ops.push(op);
  }
  for (const [key, f] of latest) {
    if (seen.has(key) || notChecked.includes(f.ruleCode)) continue;
    const op = planKey(null, f, ctx);
    if (op) ops.push(op);
  }
  return ops;
}

// ---------- LCI Stage 1: the cleanup's counts, and which CRITICAL findings push ----------

export type CleanupCounts = { closed: number; left: number; byRule: Record<string, Record<string, number>> };

// What a cleanup run closed, by rule and reason (the event's toValue: LAPSED / RETIRED / RULE_CHANGED / EFFECTIVE).
export function cleanupCounts(ops: Op[], ruleOf: Map<string, string>, openBefore: number): CleanupCounts {
  const byRule: Record<string, Record<string, number>> = {};
  let closed = 0;
  for (const o of ops) {
    if (o.type !== "update") continue;
    const e = o.events.find((x) => x.action === "AUTO_RESOLVED");
    if (!e) continue;
    closed++;
    const rule = ruleOf.get(o.id) ?? o.key.split(":")[0];
    const reason = String(e.toValue ?? "EFFECTIVE");
    byRule[rule] = { ...(byRule[rule] ?? {}), [reason]: (byRule[rule]?.[reason] ?? 0) + 1 };
  }
  const opened = ops.filter((o) => o.type === "create" && OPENISH.includes(String(o.data.status) as FindingStatus)).length;
  return { closed, left: openBefore - closed + opened, byRule };
}

// Which new / escalated / reopened CRITICAL findings push: Directors-screen
// kinds as before; Operations-screen kinds too since LCI Stage 1 (Decision 5:
// CRITICAL only, to the owner only), except a kind whose own module already
// alerts, and not while LCI_PUSH=off (pushOn false).
export function alertsDue(ops: Op[], pushOn: boolean): Op[] {
  return ops.filter((o) => {
    if (!o.alert) return false;
    const ruleCode = String(o.data.ruleCode ?? o.key.split(":")[0]);
    if (screenFor({ ruleCode, audience: String(o.data.audience ?? "") }) === "DIRECTORS") return true;
    return pushOn && !MODULE_ALERTED_KINDS.has(ruleCode);
  });
}

// LS-004: is the one-off cleanup due this run? Not done yet, not switched off, and today (Sydney) no later than
// the label date + its window. "LATE" = past the window: skipped (the store logs it once).
export function cleanupDue(today: string, done: boolean, on: boolean): "RUN" | "DONE" | "OFF" | "LATE" {
  if (done) return "DONE";
  if (!on) return "OFF";
  return today <= addDays(LCI_CLEANUP.label, LCI_CLEANUP.windowDays) ? "RUN" : "LATE";
}

// LS-003: the phone messages for one run's due alerts. Directors-screen ones one each, as before; Operations-screen
// ones at most MAX_OPS_PUSHES_PER_RUN one each, and any more as one summary - words only, never a dollar figure.
export type PushMessage = { title: string; body: string; url: string; tag: string };
export function pushMessages(due: Op[], today: string): PushMessage[] {
  const out: PushMessage[] = [];
  const ops: Op[] = [];
  for (const o of due) {
    const ruleCode = String(o.data.ruleCode ?? o.key.split(":")[0]);
    const raw = String(o.data.title ?? "Critical finding");
    if (screenFor({ ruleCode, audience: String(o.data.audience ?? "") }) === "DIRECTORS") {
      out.push({ title: `🔴 Critical: ${raw}`.slice(0, 120), body: "Needs attention - Directors", url: "/directors", tag: `finding-${o.key}` });
    } else ops.push(o);
  }
  for (const o of ops.slice(0, MAX_OPS_PUSHES_PER_RUN)) {
    const raw = String(o.data.title ?? "Critical finding");
    const title = assertNoMoney(raw) ? raw : "Something needs attention on your board"; // never a $ on an Operations push
    out.push({ title: `🔴 Critical: ${title}`.slice(0, 120), body: "Needs attention - on your board", url: "/command", tag: `finding-${o.key}` });
  }
  const rest = ops.length - MAX_OPS_PUSHES_PER_RUN;
  if (rest > 0) out.push({ title: `🔴 ${rest} critical item${rest === 1 ? "" : "s"} need${rest === 1 ? "s" : ""} attention on your board`, body: "Open the Needs attention card", url: "/command", tag: `findings-summary-${today}` });
  return out;
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
