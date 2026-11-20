// The allocation email list's plain rules (20 Nov 2026). Made-up example.com / example.org addresses only - the real
// list lives in the database and never goes in a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSummary, buildSheetMailto, encodeAddress, isValidEmail, MAILTO_SAFE_LENGTH, MAX_PASTE_ENTRIES, MAX_SHEET_EMAILS,
  outlookToList, parseEmailBlock, planAdd, tidyReason,
} from "./rules";

test("isValidEmail: plain, strict, lower case", () => {
  for (const ok of ["test1@example.com", "a.b+c@mail.example.org", "o'neil@example.com.au", "x_y-z@sub-1.example.co"])
    assert.equal(isValidEmail(ok), true, ok);
  for (const bad of [
    "", "test1", "@example.com", "test1@", "test1@example", "te st@example.com", "a..b@example.com", ".a@example.com",
    "a.@example.com", "a@@example.com", "a@b@example.com", "a@-example.com", "a@example-.com", "a@example.c",
    "Test1@example.com", "a@example.com.", "a@exa_mple.com", "<a@example.com>", "a;b@example.com", "a,b@example.com",
    `${"a".repeat(65)}@example.com`, `a@${"b".repeat(250)}.com`,
  ])
    assert.equal(isValidEmail(bad), false, bad);
});

test("parseEmailBlock: lines, commas, semicolons; trimmed, lower-cased, repeats counted once", () => {
  const r = parseEmailBlock(" Test1@Example.com \n test2@example.com, test3@example.com;test1@example.com\r\n\n;; ");
  assert.deepEqual(r.entries.map((e) => e.email), ["test1@example.com", "test2@example.com", "test3@example.com"]);
  assert.equal(r.repeated, 1);
  assert.deepEqual(r.invalid, []);
  assert.equal(r.tooMany, false);
});

test("parseEmailBlock: names are kept as labels, Outlook style and side by side", () => {
  const r = parseEmailBlock('Joe Bloggs <joe@example.com>; "Smith, Ann" <ann@example.com>\nBloggs, Fred <fred@example.com>\nSam Lee\tsam@example.com\nmailto:max@example.com');
  assert.deepEqual(r.entries, [
    { email: "joe@example.com", label: "Joe Bloggs" },
    { email: "ann@example.com", label: "Smith, Ann" },
    { email: "fred@example.com", label: "Bloggs, Fred" },
    { email: "sam@example.com", label: "Sam Lee" },
    { email: "max@example.com", label: null },
  ]);
  assert.deepEqual(r.invalid, []);
});

test("parseEmailBlock: invalid entries are named back; hidden characters stripped", () => {
  const zw = String.fromCharCode(0x200b);
  const r = parseEmailBlock(`good@example.com\nnot-an-email\nbad@\nzero${zw}width@example.com\ntwo@ats@example.com`);
  assert.deepEqual(r.entries.map((e) => e.email), ["good@example.com", "zerowidth@example.com"]);
  assert.deepEqual(r.invalid, ["not-an-email", "bad@", "two@ats@example.com"]);
});

test("parseEmailBlock: too much at once reads nothing; not text reads nothing", () => {
  const many = Array.from({ length: MAX_PASTE_ENTRIES + 1 }, (_, i) => `t${i}@example.com`).join("\n");
  assert.equal(parseEmailBlock(many).tooMany, true);
  assert.equal(parseEmailBlock(many).entries.length, 0);
  assert.equal(parseEmailBlock("x".repeat(20_001)).tooMany, true);
  assert.deepEqual(parseEmailBlock(42).entries, []);
  assert.deepEqual(parseEmailBlock(null).entries, []);
});

test("planAdd: dedupe against the list, and the cap", () => {
  const parsed = parseEmailBlock("a@example.com\nb@example.com\nb@example.com\nc@example.com");
  const p = planAdd(["a@example.com"], parsed);
  assert.deepEqual(p.toAdd.map((e) => e.email), ["b@example.com", "c@example.com"]);
  assert.equal(p.already, 2); // a (on the list) + the second b
  assert.equal(p.total, 3);
  assert.equal(p.overCap, false);

  const full = Array.from({ length: MAX_SHEET_EMAILS - 1 }, (_, i) => `f${i}@example.com`);
  assert.equal(planAdd(full, parseEmailBlock("one@example.com")).overCap, false, "exactly 100 is fine");
  const over = planAdd(full, parseEmailBlock("one@example.com\ntwo@example.com"));
  assert.equal(over.overCap, true);
  assert.equal(over.total, MAX_SHEET_EMAILS + 1);
  assert.equal(planAdd(full.concat("z@example.com"), parseEmailBlock("f1@example.com")).overCap, false, "already on a full list is no change");
});

test("addSummary and tidyReason", () => {
  assert.equal(addSummary({ added: 3, already: 1, invalid: ["bad@", "x"] }), "Added 3, already on the list 1, not valid: bad@, x");
  assert.equal(addSummary({ added: 0, already: 2, invalid: [] }), "Added 0, already on the list 2");
  assert.equal(tidyReason("  left \n the company  "), "left the company");
  assert.equal(tidyReason(""), null);
  assert.equal(tidyReason(undefined), null);
  assert.equal(tidyReason("x".repeat(400))?.length, 300);
});

test("mailto: To in list order, each address encoded, subject and body exactly as before", () => {
  const m = buildSheetMailto(["b@example.com", "a+x@example.com", "o'neil@example.com"], "Labour – Fri 20 Nov", "Hi & bye\n*1*");
  assert.equal(m.mode, "FULL");
  assert.equal(
    m.href,
    "mailto:b@example.com,a%2Bx@example.com,o'neil@example.com?subject=Labour%20%E2%80%93%20Fri%2020%20Nov&body=Hi%20%26%20bye%0A*1*"
  );
  assert.equal(encodeAddress("a+x@example.com"), "a%2Bx@example.com");
  assert.equal(outlookToList(["b@example.com", "a@example.com"]), "b@example.com; a@example.com");
});

test("mailto: an empty list is exactly today's link", () => {
  const subject = "Labour, Site & Truck Allocations – Fri 20 Nov", body = "short sheet";
  const m = buildSheetMailto([], subject, body);
  assert.equal(m.href, `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  assert.equal(m.mode, "FULL");
});

test("mailto: too long - the sheet is left out whole, then the To list; never some addresses", () => {
  const to = Array.from({ length: 37 }, (_, i) => `worker${i}@example.com`);
  const body = "📋 *DAY SHIFT*\n".repeat(200);
  const noBody = buildSheetMailto(to, "Subject", body);
  assert.equal(noBody.mode, "NO_BODY");
  assert.ok(noBody.href.length <= MAILTO_SAFE_LENGTH);
  assert.ok(!noBody.href.includes("body="));
  assert.ok(noBody.length > MAILTO_SAFE_LENGTH, "reports the full length it would have been");
  assert.deepEqual(noBody.href.slice(7, noBody.href.indexOf("?")).split(","), to, "every address, in order");

  const big = Array.from({ length: MAX_SHEET_EMAILS }, (_, i) => `a.long.address.number${i}@subdomain.example.com`);
  const none = buildSheetMailto(big, "Subject", "short");
  assert.equal(none.mode, "NO_RECIPIENTS");
  assert.equal(none.href, "mailto:?subject=Subject");

  const empty = buildSheetMailto([], "Subject", body);
  assert.equal(empty.mode, "NO_BODY");
  assert.equal(empty.href, "mailto:?subject=Subject");

  // Right at the limit.
  const exact = "x".repeat(MAILTO_SAFE_LENGTH - "mailto:?subject=S&body=".length);
  assert.equal(buildSheetMailto([], "S", exact).mode, "FULL");
  assert.equal(buildSheetMailto([], "S", exact + "x").mode, "NO_BODY");
});
