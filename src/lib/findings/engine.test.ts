// Findings engine tests (24 Oct 2026): runs simulated over days against an
// in-memory store - first run, re-run, material change, escalation, clear,
// auto-resolve, verify after 1 / 2 / 7 days, not fixed, recurrence inside and
// after 30 days, resolved-while-firing, dismissals. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Signal, SignalKind } from "./signals";
import { isMaterialChange, latestByKey, planKey, planRun, summarise, type FindingState, type Op } from "./engine";
import { FINDINGS_CONFIG, verifyAfterDays } from "./config";

// ---------- an in-memory store that applies the plan like store.ts ----------

type Row = FindingState & { openKey: string | null; createdAt: Date; reopenedFromId?: string | null; outcomeResult?: string | null; title?: string; events: string[]; evidence: number };
class Store {
  rows: Row[] = [];
  private n = 0;
  run(signals: Signal[], day: string, hour = 9): Op[] {
    const now = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+11:00`);
    const ops = planRun(signals, latestByKey(this.rows), { now, today: day, sydneyDay: (d) => new Date(d.getTime() + 11 * 3_600_000).toISOString().slice(0, 10) });
    for (const op of ops) {
      if (op.type === "create") {
        if (this.rows.some((r) => r.openKey && r.openKey === op.data.openKey)) throw new Error(`unique openKey broken: ${op.data.openKey}`);
        this.rows.push({
          id: `f${++this.n}`, dedupeKey: String(op.data.dedupeKey), ruleCode: String(op.data.ruleCode), severity: op.data.severity as Row["severity"],
          status: "OPEN", currentValue: String(op.data.currentValue), signalClearedAt: null, clearRuns: 0, resolvedWhileFiring: false, resolvedAt: null,
          verifiedAt: null, dismissKind: null, suppressUntil: null, seenCount: 1, openKey: String(op.data.openKey), createdAt: now,
          reopenedFromId: (op.data.reopenedFromId as string | null) ?? null, title: String(op.data.title), events: op.events.map((e) => e.action), evidence: op.evidence.length,
        });
      } else {
        const r = this.rows.find((x) => x.id === op.id)!;
        if (op.data.openKey && this.rows.some((x) => x !== r && x.openKey === op.data.openKey)) throw new Error(`unique openKey broken: ${op.data.openKey}`);
        Object.assign(r, op.data);
        r.events.push(...op.events.map((e) => e.action));
        r.evidence += op.evidence.length;
      }
    }
    return ops;
  }
  byKey(key: string) { return this.rows.filter((r) => r.dedupeKey === key); }
  open() { return this.rows.filter((r) => r.openKey); }
}

const sig = (kind: SignalKind, id: string, severity: Signal["severity"] = "INFO", values: Signal["values"] = { n: 1 }): Signal => ({
  kind, subject: { type: "PROJECT", id, name: `Job ${id}` }, projectId: id, dedupeKey: `${kind}:PROJECT:${id}`,
  severity, audience: "COMMERCIAL", title: `${kind} on ${id}`, provisional: false, confidence: null,
  evidence: [{ recordType: "Project", recordId: id, label: `Job ${id}` }], values, href: null,
});

// ---------- settings ----------

test("settings: verify windows 1 / 2 / 7 days, 30-day recurrence, CRITICAL to the owner only", () => {
  assert.equal(verifyAfterDays("DATA_UNCOSTED"), 1);
  assert.equal(verifyAfterDays("DATE_START_MISMATCH"), 1);
  assert.equal(verifyAfterDays("START_NOT_READY"), 1);
  assert.equal(verifyAfterDays("DAYS_NOT_CLOSED"), 1);
  assert.equal(verifyAfterDays("HIRE_OVERDUE"), 2);
  assert.equal(verifyAfterDays("CREW_SHORT"), 2);
  assert.equal(verifyAfterDays("COST_VS_CONTRACT"), 7);
  assert.equal(FINDINGS_CONFIG.recurrenceWindowDays, 30);
  assert.deepEqual(FINDINGS_CONFIG.criticalAlertRecipients, ["iliesa@loboscontracting.com.au"]);
  assert.deepEqual(FINDINGS_CONFIG.pushSeverities, ["CRITICAL"]);
});

// ---------- first run and re-run ----------

test("first run: one finding per signal, OPENED with evidence", () => {
  const s = new Store();
  const ops = s.run([sig("DATA_UNCOSTED", "a"), sig("DATA_UNCOSTED", "b"), sig("COST_VS_CONTRACT", "a", "MEDIUM", { pctOfContract: 0.85 })], "2026-10-24");
  assert.equal(summarise(ops).created, 3);
  assert.equal(s.open().length, 3);
  assert.deepEqual(s.rows[0].events, ["OPENED"]);
  assert.equal(s.rows[0].evidence, 2); // measured values + the project record
});

test("re-run with the same signals: no new findings, no events, no new evidence", () => {
  const s = new Store();
  const signals = [sig("DATA_UNCOSTED", "a"), sig("HIRE_OVERDUE", "h", "HIGH")];
  s.run(signals, "2026-10-24", 9);
  const ops = s.run(signals, "2026-10-24", 10);
  const sum = summarise(ops);
  assert.equal(sum.created, 0);
  assert.equal(sum.events, 0);
  assert.equal(sum.evidence, 0);
  assert.equal(s.rows.length, 2);
  assert.ok(s.rows.every((r) => r.seenCount === 2));
});

test("evidence only on a material change", () => {
  assert.equal(isMaterialChange({ pctOfContract: 0.85 }, { pctOfContract: 0.88 }), false); // 3 points
  assert.equal(isMaterialChange({ pctOfContract: 0.85 }, { pctOfContract: 0.9 }), true); // 5 points
  assert.equal(isMaterialChange({ uncosted: 20 }, { uncosted: 20.5 }), false);
  assert.equal(isMaterialChange({ uncosted: 20 }, { uncosted: 21 }), true);
  assert.equal(isMaterialChange({ offHireDate: "2026-10-20" }, { offHireDate: "2026-10-27" }), true);
  assert.equal(isMaterialChange({ a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(isMaterialChange(null, { a: 1 }), true);
  const s = new Store();
  s.run([sig("DATA_UNCOSTED", "a", "INFO", { uncosted: 20 })], "2026-10-24", 9);
  s.run([sig("DATA_UNCOSTED", "a", "INFO", { uncosted: 20 })], "2026-10-24", 10);
  assert.equal(s.rows[0].evidence, 2);
  s.run([sig("DATA_UNCOSTED", "a", "INFO", { uncosted: 25 })], "2026-10-24", 11);
  assert.equal(s.rows[0].evidence, 3);
});

test("escalation and de-escalation are recorded; only escalation to CRITICAL alerts", () => {
  const s = new Store();
  s.run([sig("COST_VS_CONTRACT", "a", "MEDIUM", { pctOfContract: 0.85 })], "2026-10-24");
  const up = s.run([sig("COST_VS_CONTRACT", "a", "CRITICAL", { pctOfContract: 1.04 })], "2026-10-25");
  assert.equal(up[0].alert, true);
  const down = s.run([sig("COST_VS_CONTRACT", "a", "MEDIUM", { pctOfContract: 0.95 })], "2026-10-26");
  assert.equal(down[0].alert, false);
  assert.deepEqual(s.rows[0].events, ["OPENED", "ESCALATED", "DEESCALATED"]);
  assert.equal(s.rows.length, 1);
});

test("a new CRITICAL finding alerts; a new MEDIUM one doesn't", () => {
  const s = new Store();
  const ops = s.run([sig("START_NOT_READY", "a", "CRITICAL"), sig("DATE_START_MISMATCH", "b", "MEDIUM")], "2026-10-24");
  assert.deepEqual(ops.map((o) => o.alert), [true, false]);
});

// ---------- signal clears ----------

test("INFO auto-resolves when the rule stops, then verifies after 1 day (data gaps)", () => {
  const s = new Store();
  s.run([sig("DATA_NO_CONTRACT_VALUE", "a")], "2026-10-24", 9);
  s.run([], "2026-10-24", 10);
  assert.equal(s.rows[0].status, "RESOLVED");
  assert.equal(s.rows[0].openKey, null);
  s.run([], "2026-10-24", 15); // same day - not yet
  assert.equal(s.rows[0].status, "RESOLVED");
  s.run([], "2026-10-25", 9);
  assert.equal(s.rows[0].status, "VERIFIED");
  assert.deepEqual(s.rows[0].events, ["OPENED", "AUTO_RESOLVED", "VERIFIED"]);
});

test("hire: verified only after 2 days clear", () => {
  const s = new Store();
  s.run([sig("HIRE_NO_FINISH", "h")], "2026-10-24", 9);
  s.run([], "2026-10-24", 10);
  s.run([], "2026-10-25", 9);
  assert.equal(s.rows[0].status, "RESOLVED");
  s.run([], "2026-10-26", 9);
  assert.equal(s.rows[0].status, "VERIFIED");
});

test("MEDIUM+ never closes itself: signal cleared, stays open; it can come back", () => {
  const s = new Store();
  s.run([sig("COST_VS_CONTRACT", "a", "MEDIUM")], "2026-10-24", 9);
  s.run([], "2026-10-24", 10);
  assert.equal(s.rows[0].status, "OPEN");
  assert.ok(s.rows[0].signalClearedAt);
  s.run([], "2026-10-27", 9);
  assert.equal(s.rows[0].status, "OPEN"); // a person decides
  assert.equal(s.rows[0].clearRuns, 3);
  s.run([sig("COST_VS_CONTRACT", "a", "MEDIUM")], "2026-10-28", 9);
  assert.equal(s.rows[0].signalClearedAt, null);
  assert.deepEqual(s.rows[0].events, ["OPENED", "SIGNAL_CLEARED", "SIGNAL_RETURNED"]);
});

test("cost: resolved by a person once clear, verified only after 7 days clear", () => {
  const s = new Store();
  s.run([sig("COST_VS_CONTRACT", "a", "MEDIUM")], "2026-10-24", 9);
  s.run([], "2026-10-24", 10); // signal cleared
  Object.assign(s.rows[0], { status: "RESOLVED", openKey: null, resolvedAt: new Date("2026-10-24T05:00:00Z"), resolvedWhileFiring: false });
  s.run([], "2026-10-30", 9); // 6 days
  assert.equal(s.rows[0].status, "RESOLVED");
  s.run([], "2026-10-31", 9); // 7 days
  assert.equal(s.rows[0].status, "VERIFIED");
});

test("not fixed: fires again before verification -> back to Open on the same finding", () => {
  const s = new Store();
  s.run([sig("DATA_UNCOSTED", "a")], "2026-10-24", 9);
  s.run([], "2026-10-24", 10); // auto-resolved
  const ops = s.run([sig("DATA_UNCOSTED", "a")], "2026-10-24", 11);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].status, "OPEN");
  assert.equal(s.rows[0].openKey, "DATA_UNCOSTED:PROJECT:a");
  assert.ok(ops[0].events.some((e) => e.action === "NOT_FIXED"));
});

test("resolved by a person while still firing: never auto-verified", () => {
  const s = new Store();
  s.run([sig("HIRE_OVERDUE", "h", "HIGH")], "2026-10-24", 9);
  Object.assign(s.rows[0], { status: "RESOLVED", openKey: null, resolvedAt: new Date("2026-10-24T00:00:00Z"), resolvedWhileFiring: true });
  s.run([sig("HIRE_OVERDUE", "h", "HIGH")], "2026-10-24", 10); // still firing: their call, stays resolved
  assert.equal(s.rows[0].status, "RESOLVED");
  s.run([], "2026-10-25", 9);
  s.run([], "2026-11-10", 9); // clear for weeks
  assert.equal(s.rows[0].status, "RESOLVED"); // a person verifies
  assert.equal(s.rows.length, 1);
});

// ---------- recurrence ----------

test("recurs within 30 days of verification -> the same finding reopens", () => {
  const s = new Store();
  s.run([sig("DATA_UNCOSTED", "a")], "2026-10-01");
  s.run([], "2026-10-01", 12);
  s.run([], "2026-10-02"); // verified
  assert.equal(s.rows[0].status, "VERIFIED");
  s.run([sig("DATA_UNCOSTED", "a")], "2026-10-30"); // 28 days later
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].status, "OPEN");
  assert.equal(s.rows[0].outcomeResult, "RECURRED");
  assert.ok(s.rows[0].events.includes("RECURRED"));
});

test("after 30 days -> a new finding, linked to the old one", () => {
  const s = new Store();
  s.run([sig("DATA_UNCOSTED", "a")], "2026-10-01");
  s.run([], "2026-10-01", 12);
  s.run([], "2026-10-02"); // verified 2 Oct
  s.run([sig("DATA_UNCOSTED", "a")], "2026-11-05"); // 34 days later
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].status, "VERIFIED");
  assert.equal(s.rows[1].status, "OPEN");
  assert.equal(s.rows[1].reopenedFromId, s.rows[0].id);
  assert.equal(s.open().length, 1);
});

// ---------- dismissals ----------

test("accepted risk stays quiet until its date, unless the severity rises", () => {
  const s = new Store();
  s.run([sig("HIRE_OVERDUE", "h", "HIGH")], "2026-10-24");
  Object.assign(s.rows[0], { status: "DISMISSED", openKey: null, dismissKind: "ACCEPTED_RISK", suppressUntil: "2026-11-01" });
  s.run([sig("HIRE_OVERDUE", "h", "HIGH")], "2026-10-28");
  assert.equal(s.rows.length, 1);
  s.run([sig("HIRE_OVERDUE", "h", "CRITICAL")], "2026-10-29"); // got worse
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[1].reopenedFromId, s.rows[0].id);
});

test("accepted risk comes back after its date", () => {
  const s = new Store();
  s.run([sig("HIRE_OVERDUE", "h", "HIGH")], "2026-10-24");
  Object.assign(s.rows[0], { status: "DISMISSED", openKey: null, dismissKind: "ACCEPTED_RISK", suppressUntil: "2026-11-01" });
  s.run([sig("HIRE_OVERDUE", "h", "HIGH")], "2026-11-02");
  assert.equal(s.rows.length, 2);
});

test("false alarm: quiet while it keeps firing; new only after the rule has stopped once", () => {
  const s = new Store();
  s.run([sig("DATE_START_MISMATCH", "a", "MEDIUM")], "2026-10-24");
  Object.assign(s.rows[0], { status: "DISMISSED", openKey: null, dismissKind: "FALSE_ALARM" });
  s.run([sig("DATE_START_MISMATCH", "a", "MEDIUM")], "2026-10-25");
  assert.equal(s.rows.length, 1);
  s.run([], "2026-10-26"); // stopped
  s.run([sig("DATE_START_MISMATCH", "a", "MEDIUM")], "2026-10-27"); // a genuinely new occurrence
  assert.equal(s.rows.length, 2);
});

// ---------- bookkeeping ----------

test("latestByKey prefers the open finding, else the most recent", () => {
  const base = { ruleCode: "X", severity: "INFO" as const, currentValue: null, signalClearedAt: null, clearRuns: 0, resolvedWhileFiring: false, resolvedAt: null, verifiedAt: null, dismissKind: null, suppressUntil: null, seenCount: 1 };
  const m = latestByKey([
    { ...base, id: "old", dedupeKey: "k", status: "VERIFIED", createdAt: new Date("2026-09-01") },
    { ...base, id: "open", dedupeKey: "k", status: "OPEN", createdAt: new Date("2026-08-01") },
    { ...base, id: "a", dedupeKey: "j", status: "VERIFIED", createdAt: new Date("2026-09-01") },
    { ...base, id: "b", dedupeKey: "j", status: "VERIFIED", createdAt: new Date("2026-10-01") },
  ]);
  assert.equal(m.get("k")!.id, "open");
  assert.equal(m.get("j")!.id, "b");
});

test("never two open findings for one problem, across a month of runs", () => {
  const s = new Store();
  const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  for (const [i, d] of days.entries()) {
    const firing = i % 3 !== 1; // on, off, on ...
    s.run(firing ? [sig("DATA_UNCOSTED", "a"), sig("HIRE_IDLE", "h", "MEDIUM")] : [], d); // the store throws if openKey uniqueness breaks
  }
  for (const key of ["DATA_UNCOSTED:PROJECT:a", "HIRE_IDLE:PROJECT:h"]) assert.ok(s.byKey(key).filter((r) => r.openKey).length <= 1);
});

test("planKey with nothing stored and no signal does nothing", () => {
  assert.equal(planKey(null, null, { now: new Date(), today: "2026-10-24", sydneyDay: () => "2026-10-24" }), null);
});
