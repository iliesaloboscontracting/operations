// Office chat (27 Oct 2026, docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3): who chats, who may start a one-to-one,
// the text rules (amounts allowed - Ilies 27 Oct), who may edit or delete a message and what history each reader
// sees, "seen" in a one-to-one and the room, unread with the room's first-visit window, and phone alerts that never
// carry the message. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_FIRST_VISIT_DAYS, alertText, canChange, canMessage, canReadAllThreads, canStart, overChatLimit, canUseSubject, chatName, checkBody, labelOf, roomSeenBy, seenBy, unreadCount,
  visibleHistory,
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

test("Operations AI is named that in chat; everyone else by their name", () => {
  assert.equal(chatName("Building Agent", AI), "Operations AI");
  assert.equal(chatName("Victoria", "accounts@loboscontracting.com.au"), "Victoria");
});

test("message text: required and capped; dollar figures are allowed (Ilies 27 Oct)", () => {
  assert.ok("error" in checkBody("  "));
  assert.ok("error" in checkBody("x".repeat(2001)));
  assert.deepEqual(checkBody(" Approved at $1,250 ex GST "), { text: "Approved at $1,250 ex GST" });
  assert.deepEqual(checkBody("The fuel was $86.40"), { text: "The fuel was $86.40" });
});

test("only the sender edits or deletes, any time, no approval; a deleted message can't be changed", () => {
  assert.ok("ok" in canChange({ authorId: "p1", deletedAt: null }, "p1"));
  assert.match((canChange({ authorId: "p1", deletedAt: null }, "p2") as { error: string }).error, /your own/);
  assert.match((canChange({ authorId: "p1", deletedAt: "2026-10-27T03:00:00Z" }, "p1") as { error: string }).error, /deleted/);
});

test("history: earlier versions behind 'edited' for everyone; deleted text for the owner only", () => {
  const v = [{ kind: "EDIT", body: "first", at: "2026-10-27T01:00:00Z" }, { kind: "EDIT", body: "second", at: "2026-10-27T02:00:00Z" }];
  assert.deepEqual(visibleHistory(v, false, false).map((x) => x.text), ["first", "second"]);
  const del = [...v, { kind: "DELETE", body: "third", at: "2026-10-27T03:00:00Z" }];
  assert.deepEqual(visibleHistory(del, true, false), [], "nobody else sees deleted text, nor its earlier versions");
  assert.deepEqual(visibleHistory(del, true, true).map((x) => `${x.kind}:${x.text}`), ["EDIT:first", "EDIT:second", "DELETE:third"], "the owner sees it all");
});

test("who may message about which record", () => {
  assert.equal(canUseSubject("ACCOUNTS", "REIMBURSEMENT"), true);
  assert.equal(canUseSubject("MANAGER", "REIMBURSEMENT"), false);
  assert.equal(canUseSubject("DIRECTOR", "PURCHASE"), true);
  assert.equal(canUseSubject("ACCOUNTS", "SITE_REQUEST"), false);
  assert.equal(canUseSubject("MANAGER", "NONE"), true);
});

test("a record's label keeps its detail", () => {
  assert.equal(labelOf("P-0007", "Bits about $240"), "P-0007 · Bits about $240");
  assert.equal(labelOf("R-0012", null), "R-0012");
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

test("a phone alert carries who it's from - never the message or the record label", () => {
  const a = alertText("Victoria");
  assert.deepEqual(a, { title: "Message from Victoria", body: "Open Messages to read it." });
});

test("only the owner reads every one-to-one (Ilies 27 Oct, D-Q11) - not other Admins or the directors", () => {
  const OWNER = "iliesa@loboscontracting.com.au";
  assert.equal(canReadAllThreads(OWNER, OWNER), true);
  assert.equal(canReadAllThreads(" ILIESA@loboscontracting.com.au".trim(), OWNER), true);
  assert.equal(canReadAllThreads("nick@loboscontracting.com.au", OWNER), false);
  assert.equal(canReadAllThreads(AI, OWNER), false);
  assert.equal(canReadAllThreads(null, OWNER), false);
});

test("Operations AI may post at most 20 chat messages in 24 hours; nobody else has a limit (D-Q10)", () => {
  assert.equal(overChatLimit(AI, 19), false);
  assert.equal(overChatLimit(AI, 20), true, "the 21st is refused");
  assert.equal(overChatLimit(AI.toUpperCase(), 25), true);
  assert.equal(overChatLimit("alex@loboscontracting.com.au", 500), false, "an ordinary Manager isn't limited");
  assert.equal(overChatLimit(null, 500), false);
});
