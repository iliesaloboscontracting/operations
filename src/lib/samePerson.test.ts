import { test } from "node:test";
import assert from "node:assert/strict";
import { SAME_PERSON, normName, sameUser } from "./samePerson";
import { check } from "./purchases/rules";
import { cannotApprove } from "./changes/rules";

const [nickAdmin, nickDirector] = SAME_PERSON[0];

test("sameUser: the same id, or a listed pair; never blanks", () => {
  assert.equal(sameUser("a", "a"), true);
  assert.equal(sameUser(nickAdmin, nickDirector), true);
  assert.equal(sameUser(nickDirector, nickAdmin), true);
  assert.equal(sameUser("a", "b"), false);
  assert.equal(sameUser(null, null), false);
  assert.equal(sameUser("", ""), false);
  assert.equal(normName("  Nick   GIANNOPOULOS "), "nick giannopoulos");
});

test("SEC-002 (c): a director can't approve a purchase they asked for, even under a different name", () => {
  const r = { status: "CHECKED", requestedBy: "Someone Else", requestedByUserId: "u-1" };
  const me = (userId: string, name = "Renamed Director") => ({ kind: "DIRECTOR" as const, role: "DIRECTOR", name, userId });
  assert.ok("error" in check("APPROVE", r, me("u-1")), "same login id, different name");
  assert.ok("error" in check("APPROVE", { ...r, requestedByUserId: nickAdmin }, me(nickDirector)), "his other login");
  assert.ok("to" in check("APPROVE", r, me("u-2")), "a different person approves");
  assert.ok("error" in check("APPROVE", { ...r, requestedBy: "Renamed Director", requestedByUserId: null }, me("u-2")), "the name check still holds");
});

test("SEC-002 (c): a change proposal can't be approved by its proposer's login id", () => {
  // Contract values are approved by a DIRECTOR login, so the approver here is one.
  const u = (id: string, name = "Somebody") => ({ id, name, email: "x@test.localhost", role: "DIRECTOR", directorAccess: true });
  const p = { kind: "PROJECT_CONTRACT_VALUE" as never, requestedBy: "Someone Else", requestedByUserId: "u-1", sourcePerson: null };
  const why = (id: string) => cannotApprove(u(id), p);
  assert.match(why("u-1") ?? "", /You proposed this change/);
  assert.match(cannotApprove(u(nickDirector), { ...p, requestedByUserId: nickAdmin }) ?? "", /You proposed this change/);
  assert.doesNotMatch(why("u-2") ?? "", /You proposed this change/);
});
