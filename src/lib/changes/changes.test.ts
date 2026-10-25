// Controlled changes (LCI phase 4, A3): the canonical fingerprint, who may
// approve (by person, across Nick's two logins; never the source person or
// the Building Agent; contract values by director logins, the owner only
// when allowed), values for each kind, expiry, the kill switches and the
// approved list. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { A3_RULES, CHANGE_KINDS, LESSON_PUBLISHERS } from "./config";
import {
  canProposeKind, canViewKind, cannotApprove, canonical, expiryFor, fingerprintPayload, isExpired, kindEnabled, noChange,
  openKeyOf, parseAfter, parseSources, pickValue, proposalRef, samePerson, type ChangeUser,
} from "./rules";

const OWNER = "iliesa@loboscontracting.com.au";
const u = (x: Partial<ChangeUser>): ChangeUser => ({ id: "u", name: "Someone", email: "s@x", role: "MANAGER", directorAccess: false, ...x });
const ilies = u({ id: "il", name: "Iliesa Tubakibau Weldon", email: OWNER, role: "ADMIN", directorAccess: true });
const nickAdmin = u({ id: "na", name: "Nick Giannopoulos", email: "nick@loboscontracting.com.au", role: "ADMIN" });
const nickDir = u({ id: "nd", name: "Nick Giannopoulos", email: "nick.director@loboscontracting.com.au", role: "DIRECTOR", directorAccess: true });
const yoel = u({ id: "yo", name: "Yoel Silvestre", email: "yoel@loboscontracting.com.au", role: "DIRECTOR", directorAccess: true });
const agent = u({ id: "ba", name: "Building Agent", email: "iliesa+agent@loboscontracting.com.au", role: "MANAGER" });
const alex = u({ id: "al", name: "Alex", role: "MANAGER" });
const viewer = u({ id: "vi", name: "Crew", role: "VIEWER" });
const accounts = u({ id: "ac", name: "Accounts", role: "ACCOUNTS" });

test("the approved list: four kinds, expiry 3 / 14 days; contract values by Nick and Yoel only, lessons by the owner only (Ilies, 25 Oct)", () => {
  assert.deepEqual(CHANGE_KINDS, ["HIRE_OFF_HIRE_DATE", "PROJECT_CONTRACT_VALUE", "PROJECT_JOB_NO", "PROJECT_QUOTE_NO"]);
  assert.deepEqual(CHANGE_KINDS.map((k) => A3_RULES[k].expiryDays), [3, 14, 14, 14]);
  assert.equal(A3_RULES.PROJECT_CONTRACT_VALUE.audience, "COMMERCIAL");
  assert.deepEqual(A3_RULES.PROJECT_CONTRACT_VALUE.approvers, { roles: ["DIRECTOR"], ownerMayApprove: false });
  assert.deepEqual(LESSON_PUBLISHERS, { owner: true, roles: [] }, "Ilies (25 Oct 2026): only he publishes lessons");
});

test("the fingerprint is canonical: key order and spacing don't matter, any change of payload does", () => {
  assert.equal(canonical({ b: 1, a: { d: [1, 2], c: null } }), canonical({ a: { c: null, d: [1, 2] }, b: 1 }));
  const base = { kind: "PROJECT_JOB_NO", recordType: "Project", recordId: "p1", field: "jobNo", before: { jobNo: "009" }, after: { jobNo: "26_408" }, sourceRefs: [{ type: "Query" as const, id: "q1", label: "R-0042" }], requestedBy: "Building Agent", expiresAt: new Date("2026-11-08T00:00:00Z") };
  const h = (x: typeof base) => createHash("sha256").update(fingerprintPayload(x)).digest("hex");
  assert.equal(h(base), h({ ...base, after: { jobNo: "26_408" } }));
  for (const changed of [{ ...base, after: { jobNo: "26_409" } }, { ...base, before: { jobNo: "010" } }, { ...base, recordId: "p2" }, { ...base, requestedBy: "Iliesa" }, { ...base, expiresAt: new Date("2026-11-09T00:00:00Z") }, { ...base, sourceRefs: [] }]) {
    assert.notEqual(h(base), h(changed as typeof base));
  }
});

test("off-hire dates and job/quote numbers: Admins approve - never the person who proposed it, by person across logins", () => {
  const p = { kind: "HIRE_OFF_HIRE_DATE" as const, requestedBy: "Building Agent", sourcePerson: null };
  assert.equal(cannotApprove(ilies, p), null);
  assert.equal(cannotApprove(nickAdmin, p), null);
  assert.match(cannotApprove(alex, p)!, /approved by an Admin/);
  assert.match(cannotApprove(yoel, p)!, /approved by an Admin/, "a DIRECTOR login doesn't approve operational changes");
  assert.match(cannotApprove(ilies, { ...p, requestedBy: "iliesa  tubakibau weldon " })!, /You proposed/);
  assert.match(cannotApprove(nickAdmin, { kind: "PROJECT_JOB_NO", requestedBy: "Nick Giannopoulos", sourcePerson: null })!, /You proposed/, "Nick's DIRECTOR login proposed it; his ADMIN login can't approve it");
});

test("the Building Agent never approves; the source person can't approve putting their own answer in", () => {
  const asAdmin = { ...agent, role: "ADMIN" };
  assert.match(cannotApprove(asAdmin, { kind: "PROJECT_JOB_NO", requestedBy: "Alex", sourcePerson: null })!, /never approves/);
  const cv = { kind: "PROJECT_CONTRACT_VALUE" as const, requestedBy: "Building Agent", sourcePerson: "Nick Giannopoulos" };
  assert.match(cannotApprove(nickDir, cv)!, /came from you/);
  assert.equal(cannotApprove(yoel, cv), null);
});

test("contract values: director logins approve; the owner only when ownerMayApprove; an Admin login doesn't", () => {
  const cv = { kind: "PROJECT_CONTRACT_VALUE" as const, requestedBy: "Building Agent", sourcePerson: "Accounts" };
  assert.equal(cannotApprove(nickDir, cv), null);
  assert.equal(cannotApprove(yoel, cv), null);
  assert.match(cannotApprove(ilies, cv)!, /director login/);
  assert.match(cannotApprove(nickAdmin, cv)!, /director login/);
  const saved = A3_RULES.PROJECT_CONTRACT_VALUE.approvers.ownerMayApprove;
  A3_RULES.PROJECT_CONTRACT_VALUE.approvers.ownerMayApprove = true;
  try {
    assert.equal(cannotApprove(ilies, cv), null, "the lead flips the flag from Ilies's answer");
    assert.match(cannotApprove(nickAdmin, cv)!, /director login or the owner/);
  } finally { A3_RULES.PROJECT_CONTRACT_VALUE.approvers.ownerMayApprove = saved; }
});

test("who sees and proposes: Managers and Admins all kinds; director logins the project kinds; nobody else", () => {
  for (const k of CHANGE_KINDS) { assert.ok(canViewKind(alex, k)); assert.ok(canProposeKind(ilies, k)); assert.ok(!canViewKind(viewer, k)); assert.ok(!canViewKind(accounts, k)); }
  assert.ok(canViewKind(yoel, "PROJECT_CONTRACT_VALUE") && canProposeKind(yoel, "PROJECT_JOB_NO"));
  assert.ok(!canViewKind(yoel, "HIRE_OFF_HIRE_DATE"));
});

test("values: a real date; a positive contract value (with $ and commas allowed); a sensible job / quote number", () => {
  assert.deepEqual(parseAfter("HIRE_OFF_HIRE_DATE", { offHireDate: "2026-11-20" }), { value: { offHireDate: "2026-11-20" } });
  assert.ok("error" in parseAfter("HIRE_OFF_HIRE_DATE", { offHireDate: "next week" }));
  assert.ok("error" in parseAfter("HIRE_OFF_HIRE_DATE", {}));
  assert.deepEqual(parseAfter("PROJECT_CONTRACT_VALUE", { contractValue: "$1,250,000", contractValueNotes: "ex GST, per LOA" }), { value: { contractValue: 1250000, contractValueNotes: "ex GST, per LOA" } });
  for (const bad of [0, -5, "abc", "", 2e9]) assert.ok("error" in parseAfter("PROJECT_CONTRACT_VALUE", { contractValue: bad }), String(bad));
  assert.deepEqual(parseAfter("PROJECT_JOB_NO", { jobNo: " 26_408 " }), { value: { jobNo: "26_408" } });
  assert.ok("error" in parseAfter("PROJECT_QUOTE_NO", { quoteNo: "<script>" }));
  assert.ok("error" in parseAfter("PROJECT_QUOTE_NO", { quoteNo: "" }));
  assert.deepEqual(pickValue("PROJECT_CONTRACT_VALUE", { contractValue: 5, contractValueNotes: null, name: "x" }), { contractValue: 5, contractValueNotes: null });
  assert.ok(noChange({ jobNo: "009" }, { jobNo: "009" }) && !noChange({ jobNo: "009" }, { jobNo: "010" }));
});

test("expiry, one-open key, references, sources", () => {
  const now = new Date("2026-10-25T00:00:00Z");
  assert.equal(expiryFor("HIRE_OFF_HIRE_DATE", now).toISOString(), "2026-10-28T00:00:00.000Z");
  assert.equal(expiryFor("PROJECT_QUOTE_NO", now).toISOString(), "2026-11-08T00:00:00.000Z");
  assert.ok(isExpired({ expiresAt: now }, now) && !isExpired({ expiresAt: new Date(now.getTime() + 1) }, now));
  assert.equal(openKeyOf("Project", "p1", "jobNo"), "Project:p1:jobNo");
  assert.equal(proposalRef(12), "P-0012");
  assert.ok("error" in parseSources([]));
  assert.ok("error" in parseSources([{ type: "Rumour", label: "x" }]));
  assert.deepEqual(parseSources([{ type: "Query", id: "q1", label: "R-0042 answered by Accounts" }]), [{ type: "Query", id: "q1", label: "R-0042 answered by Accounts" }]);
  assert.ok(samePerson("Nick  Giannopoulos", "nick giannopoulos") && !samePerson("", "") && !samePerson("Nick", null));
});

test("kill switches: CONTROLLED_CHANGES=off stops all; CONTROLLED_CHANGES_OFF stops named kinds; enabled:false stops one", () => {
  assert.equal(kindEnabled("PROJECT_JOB_NO", {}), true);
  assert.equal(kindEnabled("PROJECT_JOB_NO", { all: "OFF" }), false);
  assert.equal(kindEnabled("PROJECT_CONTRACT_VALUE", { off: "project_contract_value, HIRE_OFF_HIRE_DATE" }), false);
  assert.equal(kindEnabled("PROJECT_JOB_NO", { off: "PROJECT_CONTRACT_VALUE" }), true);
  A3_RULES.PROJECT_QUOTE_NO.enabled = false;
  try { assert.equal(kindEnabled("PROJECT_QUOTE_NO", {}), false); } finally { A3_RULES.PROJECT_QUOTE_NO.enabled = true; }
});
