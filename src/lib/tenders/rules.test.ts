import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSecret, bytesMatch, cleanFileName, estimatingWords, isIsoDate, quoteFileKind, quoteMeta, safeId } from "./rules";

test("the board key needs 16+ characters", () => {
  assert.equal(boardSecret({}), null);
  assert.equal(boardSecret({ BOARD_SECRET: "short" }), null);
  assert.equal(boardSecret({ BOARD_SECRET: "x".repeat(16) }), "x".repeat(16));
});

test("only plain ids reach an Estimating path", () => {
  for (const ok of ["abc123", "t_1-2"]) assert.ok(safeId(ok), ok);
  for (const bad of ["", "../x", "a/b", "a%2Fb", "a.b", "x".repeat(65), 7, null]) assert.ok(!safeId(bad), String(bad));
  assert.ok(isIsoDate("2026-11-17"));
  assert.ok(!isIsoDate("17/11/2026"));
});

test("quote files: PDF or Word only, name and first bytes must agree", () => {
  assert.equal(quoteFileKind("q.pdf", "data:application/pdf;base64,AA"), "pdf");
  assert.equal(quoteFileKind("q.docx", "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AA"), "docx");
  assert.equal(quoteFileKind("q.exe", "data:application/pdf;base64,AA"), null);
  assert.equal(quoteFileKind("q.pdf", "data:text/html;base64,AA"), null);
  assert.ok(bytesMatch("pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])));
  assert.ok(!bytesMatch("pdf", new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])));
  assert.ok(bytesMatch("docx", new Uint8Array([0x50, 0x4b, 3, 4, 0])));
  assert.equal(cleanFileName("C:\\x\\..\\Quote 26_1.pdf"), "Quote 26_1.pdf");
  assert.equal(cleanFileName("<script>.pdf"), "_script_.pdf");
});

test("the Log my quote form", () => {
  assert.ok("error" in quoteMeta({ builder: "B", valueExGst: 10 }, false), "builder too short");
  assert.ok("error" in quoteMeta({ builder: "Builder", valueExGst: 0 }, false), "value needed");
  assert.ok("error" in quoteMeta({ builder: "Builder", valueExGst: 10 }, true), "quote no needed with no tender");
  assert.ok("error" in quoteMeta({ builder: "Builder", valueExGst: 10, submittedDate: "17/11" }, false));
  const m = quoteMeta({ builder: " Acme\u200B Builders ", valueExGst: "$12,500.50", quoteNo: "26_001", revision: "R1", submittedDate: "2026-11-17", version: 3 }, true);
  assert.ok("meta" in m);
  if ("meta" in m) assert.deepEqual(m.meta, { builder: "Acme Builders", valueExGst: 12500.5, quoteNo: "26_001", revision: "R1", submittedDate: "2026-11-17", version: 3 });
});

test("Estimating's codes in plain words", () => {
  assert.match(estimatingWords(0), /isn't answering/);
  assert.match(estimatingWords(403, "not-an-issuer"), /Ilies, Yoel and Nick/);
  assert.match(estimatingWords(409, "stale"), /refresh/);
});
