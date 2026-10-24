// Finding actions and query rules (25 Oct 2026): who sees, who acts, every
// action's effect and refusal, separation of duties, who can be asked, and
// that a link never sees the finding behind a question. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFindingAction, audiencesFor, canActOnFindings, canSeeFinding, type Actor, type FindingForAction } from "./actions";
import { assigneeView, queryAudience, queryTargetError, type QueryTarget } from "./queries";

const OWNER = "iliesa@loboscontracting.com.au";
const who = (role: string, x: Partial<Actor> = {}): Actor => ({ id: `u-${role}`, name: role, email: `${role.toLowerCase()}@test.local`, role, directorAccess: false, ...x });
const owner = who("ADMIN", { id: "u-owner", name: "Iliesa", email: OWNER });
const ticked = who("ADMIN", { id: "u-ticked", name: "Ticked", directorAccess: true });
const director = who("DIRECTOR", { id: "u-yoel", name: "Yoel" });
const f = (x: Partial<FindingForAction> = {}): FindingForAction => ({ status: "OPEN", severity: "MEDIUM", dedupeKey: "K", signalClearedAt: null, resolvedBy: null, resolvedWhileFiring: false, ownerUserId: null, ...x });
const ctx = (actor: Actor, extra: Record<string, unknown> = {}) => ({ actor, now: new Date("2026-10-25T01:00:00Z"), today: "2026-10-25", ...extra });

// ---------- who sees, who acts ----------

test("audiences: directors and the owner see all; Managers operational + commercial; Viewers operational; one-page logins none", () => {
  assert.deepEqual(audiencesFor(owner), ["OPERATIONAL", "COMMERCIAL", "DIRECTOR"]);
  assert.deepEqual(audiencesFor(ticked), ["OPERATIONAL", "COMMERCIAL", "DIRECTOR"]);
  assert.deepEqual(audiencesFor(director), ["OPERATIONAL", "COMMERCIAL", "DIRECTOR"]);
  assert.deepEqual(audiencesFor(who("ADMIN")), ["OPERATIONAL", "COMMERCIAL"]); // e.g. Nick's separate Admin login, not ticked
  assert.deepEqual(audiencesFor(who("MANAGER")), ["OPERATIONAL", "COMMERCIAL"]);
  assert.deepEqual(audiencesFor(who("VIEWER")), ["OPERATIONAL"]);
  assert.deepEqual(audiencesFor(who("TIMESHEETS")), []);
  assert.deepEqual(audiencesFor(who("ACCOUNTS")), []);
  assert.deepEqual(audiencesFor(who("ACCOUNTS", { directorAccess: true })), []); // a tick never opens findings to a one-page login
  assert.equal(canSeeFinding(who("MANAGER"), "DIRECTOR"), false);
});

test("only the owner and director-access users act", () => {
  assert.equal(canActOnFindings(owner), true);
  assert.equal(canActOnFindings(ticked), true);
  assert.equal(canActOnFindings(director), true);
  for (const role of ["ADMIN", "MANAGER", "VIEWER", "TIMESHEETS", "ACCOUNTS"]) assert.equal(canActOnFindings(who(role)), false, role);
  assert.equal(canActOnFindings(who("TIMESHEETS", { directorAccess: true })), false);
});

// ---------- the actions ----------

test("acknowledge: OPEN -> ACKNOWLEDGED, the actor becomes owner if none; not twice", () => {
  const r = applyFindingAction(f(), "ACKNOWLEDGE", {}, ctx(director));
  assert.ok(!("error" in r));
  if (!("error" in r)) {
    assert.equal(r.data.status, "ACKNOWLEDGED");
    assert.equal(r.data.ownerUserId, "u-yoel");
    assert.equal(r.event.action, "ACKNOWLEDGED");
  }
  assert.ok("error" in applyFindingAction(f({ status: "ACKNOWLEDGED" }), "ACKNOWLEDGE", {}, ctx(director)));
  assert.ok("error" in applyFindingAction(f({ status: "RESOLVED" }), "ACKNOWLEDGE", {}, ctx(director)));
});

test("assign: needs an owner; picks the finding up", () => {
  assert.ok("error" in applyFindingAction(f(), "ASSIGN", {}, ctx(owner, { owner: null })));
  const r = applyFindingAction(f(), "ASSIGN", { note: "yours" }, ctx(owner, { owner: { id: "u-yoel", name: "Yoel" } }));
  if ("error" in r) assert.fail(r.error);
  assert.equal(r.data.ownerName, "Yoel");
  assert.equal(r.data.status, "ACKNOWLEDGED");
  assert.equal(r.event.action, "ASSIGNED");
});

test("resolve: needs a note; closes the open key; still firing -> a person verifies later", () => {
  assert.ok("error" in applyFindingAction(f(), "RESOLVE", { note: "" }, ctx(owner)));
  const firing = applyFindingAction(f(), "RESOLVE", { note: "Spoke to Mega Hire" }, ctx(owner));
  if ("error" in firing) assert.fail(firing.error);
  assert.equal(firing.data.status, "RESOLVED");
  assert.equal(firing.data.openKey, null);
  assert.equal(firing.data.resolvedWhileFiring, true);
  const clear = applyFindingAction(f({ signalClearedAt: new Date() }), "RESOLVE", { note: "Fixed" }, ctx(owner));
  if ("error" in clear) assert.fail(clear.error);
  assert.equal(clear.data.resolvedWhileFiring, false);
});

test("dismiss: false alarm or accepted risk with a future date, always with a reason", () => {
  assert.ok("error" in applyFindingAction(f(), "DISMISS", { kind: "MAYBE", reason: "x y" }, ctx(owner)));
  assert.ok("error" in applyFindingAction(f(), "DISMISS", { kind: "FALSE_ALARM", reason: "" }, ctx(owner)));
  assert.ok("error" in applyFindingAction(f(), "DISMISS", { kind: "ACCEPTED_RISK", reason: "ok for now" }, ctx(owner)));
  assert.ok("error" in applyFindingAction(f(), "DISMISS", { kind: "ACCEPTED_RISK", reason: "ok for now", until: "2026-10-25" }, ctx(owner)));
  const r = applyFindingAction(f(), "DISMISS", { kind: "ACCEPTED_RISK", reason: "Client paying the hire", until: "2026-11-08" }, ctx(owner));
  if ("error" in r) assert.fail(r.error);
  assert.equal(r.data.status, "DISMISSED");
  assert.equal(r.data.suppressUntil, "2026-11-08");
  assert.equal(r.data.openKey, null);
  assert.equal(r.data.signalClearedAt, null); // a false alarm stays quiet until the rule has stopped once
});

test("comment: any status, needs text, changes nothing on the finding", () => {
  const r = applyFindingAction(f({ status: "VERIFIED" }), "COMMENT", { note: "For the record" }, ctx(director));
  if ("error" in r) assert.fail(r.error);
  assert.deepEqual(r.data, {});
  assert.equal(r.event.action, "COMMENT");
  assert.ok("error" in applyFindingAction(f(), "COMMENT", { note: " " }, ctx(director)));
});

test("verify by hand: only resolved-while-firing; not by the resolver on high / critical; not effective reopens", () => {
  assert.ok("error" in applyFindingAction(f({ status: "OPEN" }), "VERIFY", {}, ctx(owner)));
  assert.ok("error" in applyFindingAction(f({ status: "RESOLVED", resolvedWhileFiring: false }), "VERIFY", {}, ctx(owner)));
  const high = f({ status: "RESOLVED", resolvedWhileFiring: true, severity: "HIGH", resolvedBy: "Iliesa" });
  assert.ok("error" in applyFindingAction(high, "VERIFY", {}, ctx(owner)));
  const ok = applyFindingAction(high, "VERIFY", {}, ctx(director));
  if ("error" in ok) assert.fail(ok.error);
  assert.equal(ok.data.status, "VERIFIED");
  const no = applyFindingAction(high, "VERIFY", { result: "NOT_EFFECTIVE", note: "still on hire" }, ctx(director));
  if ("error" in no) assert.fail(no.error);
  assert.equal(no.data.status, "OPEN");
  assert.equal(no.data.openKey, "K");
});

test("unknown actions are refused", () => {
  assert.ok("error" in applyFindingAction(f(), "DELETE", {}, ctx(owner)));
});

// ---------- queries ----------

const user = (x: Partial<Extract<QueryTarget, { type: "USER" }>["user"]>): QueryTarget => ({ type: "USER", user: { id: "u-acc", name: "Accounts", email: "accounts@x", role: "ACCOUNTS", directorAccess: false, active: true, ...x } });
const linkP = (x: Partial<Extract<QueryTarget, { type: "LINK" }>["resource"]> = {}): QueryTarget => ({ type: "LINK", resource: { id: "r-tom", name: "Tom", type: "PERSONNEL", active: true, links: 1, ...x } });

test("who can be asked: accounts, directors, or a register person with a link", () => {
  const q = "What's the contract value for Vaucluse?";
  assert.equal(queryTargetError(user({}), owner, q), null);
  assert.equal(queryTargetError(user({ role: "DIRECTOR", id: "u-yoel" }), owner, q), null);
  assert.equal(queryTargetError(user({ role: "ADMIN", directorAccess: true, id: "u-nick" }), owner, q), null);
  assert.match(queryTargetError(user({ role: "MANAGER" }), owner, q)!, /accounts login/);
  assert.match(queryTargetError(user({ email: OWNER, role: "ADMIN" }), director, q)!, /Ilies closes/);
  assert.match(queryTargetError(user({ id: owner.id }), owner, q)!, /yourself/);
  assert.match(queryTargetError(user({ active: false }), owner, q)!, /switched off/);
  assert.equal(queryTargetError(linkP(), owner, "Is the generator still on site?"), null);
  assert.match(queryTargetError(linkP({ links: 0 }), owner, "Is the generator still on site?")!, /no active site link/);
  assert.match(queryTargetError(linkP({ active: false }), owner, "Is the generator still on site?")!, /isn't active/);
  assert.match(queryTargetError(null, owner, q)!, /who to ask/);
  assert.match(queryTargetError(user({}), owner, "hm")!, /question/);
});

test("money never goes to a link: a $ question is refused, and a link query is always operational", () => {
  assert.match(queryTargetError(linkP(), owner, "Is the excavator still $360/day?")!, /dollar figure/);
  assert.equal(queryAudience(linkP(), "COMMERCIAL"), "OPERATIONAL");
  assert.equal(queryAudience(user({}), "COMMERCIAL"), "COMMERCIAL");
  assert.equal(queryAudience(user({ role: "DIRECTOR" }), "DIRECTOR"), "DIRECTOR");
});

test("a link sees only the question - never the finding behind it", () => {
  const r = {
    id: "q1", number: 42, kind: "QUERY", siteLabel: "Myers", summary: "Is the generator still on site?",
    details: JSON.stringify({ question: "Is the generator still on site?", finding: "Myers: forecast is 104% of the $499,000 contract value" }),
    requestedBy: "Iliesa", createdAt: new Date("2026-10-25T00:00:00Z"), neededBy: new Date("2026-10-27T06:00:00Z"),
    status: "TODO", question: null, answer: null, answerFile: null, outcome: null, events: [],
  } as unknown as Parameters<typeof assigneeView>[0];
  const link = assigneeView(r, true);
  assert.equal(link.finding, null);
  assert.ok(!JSON.stringify(link).match(/\$\s?\d/));
  assert.equal(link.canAnswer, true);
  assert.match(assigneeView(r, false).finding!, /104%/); // the accounts login / a director does see what it's about
});
