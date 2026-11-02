// Purchase / hire requests with suppliers' quotes (lib/purchases/quotes.ts, files.ts - 2 Nov 2026): the kind, a
// quote as typed, the quote picked on approval, the narrow money exception for links, and the quote-file checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  alertBody, BODY_TOO_LARGE, chosenQuote, canEditOwn, dailyUploadsError, fileBudgetError, kindOf, linkMayCarryMoney, maySeeQuoteFile, parseQuote, REQUEST_FILE_BUDGET,
  quoteChangeNote, SEES_ALL_REQUESTS, TOO_LARGE, TOO_MANY, uploaderKey,
} from "./quotes";

test("PQ-002 / PQ-010: a changed quote's history says what changed, before -> after", () => {
  const A = "1730500000000-0123456789abcdef.pdf", B = "1730500000001-fedcba9876543210.pdf";
  const before = { supplier: "Sydney Tools", priceExGst: 1180, details: "Two TE 1000s", linkUrl: null, fileOriginalName: "quote-a.pdf", fileName: A };
  assert.equal(quoteChangeNote(before, { ...before, supplier: "Sydney Tools Pty Ltd", priceExGst: 1095.5, fileOriginalName: "quote-b.pdf", fileName: B }, true),
    `Quote changed (Sydney Tools Pty Ltd): supplier Sydney Tools -> Sydney Tools Pty Ltd; price $1,180.00 -> $1,095.50; file quote-a.pdf (${A}) -> quote-b.pdf (${B})`);
  assert.equal(quoteChangeNote(before, { ...before, priceExGst: null }, false), "Quote changed (Sydney Tools): price $1,180.00 -> no price");
  assert.equal(quoteChangeNote({ ...before, fileOriginalName: null, fileName: null }, { ...before }, true), `Quote changed (Sydney Tools): file none -> quote-a.pdf (${A})`);
  assert.equal(quoteChangeNote(before, { ...before }, false), "Quote changed (Sydney Tools): nothing visible changed");
  // The old details and link are kept (about 200 characters).
  const long = "x".repeat(300);
  const n = quoteChangeNote({ ...before, details: long, linkUrl: "https://a.test/q" }, { ...before, details: "Now includes delivery", linkUrl: "https://b.test/q" }, false);
  assert.match(n, /details "x{200}\.\.\." -> "Now includes delivery"/);
  assert.match(n, /link "https:\/\/a\.test\/q" -> "https:\/\/b\.test\/q"/);
});

test("PQ-010: a same-name replacement is still recorded - by both stored names", () => {
  const A = "1730500000000-0123456789abcdef.pdf", B = "1730500000001-fedcba9876543210.pdf";
  const before = { supplier: "Kennards", priceExGst: 990, details: null, linkUrl: null, fileOriginalName: "quote.pdf", fileName: A };
  const note = quoteChangeNote(before, { ...before, fileName: B }, true);
  assert.equal(note, `Quote changed (Kennards): file quote.pdf (${A}) -> quote.pdf (${B})`);
  assert.ok(note.includes(A) && note.includes(B), "which stored file was there before, and which is there now");
});

test("PQ-001: 30 MB over a request's whole life, 20 quote files a day per link or login, plain words", () => {
  const MB = 1024 * 1024;
  assert.equal(fileBudgetError(0, 30 * MB), null, "exactly 30 MB fits");
  assert.equal(fileBudgetError(29 * MB, 2 * MB), TOO_LARGE, "files already on it (or replaced) count");
  assert.equal(fileBudgetError(REQUEST_FILE_BUDGET, 0), null, "no new file - nothing to refuse");
  assert.equal(dailyUploadsError(19, 1), null);
  assert.equal(dailyUploadsError(20, 1), TOO_MANY);
  assert.equal(dailyUploadsError(18, 3), TOO_MANY, "a request with several files counts them all");
  assert.equal(dailyUploadsError(500, 0), null, "no file - no cap");
  assert.match(TOO_LARGE, /^Too large/);
  assert.match(TOO_MANY, /^Too many/);
  assert.equal(uploaderKey({ linkId: "l1" }), "LINK:l1");
  assert.equal(uploaderKey({ userId: "u1" }), "USER:u1");
  // A file is written only after the save it belongs to has gone through - never before (no orphan on a conflict).
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(store, /saveQuoteFile/, "the old write-first helper is gone");
  for (const fn of ["export async function createRequest", "export async function editOwnRequest"]) {
    const start = store.indexOf(fn);
    assert.ok(start >= 0 && store.indexOf("\n}\n", start) > start, `${fn} found`);
    const body = store.slice(start, store.indexOf("\n}\n", start));
    const writes = [...body.matchAll(/writePending\(/g)].map((m) => m.index!);
    assert.ok(writes.length > 0, `${fn}: writes its files`);
    for (const w of writes) assert.ok(body.lastIndexOf("$transaction(", w) !== -1 && body.lastIndexOf("$transaction(", w) < w, `${fn}: every write comes after a transaction`);
  }
});
import { checkQuoteFile, isStoredName, QUOTE_FILE_MAX } from "./files";

test("PQ-004: a phone alert's body has no free text - nothing from what was asked, no price", () => {
  const r = { requestedBy: "Alex", kind: "HIRE", what: "Scissor lift 19ft x 3, $1,450/wk from Kennards 0412 345 678", ref: "P-0042" };
  const body = alertBody(r.requestedBy, r.kind, r.ref);
  assert.equal(body, "Alex asked for a hire (P-0042)");
  const digitsInWhat = r.what.match(/\d+/g) ?? [];
  for (const d of digitsInWhat) assert.ok(!body.replace(r.ref, "").includes(d), `the body has no "${d}" from what`);
  assert.ok(!/\$/.test(body));
  assert.equal(alertBody("Iliesa", "PURCHASE", "P-0001"), "Iliesa asked for a purchase (P-0001)");
  // And the store never puts the request's own text into a push body.
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const pushes = store.split("\n").filter((l) => /pushTo(Users|SiteLinks)\(/.test(l));
  assert.ok(pushes.length >= 3, "the alerts are found");
  for (const l of pushes) assert.doesNotMatch(l, /\.(what|why|details|supplier|infoQuestion|infoAnswer|decisionNote)\b/, l.trim().slice(0, 80));
});

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
  // 7 MB a file, PDFs and photos alike (option A, Ilies 2 Nov 2026) - and that still fits one save under Next's 10 MB.
  const sized = (n: number, head = [0x25, 0x50, 0x44, 0x46], mime = "application/pdf") => `data:${mime};base64,${Buffer.concat([Buffer.from(head), Buffer.alloc(n - head.length)]).toString("base64")}`;
  assert.equal(QUOTE_FILE_MAX, 7 * 1024 * 1024);
  assert.ok("bytes" in checkQuoteFile(sized(QUOTE_FILE_MAX), "at-limit.pdf"), "exactly 7 MB fits");
  const over = checkQuoteFile(sized(QUOTE_FILE_MAX + 1), "over.pdf");
  assert.ok("error" in over && /^Too large: a quote file can be up to 7 MB/.test(over.error), "one byte over is refused, in plain words");
  assert.ok("error" in checkQuoteFile(sized(QUOTE_FILE_MAX + 1, [0xff, 0xd8, 0xff, 0xe0], "image/jpeg"), "over.jpg"), "photos too");
  const atLimit = `{"action":"ADD_QUOTE","quote":{"supplier":"X","file":{"name":"q.pdf","dataUrl":"${sized(QUOTE_FILE_MAX)}"}}}`;
  assert.ok(Buffer.byteLength(atLimit) < 10 * 1024 * 1024, "a 7 MB file's save is under Next's 10 MB body limit");
  assert.match(BODY_TOO_LARGE, /^Too large: send big quote files one at a time with Add another supplier \(7 MB each\)/);
  assert.ok(isStoredName("1730000000000-0123456789abcdef.pdf"));
  for (const n of ["../.env", "1-0123456789abcdef.pdf/../x", "x.pdf", "1730000000000-0123456789abcdef.exe"]) assert.equal(isStoredName(n), false, n);
});
