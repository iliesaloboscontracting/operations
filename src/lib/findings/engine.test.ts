// Findings engine tests (24 Oct 2026): runs simulated over days against an
// in-memory store - first run, re-run, material change, escalation, clear,
// auto-resolve, verify after 1 / 2 / 7 days, not fixed, recurrence inside and
// after 30 days, resolved-while-firing, dismissals. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Signal, SignalKind } from "./signals";
import { alertsDue, cleanupCounts, datedDay, isMaterialChange, latestByKey, planKey, planRun, summarise, type FindingState, type Op } from "./engine";
import { FINDINGS_CONFIG, verifyAfterDays } from "./config";

// ---------- an in-memory store that applies the plan like store.ts ----------

type Row = FindingState & { openKey: string | null; createdAt: Date; reopenedFromId?: string | null; outcomeResult?: string | null; title?: string; events: string[]; evidence: number; notes?: string[] };
class Store {
  rows: Row[] = [];
  private n = 0;
  run(signals: Signal[], day: string, hour = 9, cleanup = false): Op[] {
    const now = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+11:00`);
    const ops = planRun(signals, latestByKey(this.rows), { now, today: day, cleanup, sydneyDay: (d) => new Date(d.getTime() + 11 * 3_600_000).toISOString().slice(0, 10) });
    for (const op of ops) {
      if (op.type === "create") {
        if (this.rows.some((r) => r.openKey && r.openKey === op.data.openKey)) throw new Error(`unique openKey broken: ${op.data.openKey}`);
        this.rows.push({
          id: `f${++this.n}`, dedupeKey: String(op.data.dedupeKey), ruleCode: String(op.data.ruleCode), severity: op.data.severity as Row["severity"],
          status: "OPEN", currentValue: String(op.data.currentValue), signalClearedAt: null, clearRuns: 0, resolvedWhileFiring: false, resolvedAt: null,
          verifiedAt: null, dismissKind: null, suppressUntil: null, seenCount: 1, openKey: String(op.data.openKey), createdAt: now,
          reopenedFromId: (op.data.reopenedFromId as string | null) ?? null, title: String(op.data.title), events: op.events.map((e) => e.action), evidence: op.evidence.length,
          audience: String(op.data.audience), notes: op.events.map((e) => e.note ?? ""),
        });
      } else {
        const r = this.rows.find((x) => x.id === op.id)!;
        if (op.data.openKey && this.rows.some((x) => x !== r && x.openKey === op.data.openKey)) throw new Error(`unique openKey broken: ${op.data.openKey}`);
        Object.assign(r, op.data);
        r.events.push(...op.events.map((e) => e.action));
        (r.notes ??= []).push(...op.events.map((e) => e.note ?? ""));
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

test("MEDIUM+ stays open while inside its clear window: signal cleared; it can come back", () => {
  const s = new Store();
  s.run([sig("COST_VS_CONTRACT", "a", "MEDIUM")], "2026-10-24", 9);
  s.run([], "2026-10-24", 10);
  assert.equal(s.rows[0].status, "OPEN");
  assert.ok(s.rows[0].signalClearedAt);
  s.run([], "2026-10-27", 9);
  assert.equal(s.rows[0].status, "OPEN"); // 3 days of cost's 7 - still open (LCI Stage 1 closes it at 7)
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

// ---------- LCI Stage 1 (25 Nov 2026): auto-close, dated close, retired rules, the cleanup ----------

const dated = (kind: SignalKind, id: string, day: string, severity: Signal["severity"] = "CRITICAL"): Signal => ({
  ...sig(kind, id, severity, { date: day }), audience: "OPERATIONAL", dedupeKey: `${kind}:PROJECT:${id}:${day}`,
});

test("auto-close, every severity: once clear for the rule's window it resolves itself, logged with the reason, then verifies", () => {
  for (const [kind, sev, window] of [["HIRE_OVERDUE", "HIGH", 2], ["DATE_START_MISMATCH", "MEDIUM", 1], ["COST_VS_CONTRACT", "MEDIUM", 7], ["DAYS_NOT_CLOSED", "HIGH", 1]] as const) {
    const s = new Store();
    s.run([sig(kind, "a", sev)], "2026-11-02", 9);
    s.run([], "2026-11-02", 10); // signal cleared
    assert.equal(s.rows[0].status, "OPEN", `${kind}: still open on the day it cleared`);
    assert.match(s.rows[0].notes!.at(-1)!, /closes itself after/);
    const closeDay = `2026-11-${String(2 + window).padStart(2, "0")}`;
    const dayBefore = `2026-11-${String(1 + window).padStart(2, "0")}`;
    s.run([], dayBefore, 9);
    assert.equal(s.rows[0].status, "OPEN", `${kind}: not before ${window} days`);
    s.run([], closeDay, 9);
    assert.equal(s.rows[0].status, "RESOLVED", `${kind}: closes after ${window} days clear`);
    assert.equal(s.rows[0].openKey, null);
    assert.equal(s.rows[0].events.at(-1), "AUTO_RESOLVED");
    assert.match(s.rows[0].notes!.at(-1)!, /Clear for \d+ days? - the rule no longer fires/);
    s.run([], closeDay, 10);
    assert.equal(s.rows[0].status, "VERIFIED", `${kind}: verified as before`);
    assert.equal(s.rows.length, 1); // nothing deleted, nothing duplicated
  }
});

test("a CRITICAL Directors-screen finding still waits for a person", () => {
  const s = new Store();
  s.run([sig("COST_VS_CONTRACT", "a", "CRITICAL")], "2026-11-01", 9);
  s.run([], "2026-11-01", 10);
  s.run([], "2026-11-20", 9);
  assert.equal(s.rows[0].status, "OPEN");
  s.run([], "2026-11-20", 10, true); // not even the cleanup
  assert.equal(s.rows[0].status, "OPEN");
  // An Operations-screen CRITICAL one closes as usual.
  const o = new Store();
  o.run([{ ...sig("START_NOT_READY", "b", "CRITICAL"), audience: "OPERATIONAL" }], "2026-11-01", 9);
  o.run([], "2026-11-01", 10);
  o.run([], "2026-11-02", 9);
  assert.equal(o.rows[0].status, "RESOLVED");
});

test("a dated finding closes once its day has passed - LAPSED (not a fix), never verified, nothing more written", () => {
  const s = new Store();
  s.run([dated("NO_SUPERVISOR", "p", "2026-11-20")], "2026-11-19", 9);
  s.run([], "2026-11-20", 9); // the day itself: the gap list no longer has it (it's today) - signal cleared, still open
  assert.equal(s.rows[0].status, "OPEN");
  const ops = s.run([], "2026-11-21", 9);
  assert.equal(s.rows[0].status, "RESOLVED");
  assert.equal(s.rows[0].outcomeResult, "LAPSED");
  assert.equal(ops[0].events[0].toValue, "LAPSED");
  assert.match(s.rows[0].notes!.at(-1)!, /The day has passed \(2026-11-20\) - it wasn't fixed in time/);
  assert.deepEqual(s.run([], "2026-11-25", 9), []); // never verified, no daily writes
  assert.equal(s.rows[0].status, "RESOLVED");
  assert.equal(datedDay("NO_SUPERVISOR:PROJECT:p:2026-11-20"), "2026-11-20");
  assert.equal(datedDay("CREW_SHORT:COMPANY:crew:2026-11-20"), "2026-11-20");
  assert.equal(datedDay("NO_SUPERVISOR:JOB:j2"), null);
  assert.equal(datedDay("TIP_DOCKET_UNINVOICED:PROJECT:p:cmx1"), null);
});

test("a retired rule's finding closes as RETIRED with the reason, whatever its severity or window", () => {
  const s = new Store();
  s.run([{ ...sig("DATE_INACTIVE_HAS_JOBS", "p", "MEDIUM"), audience: "OPERATIONAL" }], "2026-11-20", 9);
  s.run([], "2026-11-20", 10);
  assert.equal(s.rows[0].status, "RESOLVED");
  assert.equal(s.rows[0].outcomeResult, "RETIRED");
  assert.match(s.rows[0].notes!.at(-1)!, /^Rule retired: inactive with jobs booked is normal/);
  assert.deepEqual(s.run([], "2026-11-24", 9), []);
});

test("the cleanup run closes every open finding the new rules no longer flag, each with 'Closed in the 25 Nov cleanup: <reason>'", () => {
  const s = new Store();
  // 20 Nov: five problems open.
  s.run([
    dated("NO_SUPERVISOR", "p", "2026-11-21"),
    { ...sig("DATE_INACTIVE_HAS_JOBS", "q", "MEDIUM"), audience: "OPERATIONAL" },
    { ...sig("DATE_START_MISMATCH", "r", "MEDIUM"), audience: "OPERATIONAL" },
    { ...sig("DATE_COMPLETED_HAS_JOBS", "t", "MEDIUM"), audience: "OPERATIONAL" },
    sig("DATA_UNCOSTED", "u"), // old per-project key
    { ...sig("HIRE_OVERDUE", "h", "HIGH"), audience: "OPERATIONAL" },
    sig("COST_VS_CONTRACT", "x", "CRITICAL"),
  ], "2026-11-20", 9);
  // 24 Nov: the completed-has-jobs problem went away (signal cleared, but before the new auto-close existed it waited).
  s.run(([
    dated("NO_SUPERVISOR", "p", "2026-11-21"), { ...sig("DATE_START_MISMATCH", "r", "MEDIUM"), audience: "OPERATIONAL" },
    sig("DATA_UNCOSTED", "u"), { ...sig("HIRE_OVERDUE", "h", "HIGH"), audience: "OPERATIONAL" }, sig("COST_VS_CONTRACT", "x", "CRITICAL"),
    { ...sig("DATE_INACTIVE_HAS_JOBS", "q", "MEDIUM"), audience: "OPERATIONAL" },
  ] as Signal[]).filter((x) => x.kind !== "NO_SUPERVISOR"), "2026-11-20", 10);
  const before = s.rows.length;
  // 25 Nov, the cleanup run: the new rules still flag the hire item and the cost one only.
  const ops = s.run([{ ...sig("HIRE_OVERDUE", "h", "HIGH"), audience: "OPERATIONAL" }, sig("COST_VS_CONTRACT", "x", "CRITICAL")], "2026-11-25", 9, true);
  const counts = cleanupCounts(ops, new Map(s.rows.map((r) => [r.id, r.ruleCode])), 7);
  const by = (k: string) => s.rows.find((r) => r.dedupeKey.startsWith(k))!;
  assert.equal(s.rows.length, before, "nothing deleted, nothing new");
  assert.equal(by("NO_SUPERVISOR").outcomeResult, "LAPSED");
  assert.equal(by("DATE_INACTIVE_HAS_JOBS").outcomeResult, "RETIRED");
  assert.equal(by("DATE_START_MISMATCH").outcomeResult, "RULE_CHANGED");
  assert.equal(by("DATA_UNCOSTED").outcomeResult, "RULE_CHANGED");
  assert.ok(!by("DATE_COMPLETED_HAS_JOBS").outcomeResult, "already gone: an ordinary close (verified later)");
  assert.equal(by("DATE_COMPLETED_HAS_JOBS").status, "RESOLVED");
  for (const k of ["NO_SUPERVISOR", "DATE_INACTIVE_HAS_JOBS", "DATE_START_MISMATCH", "DATA_UNCOSTED", "DATE_COMPLETED_HAS_JOBS"]) {
    assert.match(by(k).notes!.at(-1)!, /^Closed in the 25 Nov cleanup: (past day|rule retired|the new rule no longer flags it|regrouped by cause|the problem had already gone) - /, k);
  }
  assert.match(by("NO_SUPERVISOR").notes!.at(-1)!, /^Closed in the 25 Nov cleanup: past day/);
  assert.match(by("DATE_INACTIVE_HAS_JOBS").notes!.at(-1)!, /^Closed in the 25 Nov cleanup: rule retired/);
  assert.equal(by("HIRE_OVERDUE").status, "OPEN", "still flagged: stays open");
  assert.equal(by("COST_VS_CONTRACT").status, "OPEN", "a Directors CRITICAL: stays for a person");
  assert.equal(counts.closed, 5);
  assert.deepEqual(counts.byRule.NO_SUPERVISOR, { LAPSED: 1 });
  assert.equal(counts.left, 2);
  // A later ordinary run doesn't touch the cleanup's closes (no daily writes, never "verified").
  const later = s.run([{ ...sig("HIRE_OVERDUE", "h", "HIGH"), audience: "OPERATIONAL" }, sig("COST_VS_CONTRACT", "x", "CRITICAL")], "2026-11-27", 9);
  assert.ok(later.every((o) => o.type === "update" && o.id !== by("NO_SUPERVISOR").id && o.id !== by("DATE_START_MISMATCH").id));
  assert.equal(by("DATE_COMPLETED_HAS_JOBS").status, "VERIFIED");
});

test("a cleanup close that fires again reopens (NOT_FIXED) and its outcome is cleared", () => {
  const s = new Store();
  s.run([{ ...sig("DATE_START_MISMATCH", "r", "MEDIUM"), audience: "OPERATIONAL" }], "2026-11-20", 9);
  s.run([], "2026-11-25", 9, true);
  assert.equal(s.rows[0].outcomeResult, "RULE_CHANGED");
  s.run([{ ...sig("DATE_START_MISMATCH", "r", "MEDIUM"), audience: "OPERATIONAL" }], "2026-11-26", 9);
  assert.equal(s.rows[0].status, "OPEN");
  assert.equal(s.rows[0].outcomeResult, null);
});

test("pushes: CRITICAL only; Directors-screen always, Operations-screen unless LCI_PUSH is off or its module already alerts", () => {
  const s = new Store();
  const ops = s.run([{ ...sig("NO_SUPERVISOR", "a", "CRITICAL"), audience: "OPERATIONAL" }, sig("COST_VS_CONTRACT", "b", "CRITICAL"), { ...sig("HIRE_OVERDUE", "h", "HIGH"), audience: "OPERATIONAL" }], "2026-11-25");
  assert.deepEqual(alertsDue(ops, true).map((o) => o.key).sort(), ["COST_VS_CONTRACT:PROJECT:b", "NO_SUPERVISOR:PROJECT:a"]);
  assert.deepEqual(alertsDue(ops, false).map((o) => o.key), ["COST_VS_CONTRACT:PROJECT:b"]);
  // The same finding next run: no second alert.
  assert.deepEqual(alertsDue(s.run([{ ...sig("NO_SUPERVISOR", "a", "CRITICAL"), audience: "OPERATIONAL" }, sig("COST_VS_CONTRACT", "b", "CRITICAL")], "2026-11-25", 10), true), []);
});