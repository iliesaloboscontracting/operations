// Budget approval rules (Task H, 25 Oct 2026): who decides, what a decision
// needs, the approval key, and how Estimating's answers are passed on.
// `npm test`. The full round trip against a copy of Estimating is checked
// separately (scratchpad budgetflow).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalSecret, cannotDecide, decisionOutcome, hoursByCategory, parseDecision, parseRevision,
  sortForDirectors, validEstimateId, type BudgetListItem, type BudgetPackage,
} from "./rules";

const sub = { status: "SUBMITTED", submitted_by: "Iliesa" };

test("directors decide; nobody else; never the submitter; only a submitted revision", () => {
  assert.equal(cannotDecide({ name: "Yoel", directorAccess: true }, sub), null);
  assert.equal(cannotDecide({ name: "Nick", directorAccess: true }, sub), null);
  assert.match(cannotDecide({ name: "Alex", directorAccess: false }, sub)!, /Only directors/);
  assert.match(cannotDecide({ name: " iliesa ", directorAccess: true }, sub)!, /You submitted/); // the owner views, decides only others' budgets
  assert.match(cannotDecide({ name: "Yoel", directorAccess: true }, { ...sub, status: "APPROVED" })!, /approved/);
  assert.match(cannotDecide({ name: "Yoel", directorAccess: true }, { ...sub, status: "SUPERSEDED" })!, /superseded/);
});

test("a decision is approve or reject; a rejection needs a reason", () => {
  assert.deepEqual(parseDecision({ decision: "approved", reason: "" }), { decision: "APPROVED", reason: "", version: undefined });
  assert.ok("error" in parseDecision({ decision: "MAYBE" }));
  assert.ok("error" in parseDecision({}));
  assert.ok("error" in parseDecision({ decision: "REJECTED", reason: " " }));
  assert.deepEqual(parseDecision({ decision: "REJECTED", reason: "Labour too light", version: 1 }), { decision: "REJECTED", reason: "Labour too light", version: 1 });
  assert.ok("error" in parseDecision({ decision: "APPROVED", version: "x" }));
});

test("the approval key counts as set only at 16+ characters (Estimating's rule)", () => {
  assert.equal(approvalSecret({}), null);
  assert.equal(approvalSecret({ BUDGET_APPROVAL_SECRET: "short" }), null);
  assert.equal(approvalSecret({ BUDGET_APPROVAL_SECRET: "x".repeat(16) }), "x".repeat(16));
});

test("Estimating's answers: recorded, refusals passed through (stale 409 included), key problems never blamed on the director", () => {
  assert.equal(decisionOutcome(200, {}).outcome, "RECORDED");
  const stale = decisionOutcome(409, { error: "This budget revision changed since it was read. Reload it.", code: "stale" });
  assert.deepEqual([stale.outcome, stale.httpStatus], ["REFUSED", 409]);
  assert.match(stale.message!, /changed since it was read/);
  const key = decisionOutcome(403, { error: "Budget decisions are recorded by the Operations server only.", code: "approval-secret" });
  assert.deepEqual([key.outcome, key.httpStatus], ["FAILED", 502]);
  assert.match(key.message!, /keys don't match/);
  assert.equal(decisionOutcome(500, null).outcome, "FAILED");
});

test("path pieces: estimate ids and revisions as Estimating accepts them", () => {
  assert.equal(validEstimateId("dx27rxi777"), true);
  assert.equal(validEstimateId("../etc"), false);
  assert.equal(parseRevision("3"), 3);
  assert.equal(parseRevision("r12"), 12);
  assert.equal(parseRevision("r"), null);
  assert.equal(parseRevision("12345"), null);
});

test("hours per category add up across priced packages only", () => {
  const pk = (priced: boolean, by: Record<string, number>) => ({ priced, hours: priced ? { labour_hrs: 0, plant_hrs: 0, truck_hrs: 0, by_category: by } : null }) as unknown as BudgetPackage;
  assert.deepEqual(hoursByCategory([pk(true, { "01": 64, "02": 32 }), pk(true, { "01": 16 }), pk(false, {})]), { "01": 80, "02": 32 });
});

test("waiting budgets come first, oldest first; the rest newest first", () => {
  const row = (estimate_id: string, status: string, instant: string) => ({ estimate_id, status, submitted_at: { date: "", instant } }) as BudgetListItem;
  const out = sortForDirectors([row("a", "APPROVED", "2026-10-20"), row("b", "SUBMITTED", "2026-10-24"), row("c", "SUBMITTED", "2026-10-22"), row("d", "REJECTED", "2026-10-23")]);
  assert.deepEqual(out.map((r) => r.estimate_id), ["c", "b", "d", "a"]);
});
