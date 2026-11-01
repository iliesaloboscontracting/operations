// Purchase / hire requests with suppliers' quotes (lib/purchases/quotes.ts, files.ts - 2 Nov 2026): the kind, a
// quote as typed, the quote picked on approval, the narrow money exception for links, and the quote-file checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chosenQuote, canEditOwn, kindOf, linkMayCarryMoney, maySeeQuoteFile, parseQuote, SEES_ALL_REQUESTS } from "./quotes";
import { checkQuoteFile, isStoredName } from "./files";

test("Q1 (Ilies, 2 Nov 2026): Managers, Admins and the coordinator see every request; a quote file follows who sees it", () => {
  assert.deepEqual([...SEES_ALL_REQUESTS].sort(), ["ADMIN", "COORDINATOR", "MANAGER"]);
  const req = { requestedByUserId: "u-alex" };
  for (const role of ["ADMIN", "MANAGER", "COORDINATOR", "ACCOUNTS"]) assert.equal(maySeeQuoteFile({ id: "x", role, directorAccess: false }, req), true, role);
  assert.equal(maySeeQuoteFile({ id: "d", role: "DIRECTOR", directorAccess: true }, req), true, "a director");
  for (const role of ["VIEWER", "TIMESHEETS"]) assert.equal(maySeeQuoteFile({ id: "x", role, directorAccess: false }, req), false, role);
  assert.equal(maySeeQuoteFile({ id: "u-alex", role: "VIEWER", directorAccess: false }, req), true, "the person who asked");
  assert.equal(maySeeQuoteFile({ id: "x", role: "VIEWER", directorAccess: false }, { requestedByUserId: null }), false, "a link's request isn't a Viewer's");
});

const b64 = (bytes: number[], pad = 16) => Buffer.from([...bytes, ...new Array(pad).fill(0)]).toString("base64");
const PDF = `data:application/pdf;base64,${b64([0x25, 0x50, 0x44, 0x46])}`;
const PNG = `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])}`;
const JPG = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0])}`;
const WEBP = `data:image/webp;base64,${Buffer.from("RIFF\0\0\0\0WEBPVP8 ").toString("base64")}`;

test("a request is a PURCHASE or a HIRE - anything else is a purchase", () => {
  assert.equal(kindOf("HIRE"), "HIRE");
  for (const v of ["PURCHASE", undefined, "", "hire", "RENT", 3]) assert.equal(kindOf(v), "PURCHASE", String(v));
});

test("a quote: a supplier, and optionally a price, details with prices, a link", () => {
  const q = parseQuote({ supplier: "Sydney Tools", priceExGst: "$1,250.50", details: "Includes delivery ($80). 3-day lead time.", linkUrl: "https://example.test/q/1" });
  assert.ok("quote" in q && q.quote.priceExGst === 1250.5 && /\$80/.test(q.quote.details ?? ""));
  assert.ok("quote" in parseQuote({ supplier: "Kennards" }), "the price and details are optional");
  assert.ok("error" in parseQuote({ priceExGst: 10 }), "a supplier is needed");
  assert.ok("error" in parseQuote({ supplier: "X", priceExGst: "lots" }), "a nonsense price");
  assert.ok("error" in parseQuote({ supplier: "Coates", linkUrl: "javascript:alert(1)" }), "only http(s) links");
});

test("D3: approving picks a quote; one quote is the default; none = as before", () => {
  const two = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(chosenQuote(two, "b"), { id: "b" });
  assert.ok("error" in chosenQuote(two, undefined), "two quotes need a pick");
  assert.ok("error" in chosenQuote(two, "zzz"), "a quote from another request");
  assert.deepEqual(chosenQuote([{ id: "a" }], undefined), { id: "a" }, "a single quote is pre-selected");
  assert.deepEqual(chosenQuote([], undefined), { id: null }, "an older request with no quotes approves as before");
});

test("the requester edits their own only while it's with the approvers", () => {
  for (const s of ["REQUESTED", "NEEDS_INFO"]) assert.equal(canEditOwn(s), true, s);
  for (const s of ["CHECKED", "APPROVED", "DECLINED", "ORDERED", "CLOSED", "CANCELLED"]) assert.equal(canEditOwn(s), false, s);
});

test("the money exception is the OFFICE link's purchase screens only - no other link kind, no other screen", () => {
  assert.equal(linkMayCarryMoney("OFFICE", "PURCHASES"), true);
  for (const kind of ["SUPERVISOR", "HANDOVER", "DRIVER", "POSTER", "", null, undefined]) assert.equal(linkMayCarryMoney(kind, "PURCHASES"), false, String(kind));
  for (const screen of ["TODO", "REQUESTS", "RECEIPTS", "REIMBURSEMENTS", "LOG", "HIRE", "HOME", "purchases"]) assert.equal(linkMayCarryMoney("OFFICE", screen), false, screen);
});

test("quote files: PDF / JPEG / PNG / WebP, checked by their first bytes, capped", () => {
  for (const [url, name] of [[PDF, "quote.pdf"], [PNG, "quote.png"], [JPG, "quote.jpeg"], [WEBP, "quote.webp"]]) {
    const f = checkQuoteFile(url, name);
    assert.ok("bytes" in f, `${name}: ${"error" in f ? f.error : ""}`);
  }
  assert.ok("error" in checkQuoteFile(`data:application/pdf;base64,${b64([0x89, 0x50, 0x4e, 0x47])}`, "fake.pdf"), "a PNG called .pdf");
  assert.ok("error" in checkQuoteFile(`data:text/html;base64,${Buffer.from("<script>").toString("base64")}`, "x.html"), "not a PDF or photo");
  assert.ok("error" in checkQuoteFile(`data:application/octet-stream;base64,${Buffer.from("MZ..").toString("base64")}`, "x.exe"));
  assert.ok("error" in checkQuoteFile(`data:image/png;base64,`, "x.png"), "empty");
  assert.ok("error" in checkQuoteFile(PDF, ""), "no name");
  const big = `data:application/pdf;base64,${Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(15 * 1024 * 1024)]).toString("base64")}`;
  assert.ok("error" in checkQuoteFile(big, "big.pdf"), "over the cap");
  assert.ok(isStoredName("1730000000000-0123456789abcdef.pdf"));
  for (const n of ["../.env", "1-0123456789abcdef.pdf/../x", "x.pdf", "1730000000000-0123456789abcdef.exe"]) assert.equal(isStoredName(n), false, n);
});
