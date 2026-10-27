// Office chat (27 Oct 2026, docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3): who chats, who may start a one-to-one,
// when amounts are allowed (never the room, never a Manager or Operations AI), the text rules, "seen" in a one-to-one
// and the room, unread with the room's first-visit window, and phone alerts that never carry the message. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_FIRST_VISIT_DAYS, alertText, canMessage, canStart, canUseSubject, chatName, checkBody, labelOf, moneyAllowed, roomSeenBy, seenBy, unreadCount,
} from "./rules";

const AI = "iliesa+agent@loboscontracting.com.au";

test("office logins chat; Viewers and Timesheets logins don't", () => {
  for (const r of ["ADMIN", "MANAGER", "ACCOUNTS", "DIRECTOR"]) assert.equal(canMessage(r), true, r);
  for (const r of ["VIEWER", "TIMESHEETS", ""]) assert.equal(canMessage(r), false, r);
});

const ok = (x: ReturnType<typeof canStart>) => "ok" in x;

test("a one-to-one between any two office logins - directors and the office included", () => {
  assert.ok(ok(canStart("MANAGER", "DIRECTOR")));
  assert.ok(ok(canStart("MANAGER", "ADMIN")));
  assert.ok(ok(canStart("DIRECTOR", "ACCOUNTS")));
  assert.ok(ok(canStart("ACCOUNTS", "MANAGER")));
  assert.ok(!ok(canStart("VIEWER", "ACCOUNTS")), "Viewers don't chat");
  assert.ok(!ok(canStart("ACCOUNTS", "TIMESHEETS")));
});

test("amounts only between owner / Admin / accounts / director logins - never a Manager, never Operations AI", () => {
  assert.equal(moneyAllowed({ role: "ACCOUNTS" }, { role: "DIRECTOR" }), true);
  assert.equal(moneyAllowed({ role: "ADMIN" }, { role: "ACCOUNTS" }), true);
  assert.equal(moneyAllowed({ role: "ACCOUNTS" }, { role: "MANAGER" }), false);
  assert.equal(moneyAllowed({ role: "MANAGER", email: AI }, { role: "ACCOUNTS" }), false, "the AI is a Manager login");
  assert.equal(moneyAllowed({ role: "ADMIN", email: AI }, { role: "ACCOUNTS" }), false, "the AI never carries amounts, whatever its role");
});

test("Operations AI is named that in chat; everyone else by their name", () => {
  assert.equal(chatName("Building Agent", AI), "Operations AI");
  assert.equal(chatName("Victoria", "accounts@loboscontracting.com.au"), "Victoria");
});

test("message text: required, capped, and no dollar figure where it isn't allowed (the room never allows one)", () => {
  assert.ok("error" in checkBody("  ", true));
  assert.ok("error" in checkBody("x".repeat(2001), true));
  assert.match((checkBody("Fuel claim of $86.40 is paid", false) as { error: string }).error, /Leave amounts out/);
  assert.ok("error" in checkBody("about $ 90", false));
  assert.deepEqual(checkBody("Your fuel claim is paid", false), { text: "Your fuel claim is paid" });
  assert.deepEqual(checkBody(" Approved at $1,250 ex GST ", true), { text: "Approved at $1,250 ex GST" });
});

test("who may message about which record", () => {
  assert.equal(canUseSubject("ACCOUNTS", "REIMBURSEMENT"), true);
  assert.equal(canUseSubject("MANAGER", "REIMBURSEMENT"), false);
  assert.equal(canUseSubject("DIRECTOR", "PURCHASE"), true);
  assert.equal(canUseSubject("ACCOUNTS", "SITE_REQUEST"), false);
  assert.equal(canUseSubject("MANAGER", "NONE"), true);
});

test("a record's label drops a dollar figure when a Manager can read the thread", () => {
  assert.equal(labelOf("P-0007", "Bits about $240", false), "P-0007");
  assert.equal(labelOf("P-0007", "Bits about $240", true), "P-0007 · Bits about $240");
  assert.equal(labelOf("R-0012", "Bin swap", false), "R-0012 · Bin swap");
});

test("seen (one-to-one) and seen by N (room)", () => {
  assert.equal(seenBy("2026-10-27T01:00:00Z", "2026-10-27T01:00:00Z"), true);
  assert.equal(seenBy("2026-10-27T02:00:00Z", "2026-10-27T01:00:00Z"), false);
  assert.equal(seenBy("2026-10-27T02:00:00Z", null), false);
  const others = [{ name: "Alex", lastSeenAt: "2026-10-27T03:00:00Z" }, { name: "Victoria", lastSeenAt: "2026-10-27T01:00:00Z" }, { name: "Nick", lastSeenAt: null }];
  assert.deepEqual(roomSeenBy("2026-10-27T02:00:00Z", others), ["Alex"]);
});

test("unread: others' messages after I last opened it; an unopened room counts only the last week", () => {
  const msgs = [{ authorId: "me", createdAt: "2026-10-27T03:00:00Z" }, { authorId: "them", createdAt: "2026-10-27T02:00:00Z" }, { authorId: "them", createdAt: "2026-10-27T04:00:00Z" }];
  assert.equal(unreadCount(msgs, "me", null), 2);
  assert.equal(unreadCount(msgs, "me", "2026-10-27T03:00:00Z"), 1, "my own messages never count");
  assert.equal(ROOM_FIRST_VISIT_DAYS, 7);
  const room = [{ authorId: "a", createdAt: "2026-10-01T00:00:00Z" }, { authorId: "b", createdAt: "2026-10-25T00:00:00Z" }];
  assert.equal(unreadCount(room, null, null, "2026-10-20T00:00:00Z"), 1, "only since the first-visit floor");
});

test("a phone alert never carries the message; the label only where there are no amounts", () => {
  const a = alertText("Victoria", "P-0007 · Jackhammer bits", false);
  assert.deepEqual(Object.keys(a).sort(), ["body", "title"]);
  assert.equal(a.title, "Message from Victoria");
  assert.equal(a.body, "P-0007 · Jackhammer bits");
  assert.equal(alertText("Victoria", "P-0007 · Bits $240", true).body, "Open Messages to read it.");
  assert.equal(alertText("Alex", "Message", false).body, "Open Messages to read it.");
});
