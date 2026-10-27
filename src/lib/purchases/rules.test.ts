import { test } from "node:test";
import assert from "node:assert/strict";
import { check, linkSafeText, parseAmount, purchaseNo, requesterView, type Actor } from "./rules";

const R = { status: "REQUESTED", requestedBy: "Test Requester" };
const acc: Actor = { kind: "ACCOUNTS" }, req: Actor = { kind: "REQUESTER" };
const nick: Actor = { kind: "DIRECTOR", role: "DIRECTOR", name: "Test Director" };
const owner: Actor = { kind: "DIRECTOR", role: "ADMIN", name: "Iliesa", owner: true };
const admin: Actor = { kind: "DIRECTOR", role: "ADMIN", name: "Other Admin" };
const ok = (x: ReturnType<typeof check>, to: string) => "to" in x && x.to === to;
const no = (x: ReturnType<typeof check>) => "error" in x;

test("accounts check, ask for info, close, and mark ordered - only at the right status", () => {
  assert.ok(ok(check("CHECK", R, acc), "CHECKED"));
  assert.ok(ok(check("ASK_INFO", R, acc), "NEEDS_INFO"));
  assert.ok(ok(check("CLOSE", { ...R, status: "NEEDS_INFO" }, acc), "CLOSED"));
  assert.ok(no(check("CHECK", { ...R, status: "NEEDS_INFO" }, acc)), "waiting on the requester");
  assert.ok(no(check("ORDERED", R, acc)), "not approved yet");
  assert.ok(ok(check("ORDERED", { ...R, status: "APPROVED" }, acc), "ORDERED"));
  assert.ok(no(check("CLOSE", { ...R, status: "CHECKED" }, acc)), "with a director already");
});

test("the requester answers a question or cancels; nothing else", () => {
  assert.ok(ok(check("ANSWER", { ...R, status: "NEEDS_INFO" }, req), "REQUESTED"));
  assert.ok(ok(check("CANCEL", R, req), "CANCELLED"));
  assert.ok(no(check("CANCEL", { ...R, status: "CHECKED" }, req)));
  assert.ok(no(check("CHECK", R, req)));
  assert.ok(no(check("APPROVE", { ...R, status: "CHECKED" }, req)));
});

test("the owner or a DIRECTOR login decides, never the person who asked, and only once checked", () => {
  assert.ok(ok(check("APPROVE", { ...R, status: "CHECKED" }, nick), "APPROVED"));
  assert.ok(ok(check("DECLINE", { ...R, status: "CHECKED" }, nick), "DECLINED"));
  assert.ok(no(check("APPROVE", R, nick)), "not checked by accounts yet");
  assert.ok(ok(check("APPROVE", { ...R, status: "CHECKED" }, owner), "APPROVED"), "the owner decides (Ilies, 27 Oct 2026)");
  assert.ok(no(check("APPROVE", { ...R, status: "CHECKED" }, admin)), "another Admin with director access doesn't decide");
  assert.ok(no(check("APPROVE", { status: "CHECKED", requestedBy: "iliesa" }, owner)), "not even the owner approves his own request");
  const own = check("APPROVE", { status: "CHECKED", requestedBy: "  test   DIRECTOR " }, nick);
  assert.ok("error" in own && /someone else/.test(own.error), "same person, any spelling of the name");
  assert.ok(no(check("APPROVE", { ...R, status: "CHECKED" }, acc)), "accounts can't approve");
});

test("amounts: accounts' typing is understood; nonsense refused", () => {
  assert.equal(parseAmount("$1,250.50"), 1250.5);
  assert.equal(parseAmount(320), 320);
  for (const v of ["", null, "abc", "-5", 0, "99999999"]) assert.equal(parseAmount(v), null, String(v));
});

test("no money on the link: dollar figures refused in link text, and the requester view has no amount", () => {
  assert.equal(linkSafeText("Jackhammer bits x4 from Sydney Tools"), true);
  assert.equal(linkSafeText("about $240"), false);
  const v = requesterView({
    id: "x", number: 7, what: "Bits", why: "worn out", qty: "4", supplier: null, linkUrl: null, neededBy: "2026-11-02", status: "DECLINED",
    infoQuestion: null, infoAnswer: null, decisionNote: "Too dear at $900", requestedBy: "Alex", createdAt: "2026-10-27T00:00:00Z", version: 3,
  });
  assert.equal(v.ref, "P-0007");
  assert.equal(v.decisionNote, null, "a reason with a dollar figure never reaches the link");
  assert.equal(v.statusText, "Declined");
  const keys = Object.keys(v);
  assert.ok(!keys.some((k) => /amount|accountsNote|total|price|cost/i.test(k)), keys.join(","));
  assert.ok(!/\$\s?\d/.test(JSON.stringify(v)));
  assert.equal(purchaseNo(123), "P-0123");
});
