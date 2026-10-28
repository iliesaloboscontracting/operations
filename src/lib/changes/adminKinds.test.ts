// Admin change kinds (28 Oct 2026; docs/lci/ADMIN-CHANGE-KINDS-DESIGN.md): who sees, proposes and approves
// them - including the one narrow exception (the owner may approve what Operations AI proposed, for these
// kinds only, never his own proposal) - the values each kind takes, "no change", the approval's re-check
// and the card's words. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { A3_RULES, CHANGE_KINDS, isAdminKind, type ChangeKind } from "./config";
import { canProposeKind, canViewKind, canViewProposal, cannotApprove, kindEnabled, parseAfter, type ChangeUser } from "./rules";
import { adminUnchanged, checkedPart, describeAdmin, tipRateKey, undoBody } from "./adminRules";

const OWNER = "iliesa@loboscontracting.com.au";
const OWNER_ID = "cmubx963700004t2nskaa059p"; // the SAME_PERSON pair (lib/samePerson.ts)
const AGENT_ID = "cmv81x7om0000cfw714gqtmz2";
const u = (x: Partial<ChangeUser>): ChangeUser => ({ id: "u", name: "Someone", email: "s@x", role: "MANAGER", directorAccess: false, ...x });
const ilies = u({ id: OWNER_ID, name: "Iliesa Tubakibau Weolin", email: OWNER, role: "ADMIN", directorAccess: true });
const agent = u({ id: AGENT_ID, name: "Building Agent", email: "iliesa+agent@loboscontracting.com.au", role: "MANAGER" });
const nickAdmin = u({ id: "cmvnh13p80001c8w58nolsvnj", name: "Nick Giannopoulos", email: "nick@loboscontracting.com.au", role: "ADMIN" });
const yoel = u({ id: "yo", name: "Yoel Silvestre", email: "yoel@loboscontracting.com.au", role: "DIRECTOR", directorAccess: true });
const alex = u({ id: "al", name: "Alex", role: "MANAGER" });
const accounts = u({ id: "ac", name: "Accounts", role: "ACCOUNTS" });

const ADMIN_KINDS = CHANGE_KINDS.filter(isAdminKind);
const fromAgent = (kind: ChangeKind) => ({ kind, requestedBy: agent.name, requestedByUserId: AGENT_ID, sourcePerson: null, proposedByAi: true });
const fromOwner = (kind: ChangeKind) => ({ kind, requestedBy: ilies.name, requestedByUserId: OWNER_ID, sourcePerson: null, proposedByAi: false });

test("the seven admin kinds: audience ADMIN, the owner or an Admin approves, a week to decide", () => {
  assert.deepEqual(ADMIN_KINDS, ["TIP_RATE_ADD", "TIP_RATE_RETIRE", "INVOICED_COST_REMOVE", "RESOURCE_RATE", "RESOURCE_ENGAGEMENT", "WORKER_TICKET", "COMPLIANCE_DOC"]);
  for (const k of ADMIN_KINDS) {
    assert.deepEqual(A3_RULES[k].approvers, { roles: ["ADMIN"], ownerMayApprove: true, aiOwnerMayApprove: true }, k);
    assert.equal(A3_RULES[k].expiryDays, 7);
  }
  // Nothing else has the exception; contract values stay DIRECTOR-only.
  for (const k of CHANGE_KINDS.filter((k) => !isAdminKind(k))) assert.ok(!A3_RULES[k].approvers.aiOwnerMayApprove, k);
  assert.deepEqual(A3_RULES.PROJECT_CONTRACT_VALUE.approvers, { roles: ["DIRECTOR"], ownerMayApprove: false });
});

test("the exception, one way: the owner approves an Operations AI proposal of an admin kind; so does another Admin", () => {
  for (const k of ADMIN_KINDS) {
    assert.equal(cannotApprove(ilies, fromAgent(k)), null, k);
    assert.equal(cannotApprove(nickAdmin, fromAgent(k)), null, k);
  }
});

test("the exception, the other way: the owner's own proposal - not the owner, not the Building Agent; another Admin can", () => {
  for (const k of ADMIN_KINDS) {
    assert.match(cannotApprove(ilies, fromOwner(k))!, /You proposed/, k);
    assert.match(cannotApprove({ ...agent, role: "ADMIN" }, fromOwner(k))!, /never approves/, k);
    assert.match(cannotApprove(agent, fromOwner(k))!, /never approves/, k);
    assert.equal(cannotApprove(nickAdmin, fromOwner(k)), null, k);
  }
});

test("the exception is narrow: a Building Agent proposal of any other kind still can't be approved by the owner", () => {
  for (const k of ["HIRE_OFF_HIRE_DATE", "PROJECT_JOB_NO", "PROJECT_QUOTE_NO"] as const) {
    assert.match(cannotApprove(ilies, fromAgent(k))!, /You proposed/, k);
    assert.equal(cannotApprove(nickAdmin, fromAgent(k)), null, k);
  }
  assert.match(cannotApprove(ilies, fromAgent("PROJECT_CONTRACT_VALUE"))!, /director login/);
});

test("the exception needs Operations AI at the time of the decision: not when the proposer isn't the AI any more", () => {
  // e.g. the agent login has been made an Admin since - the server then passes proposedByAi false
  for (const k of ADMIN_KINDS) assert.match(cannotApprove(ilies, { ...fromAgent(k), proposedByAi: false })!, /You proposed/, k);
  // the same login id as the owner (his own proposal, even if flagged) is never covered
  assert.match(cannotApprove(ilies, { ...fromAgent("TIP_RATE_ADD"), requestedByUserId: OWNER_ID })!, /You proposed/);
  // a proposal carrying the owner's name is his own
  assert.match(cannotApprove(ilies, { ...fromAgent("TIP_RATE_ADD"), requestedBy: "iliesa tubakibau  weolin" })!, /You proposed/);
});

test("a Manager, a director login and accounts can't approve admin kinds; the Building Agent never approves", () => {
  for (const k of ADMIN_KINDS) {
    assert.match(cannotApprove(alex, fromAgent(k))!, /approved by an Admin/, k);
    assert.match(cannotApprove(yoel, fromAgent(k))!, /approved by an Admin/, k);
    assert.match(cannotApprove(accounts, fromAgent(k))!, /approved by an Admin/, k);
    assert.match(cannotApprove(agent, { ...fromAgent(k), requestedBy: "Nick Giannopoulos", requestedByUserId: nickAdmin.id })!, /never approves/, k);
  }
});

test("who sees and proposes admin kinds: Admins; Operations AI its own; never another Manager, a director login or accounts", () => {
  for (const k of ADMIN_KINDS) {
    assert.ok(canViewKind(ilies, k) && canProposeKind(ilies, k) && canProposeKind(nickAdmin, k), k);
    assert.ok(canProposeKind(agent, k), k);
    assert.ok(!canViewKind(alex, k) && !canProposeKind(alex, k), k);
    assert.ok(!canViewKind(yoel, k) && !canViewKind(accounts, k), k);
    assert.ok(canViewProposal(agent, { kind: k, requestedByUserId: AGENT_ID }), "its own, with values");
    assert.ok(!canViewProposal(agent, { kind: k, requestedByUserId: nickAdmin.id }), "not an Admin's");
    assert.ok(canViewProposal(nickAdmin, { kind: k, requestedByUserId: AGENT_ID }));
    // The agent's email on an ADMIN login isn't Operations AI (CH-021)
    assert.ok(canViewKind({ ...agent, role: "ADMIN" }, k));
    assert.ok(!canViewKind({ ...agent, role: "VIEWER" }, k));
  }
  // the existing kinds are unchanged for Managers
  assert.ok(canViewKind(alex, "PROJECT_JOB_NO") && canViewProposal(alex, { kind: "PROJECT_JOB_NO", requestedByUserId: "x" }));
});

test("the kill switches cover the admin kinds", () => {
  for (const k of ADMIN_KINDS) {
    assert.equal(kindEnabled(k, {}), true);
    assert.equal(kindEnabled(k, { all: "off" }), false);
  }
  assert.equal(kindEnabled("INVOICED_COST_REMOVE", { off: "invoiced_cost_remove" }), false);
});

test("tip rates: a new rate needs site, $/t and a start date; keyed by site + waste + date; retiring takes the record", () => {
  const ok = parseAfter("TIP_RATE_ADD", { tipSite: "BM Clean", wasteType: "Heavies", ratePerTonneExGst: "$280", validFrom: "2026-07-14" });
  assert.ok("value" in ok);
  assert.deepEqual(ok.value, { tipSite: "BM Clean", wasteType: "Heavies", ratePerTonneExGst: 280, validFrom: "2026-07-14", note: null, rateSource: null });
  assert.equal(ok.recordId, tipRateKey("bm  clean", "HEAVIES", "2026-07-14"));
  for (const bad of [{ tipSite: "", ratePerTonneExGst: 280, validFrom: "2026-07-14" }, { tipSite: "BM", ratePerTonneExGst: 0, validFrom: "2026-07-14" }, { tipSite: "BM", ratePerTonneExGst: 5000, validFrom: "2026-07-14" }, { tipSite: "BM", ratePerTonneExGst: 280, validFrom: "14/07/2026" }]) {
    assert.ok("error" in parseAfter("TIP_RATE_ADD", bad), JSON.stringify(bad));
  }
  assert.deepEqual(parseAfter("TIP_RATE_RETIRE", {}), { value: { retired: true } });
  assert.deepEqual(parseAfter("INVOICED_COST_REMOVE", {}), { value: { removed: true } });
});

test("a new tip rate's approval re-checks only that no rate starts the same day - retiring the old rate first doesn't make it stale", () => {
  const atProposal = { sameDateRate: null, inForceRate: 75, inForceFrom: "2026-01-01" };
  const afterRetire = { sameDateRate: null, inForceRate: null, inForceFrom: null };
  assert.deepEqual(checkedPart("TIP_RATE_ADD", atProposal), checkedPart("TIP_RATE_ADD", afterRetire));
  assert.notDeepEqual(checkedPart("TIP_RATE_ADD", atProposal), checkedPart("TIP_RATE_ADD", { ...afterRetire, sameDateRate: "r9" }));
  // every other kind re-checks the whole "before"
  const rate = { ordinaryRate: 45, nightRate: 50 };
  assert.deepEqual(checkedPart("RESOURCE_RATE", rate), rate);
});

test("resource rates: only the named fields; sensible amounts; pay notes refuse bank details; engagement is EMPLOYEE / ABN", () => {
  assert.deepEqual(parseAfter("RESOURCE_RATE", { ordinaryRate: "45.5", payRateConfirmed: true, name: "ignored" }), { value: { ordinaryRate: 45.5, payRateConfirmed: true } });
  assert.deepEqual(parseAfter("RESOURCE_RATE", { nightRate: null }), { value: { nightRate: null } }, "clearing a rate is allowed");
  assert.deepEqual(parseAfter("RESOURCE_RATE", { dailyRateExGst: "$1,200" }), { value: { dailyRateExGst: 1200 } });
  for (const bad of [{}, { ordinaryRate: -1 }, { ordinaryRate: "abc" }, { annualSalary: 5e6 }, { payRateBasis: "WEEKLY" }, { payRateConfirmed: "yes" }, { payRateNotes: "BSB 062-000 acct 1234 5678" }, { engagement: "ABN" }]) {
    assert.ok("error" in parseAfter("RESOURCE_RATE", bad), JSON.stringify(bad));
  }
  assert.deepEqual(parseAfter("RESOURCE_ENGAGEMENT", { engagement: "abn" }), { value: { engagement: "ABN" } });
  assert.ok("error" in parseAfter("RESOURCE_ENGAGEMENT", { engagement: "CASUAL" }));
});

test("tickets and documents: type and expiry only - never a card, licence or policy number", () => {
  const t = parseAfter("WORKER_TICKET", { op: "create", resourceId: "r1", ticketKind: "WHITE_CARD", label: "", expiryDate: "" });
  assert.ok("value" in t);
  assert.deepEqual(t.value, { op: "CREATE", kind: "WHITE_CARD", label: null, expiryDate: null, resourceId: "r1" });
  assert.equal(t.recordId, "new:r1:WHITE_CARD:");
  const noExpiry = parseAfter("WORKER_TICKET", { op: "CREATE", resourceId: "r1", ticketKind: "FIRST_AID" });
  assert.ok("value" in noExpiry && noExpiry.value.expiryDate === null, "no expiry given = doesn't expire");
  assert.deepEqual(parseAfter("WORKER_TICKET", { op: "UPDATE", expiryDate: "2027-03-01" }), { value: { op: "UPDATE", expiryDate: "2027-03-01" } });
  for (const bad of [
    { op: "CREATE", resourceId: "r1", ticketKind: "WHITE_CARD", number: "CGI1234567" },
    { op: "CREATE", resourceId: "r1", ticketKind: "HRWL_FORKLIFT", label: "LF 1234567" },
    { op: "CREATE", resourceId: "r1", ticketKind: "NOT_A_KIND" },
    { op: "CREATE", ticketKind: "WHITE_CARD" },
    { op: "CREATE", resourceId: "r1", kind: "WHITE_CARD" }, // "kind" is the change kind - never the ticket type
    { op: "CREATE", resourceId: "r1", ticketKind: "OTHER" },
    { op: "UPDATE" },
    { ticketKind: "WHITE_CARD" },
    { op: "UPDATE", expiryDate: "next year" },
  ]) assert.ok("error" in parseAfter("WORKER_TICKET", bad), JSON.stringify(bad));

  const d = parseAfter("COMPLIANCE_DOC", { op: "CREATE", holderType: "COMPANY", holderName: "Lobos Contracting", docKind: "PUBLIC_LIABILITY", issuer: "QBE", expiryDate: "2027-06-30" });
  assert.ok("value" in d);
  assert.equal(d.recordId, "new:COMPANY:lobos contracting:PUBLIC_LIABILITY");
  const a = parseAfter("COMPLIANCE_DOC", { op: "CREATE", holderType: "ASSET", resourceId: "truck1", docKind: "REGO", expiryDate: "2027-01-31" });
  assert.ok("value" in a && a.recordId === "new:ASSET:truck1:REGO");
  for (const bad of [
    { op: "CREATE", holderType: "COMPANY", holderName: "Lobos", docKind: "PUBLIC_LIABILITY", reference: "POL-998877" },
    { op: "CREATE", holderType: "COMPANY", docKind: "PUBLIC_LIABILITY" },
    { op: "CREATE", holderType: "ASSET", docKind: "REGO" },
    { op: "CREATE", holderType: "ASSET", resourceId: "t", docKind: "PUBLIC_LIABILITY" },
    { op: "CREATE", holderType: "PERSON", holderName: "x", docKind: "OTHER" },
    { op: "UPDATE" },
  ]) assert.ok("error" in parseAfter("COMPLIANCE_DOC", bad), JSON.stringify(bad));
  assert.deepEqual(parseAfter("COMPLIANCE_DOC", { op: "UPDATE", issuer: "Allianz" }), { value: { op: "UPDATE", issuer: "Allianz" } });
});

test("no change: every proposed field already says that; a new record is always a change", () => {
  assert.ok(adminUnchanged({ ordinaryRate: 45, nightRate: 50 }, { ordinaryRate: 45 }));
  assert.ok(!adminUnchanged({ ordinaryRate: 45, nightRate: 50 }, { ordinaryRate: 46 }));
  assert.ok(!adminUnchanged({ sameDateRate: null }, { tipSite: "BM", ratePerTonneExGst: 280, validFrom: "2026-07-14" }));
  assert.ok(!adminUnchanged({ activeSameTicket: null }, { op: "CREATE", kind: "WHITE_CARD" }));
  assert.ok(adminUnchanged({ kind: "WHITE_CARD", expiryDate: "2027-01-01" }, { op: "UPDATE", expiryDate: "2027-01-01" }));
  assert.ok(!adminUnchanged({ retired: false }, { retired: true }));
  assert.ok(!adminUnchanged({ removed: false }, { removed: true }));
});

test("the card's words: supplier, number, amount and job for a removal; only the changed rates; undo puts back the old values", () => {
  const inv = describeAdmin("INVOICED_COST_REMOVE", { vendor: "Allcott", invoiceNo: "1846169", amountExGst: 1000, totalIncGst: 1100, weekEnding: "2026-10-05", job: "26_401 Test", hireResourceId: "h1" }, { removed: true });
  assert.match(inv.before, /Allcott 1846169 .*\$1,000\.00 ex GST .*\$1,100\.00 inc GST.*26_401 Test/);
  assert.match(inv.after, /hire estimate/);
  const add = describeAdmin("TIP_RATE_ADD", { sameDateRate: null, inForceRate: 75, inForceFrom: "2026-01-01" }, { tipSite: "BM Clean", wasteType: "Heavies", ratePerTonneExGst: 280, validFrom: "2026-07-14" });
  assert.equal(add.before, "In force on that date: $75.00/t from 2026-01-01");
  assert.equal(add.after, "$280.00/t ex GST from 2026-07-14");
  const r = describeAdmin("RESOURCE_RATE", { ordinaryRate: 45, nightRate: 50, payRateConfirmed: false }, { ordinaryRate: 47, payRateConfirmed: true });
  assert.equal(r.before, "Ordinary rate $45.00 · Confirmed: no (TBC)");
  assert.equal(r.after, "Ordinary rate $47.00 · Confirmed: yes");
  assert.deepEqual(undoBody({ ordinaryRate: 45, nightRate: null, payRateConfirmed: false }, { ordinaryRate: 47, nightRate: 52 }), { ordinaryRate: 45, nightRate: null });
  assert.equal(describeAdmin("RESOURCE_ENGAGEMENT", { engagement: null }, { engagement: "ABN" }).before, "Not set");
  assert.match(describeAdmin("WORKER_TICKET", null, { op: "CREATE", kind: "WHITE_CARD", label: null, expiryDate: null }).after, /White card.*doesn't expire/);
  // undo: rates and engagement only
  assert.deepEqual(ADMIN_KINDS.filter((k) => A3_RULES[k].undoable), ["RESOURCE_RATE", "RESOURCE_ENGAGEMENT"]);
});

test("SEC-001: current pay, engagement, ticket and document values are Admins only; the first four kinds are unchanged for Managers", async () => {
  const { MASKED_KINDS, MASKED_BEFORE, masksBefore, maskedNote } = await import("./rules");
  assert.deepEqual(MASKED_KINDS, ["RESOURCE_RATE", "RESOURCE_ENGAGEMENT", "WORKER_TICKET", "COMPLIANCE_DOC"]);
  for (const k of MASKED_KINDS) {
    assert.ok(masksBefore(agent, k), `Operations AI: ${k}`);
    assert.ok(masksBefore({ role: "MANAGER" }, k) && masksBefore({ role: "DIRECTOR" }, k), k);
    assert.ok(!masksBefore(ilies, k) && !masksBefore(nickAdmin, k), `an Admin sees ${k}`);
  }
  for (const k of ["HIRE_OFF_HIRE_DATE", "PROJECT_CONTRACT_VALUE", "PROJECT_JOB_NO", "PROJECT_QUOTE_NO", "TIP_RATE_ADD", "TIP_RATE_RETIRE", "INVOICED_COST_REMOVE"] as const) {
    assert.ok(!masksBefore(alex, k) && !masksBefore(agent, k), `not masked: ${k}`);
  }
  assert.equal(MASKED_BEFORE, "Current value: Admins only");
  const note = 'Applied as approved by Iliesa. To roll back: "Propose undo" sets it back to Ordinary rate $45.00.';
  assert.doesNotMatch(maskedNote("EXECUTED", note)!, /\$|45/);
  assert.doesNotMatch(maskedNote("STALE", "It has been changed since this was proposed")!, /\$/);
  assert.equal(maskedNote("PROPOSED", "E2E"), "E2E", "other notes (the proposer's own why) are kept");
});

test("SEC-002: Operations AI's change proposals share the 20-a-day cap (the 21st in 24 hours is refused)", async () => {
  const { AI_DAILY_LIMIT, overAiLimit, isOperationsAi } = await import("../infoRequests/rules");
  assert.equal(AI_DAILY_LIMIT, 20);
  assert.ok(!overAiLimit(19), "the 20th is allowed");
  assert.ok(overAiLimit(20), "the 21st is refused");
  assert.ok(isOperationsAi(agent.email, agent.role) && !isOperationsAi(agent.email, "ADMIN") && !isOperationsAi(ilies.email, ilies.role), "the cap applies to Operations AI only");
});

test("SEC-004: a switched-off agent login isn't Operations AI, so the owner can't approve its waiting proposals", async () => {
  const { aiProposerIds } = await import("./rules");
  const row = (x: Partial<{ id: string; email: string; role: string; active: boolean }>) => ({ id: AGENT_ID, email: agent.email, role: "MANAGER", active: true, ...x });
  assert.deepEqual([...aiProposerIds([row({})])], [AGENT_ID]);
  assert.equal(aiProposerIds([row({ active: false })]).size, 0, "inactive");
  assert.equal(aiProposerIds([row({ role: "ADMIN" })]).size, 0, "not a MANAGER login");
  assert.equal(aiProposerIds([row({ id: OWNER_ID, email: OWNER, role: "ADMIN" })]).size, 0, "the owner");
  // and so, without the AI flag, the SAME_PERSON pairing stands
  assert.match(cannotApprove(ilies, { ...fromAgent("RESOURCE_RATE"), proposedByAi: aiProposerIds([row({ active: false })]).has(AGENT_ID) })!, /You proposed/);
});

test("SEC-005: the owner's phone alert never carries an amount", async () => {
  const { alertBody } = await import("./rules");
  assert.equal(alertBody("Operations AI", "Tip rate (new)", "BM Recycling Banksmeadow · Clean Heavies from 2026-07-14"), "Operations AI proposed: Tip rate (new) - BM Recycling Banksmeadow · Clean Heavies from 2026-07-14");
  for (const name of ["Allcott $1,846.00", "Rate 280.00 per t", "Invoice 1,200.50"]) {
    const b = alertBody("Operations AI", "Remove supplier invoice", name);
    assert.equal(b, "Operations AI proposed: Remove supplier invoice", name);
    assert.doesNotMatch(b, /\$|\d\.\d{2}/);
  }
  assert.equal(alertBody("Operations AI", "Remove supplier invoice", "Allcott Hire 1846169"), "Operations AI proposed: Remove supplier invoice - Allcott Hire 1846169", "an invoice number isn't an amount");
  assert.ok(alertBody("x", "y", "z".repeat(300)).length <= 140);
});

test("SEC-003: a removed invoice is kept whole - every field, dates as text", async () => {
  const { invoiceSnapshot } = await import("./adminRules");
  const row = {
    id: "ic1", projectId: "p1", vendor: "Allcott Hire", category: "PLANT_HIRE", invoiceNo: "1846169", weekEnding: "2026-09-30", dueDate: "2026-10-30",
    shift: null, amountExGst: 1000, gst: 100, totalIncGst: 1100, notes: "per register row 12", createdAt: new Date("2026-10-01T00:00:00Z"),
    hireResourceId: "h1", periodFrom: "2026-09-01", periodTo: "2026-09-30", enteredBy: "Victoria", docketNos: '["D1","D2"]',
    project: { name: "x" }, // a relation is not a field of the row
  };
  const s = invoiceSnapshot(row);
  for (const k of ["notes", "docketNos", "periodFrom", "periodTo", "dueDate", "shift", "gst", "enteredBy", "hireResourceId", "amountExGst", "totalIncGst"]) assert.ok(k in s, k);
  assert.equal(s.createdAt, "2026-10-01T00:00:00.000Z");
  assert.equal(s.docketNos, '["D1","D2"]');
  assert.ok(!("project" in s));
});

test("SEC-006: a change that throws while applying is recorded as not applied, with a short reason", async () => {
  const { applyFailedNote } = await import("./rules");
  assert.equal(applyFailedNote(new Error("SQLITE_BUSY: database\n  is locked")), "Couldn't apply: SQLITE_BUSY: database is locked. Nothing was changed.");
  assert.ok(applyFailedNote(new Error("x".repeat(500))).length < 260, "kept short");
  assert.match(applyFailedNote("odd"), /^Couldn't apply: odd\./);
});

test("SEC-009: only an Admin may propose undoing a pay, engagement, ticket or document change; no undo button for anyone else", async () => {
  const { MASKED_KINDS, undoRefusal, viewCard } = await import("./rules");
  const card = { before: "Ordinary rate $45.00", canUndo: true, after: "Ordinary rate $47.00" };
  for (const k of MASKED_KINDS) {
    assert.equal(undoRefusal(agent, k), "Only an Admin can propose undoing this change.", k);
    assert.equal(undoRefusal({ role: "MANAGER" }, k), "Only an Admin can propose undoing this change.", k);
    assert.equal(undoRefusal(ilies, k), null, k);
    const v = viewCard(agent, k, card);
    assert.equal(v.canUndo, false, k);
    assert.equal(v.before, "Current value: Admins only", k);
    assert.equal(v.after, card.after, "the proposer keeps its own after");
    assert.deepEqual(viewCard(nickAdmin, k, card), card, `an Admin's card is unchanged (${k})`);
  }
  assert.equal(undoRefusal(alex, "PROJECT_JOB_NO"), null, "the first four kinds are unchanged");
  assert.deepEqual(viewCard(alex, "PROJECT_JOB_NO", card), card);
});
