import { test } from "node:test";
import assert from "node:assert/strict";
import { approverIds, check, linkSafeText, parseAmount, purchaseNo, requesterView, type Actor } from "./rules";
import { SAME_PERSON } from "../samePerson";

const R = { status: "REQUESTED", requestedBy: "Test Requester" };
const acc: Actor = { kind: "ACCOUNTS" }, req: Actor = { kind: "REQUESTER" };
const nick: Actor = { kind: "DIRECTOR", role: "DIRECTOR", name: "Test Director" };
const owner: Actor = { kind: "DIRECTOR", role: "ADMIN", name: "Iliesa", owner: true };
const admin: Actor = { kind: "DIRECTOR", role: "ADMIN", name: "Other Admin" };
const ok = (x: ReturnType<typeof check>, to: string) => "to" in x && x.to === to;
const no = (x: ReturnType<typeof check>) => "error" in x;

// 28 Oct 2026 (Ilies): a request goes straight to the approvers; accounts only order what's approved.
test("approvers decide straight from REQUESTED (and older CHECKED ones), and can ask a question", () => {
  assert.ok(ok(check("APPROVE", R, nick), "APPROVED"));
  assert.ok(ok(check("DECLINE", R, nick), "DECLINED"));
  assert.ok(ok(check("APPROVE", R, owner), "APPROVED"), "the owner decides");
  assert.ok(ok(check("APPROVE", { ...R, status: "CHECKED" }, nick), "APPROVED"), "older checked requests can still be decided");
  assert.ok(ok(check("ASK_INFO", R, nick), "NEEDS_INFO"));
  assert.ok(no(check("APPROVE", { ...R, status: "NEEDS_INFO" }, nick)), "waiting on the requester's answer");
  assert.ok(no(check("APPROVE", { ...R, status: "APPROVED" }, nick)), "already decided");
  assert.ok(no(check("APPROVE", R, admin)), "another Admin with director access doesn't decide");
});

test("accounts can't approve, decline or question - they order what's approved", () => {
  for (const a of ["APPROVE", "DECLINE", "ASK_INFO"] as const) assert.ok(no(check(a, R, acc)), a);
  assert.ok(no(check("ORDERED", R, acc)), "not approved yet");
  assert.ok(ok(check("ORDERED", { ...R, status: "APPROVED" }, acc), "ORDERED"));
  assert.ok(no(check("ORDERED", { ...R, status: "APPROVED" }, nick)), "ordering is accounts'");
});

test("the requester answers a question or cancels; nothing else", () => {
  assert.ok(ok(check("ANSWER", { ...R, status: "NEEDS_INFO" }, req), "REQUESTED"));
  assert.ok(ok(check("CANCEL", R, req), "CANCELLED"));
  assert.ok(no(check("CANCEL", { ...R, status: "APPROVED" }, req)));
  assert.ok(no(check("APPROVE", R, req)));
});

test("never the person who asked - by name, by login id, or another login of the same person", () => {
  assert.ok(no(check("APPROVE", { status: "REQUESTED", requestedBy: "iliesa" }, owner)), "not even the owner approves his own request");
  const own = check("APPROVE", { status: "REQUESTED", requestedBy: "  test   DIRECTOR " }, nick);
  assert.ok("error" in own && /someone else/.test(own.error), "same person, any spelling of the name");
  const [ownerId, agentId] = SAME_PERSON[1];
  assert.ok(no(check("APPROVE", { status: "REQUESTED", requestedBy: "Agent", requestedByUserId: agentId }, { ...owner, userId: ownerId })), "owner + Building Agent are one person");
  assert.ok(no(check("ASK_INFO", { status: "REQUESTED", requestedBy: "X", requestedByUserId: "u-1" }, { ...nick, userId: "u-1" })), "nor question their own");
});

test("who is alerted: the DIRECTOR logins and the owner, never the requester's own logins", () => {
  const [nickAdmin, nickDir] = SAME_PERSON[0], [ownerId, agentId] = SAME_PERSON[1];
  const users = [
    { id: nickDir, role: "DIRECTOR", email: "nick.d@test.localhost" }, { id: nickAdmin, role: "ADMIN", email: "nick@test.localhost" },
    { id: "yoel", role: "DIRECTOR", email: "yoel@test.localhost" }, { id: ownerId, role: "ADMIN", email: "iliesa@loboscontracting.com.au" },
    { id: agentId, role: "MANAGER", email: "iliesa+agent@loboscontracting.com.au" }, { id: "acc", role: "ACCOUNTS", email: "accounts@test.localhost" },
  ];
  assert.deepEqual(approverIds(users, "alex").sort(), [nickDir, ownerId, "yoel"].sort(), "Alex's request: both directors and the owner, not accounts");
  assert.deepEqual(approverIds(users, ownerId).sort(), [nickDir, "yoel"].sort(), "Ilies's request reaches Nick and Yoel only");
  assert.deepEqual(approverIds(users, nickAdmin).sort(), [ownerId, "yoel"].sort(), "Nick's (ADMIN login) request skips his DIRECTOR login");
  assert.ok(!approverIds(users, null).includes("acc"));
});

test("amounts: accounts' typing is understood; nonsense refused", () => {
  assert.equal(parseAmount("$1,250.50"), 1250.5);
  assert.equal(parseAmount(320), 320);
  for (const v of ["", null, "abc", "-5", 0, "99999999"]) assert.equal(parseAmount(v), null, String(v));
});

// 2 Nov 2026 (Ilies: "remove the $ money restriction from purchase requests"): the request's own text keeps its prices
// for the requester - but accounts' own amount and note are never in the requester's view.
test("the requester view: the request as written, prices included - never accounts' own amount or note", () => {
  assert.equal(linkSafeText("Jackhammer bits x4 from Sydney Tools"), true);
  assert.equal(linkSafeText("about $240"), false, "the money check itself is unchanged for everything else");
  const v = requesterView({
    id: "x", number: 7, what: "Bits", why: "worn out - Sydney Tools quoted $240", qty: "4", supplier: null, linkUrl: null, neededBy: "2026-11-02", status: "DECLINED",
    infoQuestion: null, infoAnswer: null, decisionNote: "Too dear at $900", requestedBy: "Alex", createdAt: "2026-10-27T00:00:00Z", version: 3,
    ...({ amountExGst: 812.5, accountsNote: "PO 1234" } as object),
  } as Parameters<typeof requesterView>[0]);
  assert.equal(v.ref, "P-0007");
  assert.equal(v.decisionNote, "Too dear at $900", "the director's reason reaches the requester, price and all");
  assert.match(v.why ?? "", /\$240/);
  assert.equal(v.statusText, "Declined");
  const keys = Object.keys(v);
  assert.ok(!keys.some((k) => /amount|accountsNote|total|cost/i.test(k)), keys.join(","));
  assert.ok(!/812|PO 1234/.test(JSON.stringify(v)), "accounts' amount and note never come through");
  assert.equal(purchaseNo(123), "P-0123");
});
