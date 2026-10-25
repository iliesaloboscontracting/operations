// Which screen each finding is on (Task J, 25 Oct 2026; Ilies: operational
// matters out of the directors' box): every kind lands on exactly one screen,
// a DIRECTOR-audience finding always stays with the directors, and who sees /
// acts on each depends on its screen. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTOR_KINDS, screenFor, type FindingScreen } from "./config";
import { canActOnThisFinding, canSeeThisFinding, type Actor } from "./actions";
import type { SignalKind } from "./signals";

// Typed against every SignalKind: a new kind won't compile until it's placed here.
const EXPECTED: Record<SignalKind, FindingScreen> = {
  COST_VS_CONTRACT: "DIRECTORS", DATA_NO_CONTRACT_VALUE: "DIRECTORS", TENDER_WON_NO_PROJECT: "DIRECTORS", XERO_UNMATCHED: "DIRECTORS", XERO_REAUTH: "DIRECTORS",
  LABOUR_HOURS_VS_BUDGET: "DIRECTORS",
  NO_SUPERVISOR: "OPERATIONS", CREW_SHORT: "OPERATIONS", START_NOT_READY: "OPERATIONS", DAYS_NOT_CLOSED: "OPERATIONS",
  HIRE_OVERDUE: "OPERATIONS", HIRE_IDLE: "OPERATIONS", HIRE_NO_FINISH: "OPERATIONS", HIRE_UNINVOICED: "OPERATIONS",
  DATE_INACTIVE_HAS_JOBS: "OPERATIONS", DATE_COMPLETED_HAS_JOBS: "OPERATIONS", DATE_NO_START: "OPERATIONS", DATE_START_MISMATCH: "OPERATIONS",
  DATE_JOBS_AFTER_COMPLETION: "OPERATIONS", DATE_COMPLETION_PASSED: "OPERATIONS", DATE_TBC_REVIEW_DUE: "OPERATIONS", DATE_JOBS_NO_TIMES: "OPERATIONS",
  DATA_UNCOSTED: "OPERATIONS", DATA_PLANT_NOT_BOOKED: "OPERATIONS",
};

test("every kind lands on exactly one screen (with its usual audience)", () => {
  for (const [kind, want] of Object.entries(EXPECTED)) {
    for (const audience of ["OPERATIONAL", "COMMERCIAL"]) assert.equal(screenFor({ ruleCode: kind, audience }), want, `${kind}/${audience}`);
  }
  assert.deepEqual([...DIRECTOR_KINDS].sort(), Object.entries(EXPECTED).filter(([, s]) => s === "DIRECTORS").map(([k]) => k).sort());
});

test("anything with the DIRECTOR audience stays on the Directors screen, whatever its kind", () => {
  assert.equal(screenFor({ ruleCode: "CREW_SHORT", audience: "DIRECTOR" }), "DIRECTORS");
  assert.equal(screenFor({ ruleCode: "SOMETHING_NEW", audience: "OPERATIONAL" }), "OPERATIONS");
});

const who = (role: string, x: Partial<Actor> = {}): Actor => ({ id: role, name: role, email: `${role}@t`, role, directorAccess: false, ...x });
const owner = who("ADMIN", { email: "iliesa@loboscontracting.com.au" });
const ticked = who("ADMIN", { directorAccess: true });
const ops = { ruleCode: "NO_SUPERVISOR", audience: "OPERATIONAL" };
const opsMoney = { ruleCode: "DAYS_NOT_CLOSED", audience: "COMMERCIAL" };
const dir = { ruleCode: "COST_VS_CONTRACT", audience: "COMMERCIAL" };
const dirOnly = { ruleCode: "TENDER_WON_NO_PROJECT", audience: "DIRECTOR" };

test("Attention (operations) findings: the owner, Admins and Managers act; a directors-only login neither sees nor acts", () => {
  for (const [u, act] of [[owner, true], [ticked, true], [who("ADMIN"), true], [who("MANAGER"), true], [who("VIEWER"), false], [who("DIRECTOR"), false], [who("ACCOUNTS"), false], [who("TIMESHEETS"), false]] as const) {
    assert.equal(canActOnThisFinding(u, ops), act, `${u.role}/${u.directorAccess}`);
    assert.equal(canActOnThisFinding(u, opsMoney), act, `${u.role} money`);
  }
  assert.equal(canSeeThisFinding(who("DIRECTOR"), ops), false);
  assert.equal(canSeeThisFinding(who("MANAGER"), opsMoney), true);
  assert.equal(canSeeThisFinding(who("VIEWER"), ops), true); // Viewers can read an operational finding by id
  assert.equal(canSeeThisFinding(who("VIEWER"), opsMoney), false);
});

test("Directors-screen findings keep today's rule: the owner and director access act; Managers and unticked Admins don't", () => {
  for (const [u, act] of [[owner, true], [ticked, true], [who("DIRECTOR"), true], [who("ADMIN"), false], [who("MANAGER"), false], [who("ACCOUNTS"), false]] as const) {
    assert.equal(canActOnThisFinding(u, dir), act, `${u.role}/${u.directorAccess}`);
  }
  assert.equal(canSeeThisFinding(who("DIRECTOR"), dir), true);
  assert.equal(canSeeThisFinding(who("MANAGER"), dirOnly), false);
  assert.equal(canSeeThisFinding(owner, dirOnly), true);
});
