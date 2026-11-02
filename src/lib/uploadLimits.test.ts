// Upload limits (2 Nov 2026, Ilies: "yes queue those two"): compliance files and the invoices inbox get the purchases
// treatment - 7 MB a file (the most one save carries under Next's 10 MB body limit), plain "Too large" words, and
// 413 when a body can't be read. Files go to temp folders here, never the real ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataUrlBytes, fileTooLarge, NEXT_BODY_LIMIT, UPLOAD_FILE_MAX, UPLOAD_TOO_LARGE } from "./uploadLimits";
import { saveComplianceFile } from "./compliance/files";
import { saveInvoiceFile } from "./invoiceFiles";

process.env.COMPLIANCE_FILE_DIR = mkdtempSync(path.join(os.tmpdir(), "upload-limits-compliance-"));
process.env.INVOICE_FILE_DIR = mkdtempSync(path.join(os.tmpdir(), "upload-limits-invoices-"));
const pdf = (n: number) => `data:application/pdf;base64,${Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(n - 4)]).toString("base64")}`;

test("7 MB a file, and a 7 MB file's save fits under Next's 10 MB body limit", () => {
  assert.equal(UPLOAD_FILE_MAX, 7 * 1024 * 1024);
  assert.equal(fileTooLarge(UPLOAD_FILE_MAX), false);
  assert.equal(fileTooLarge(UPLOAD_FILE_MAX + 1), true);
  const body = JSON.stringify({ ticketId: "t1", originalName: "card.pdf", dataUrl: pdf(UPLOAD_FILE_MAX) });
  assert.ok(Buffer.byteLength(body) < NEXT_BODY_LIMIT, "the at-limit save is under 10 MB");
  assert.equal(dataUrlBytes(pdf(UPLOAD_FILE_MAX)), UPLOAD_FILE_MAX, "the browser's size check reads the data URL right");
  assert.equal(dataUrlBytes("data:text/plain;base64,YQ=="), 1);
  assert.equal(UPLOAD_TOO_LARGE, "Too large (7 MB per file) - send big files one at a time.");
});

test("compliance files: exactly 7 MB is kept, one byte over is refused in plain words", async () => {
  const ok = await saveComplianceFile(pdf(UPLOAD_FILE_MAX), "card.pdf");
  assert.ok("fileName" in ok, JSON.stringify(ok).slice(0, 80));
  const over = await saveComplianceFile(pdf(UPLOAD_FILE_MAX + 1), "card.pdf");
  assert.deepEqual(over, { error: UPLOAD_TOO_LARGE });
});

test("the invoices inbox: 7 MB for every file it takes; other callers keep their own caps", async () => {
  const cap = { maxBytes: UPLOAD_FILE_MAX, tooLarge: UPLOAD_TOO_LARGE };
  assert.ok("fileName" in (await saveInvoiceFile(pdf(UPLOAD_FILE_MAX), "inv.pdf", cap)));
  assert.deepEqual(await saveInvoiceFile(pdf(UPLOAD_FILE_MAX + 1), "inv.pdf", cap), { error: UPLOAD_TOO_LARGE });
  const csv = `data:text/csv;base64,${Buffer.alloc(UPLOAD_FILE_MAX + 1, 0x41).toString("base64")}`;
  assert.deepEqual(await saveInvoiceFile(csv, "register.csv", cap), { error: UPLOAD_TOO_LARGE }, "a register spreadsheet too");
  assert.ok("fileName" in (await saveInvoiceFile(pdf(UPLOAD_FILE_MAX + 1), "answer.pdf")), "without the cap, the type's own limit applies (answers to questions)");
});

test("the upload routes answer an unreadable body with 413 'Too large', never a validation message", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  for (const p of ["../app/api/compliance/files/route.ts", "../app/api/invoice-inbox/route.ts"]) {
    const src = read(p);
    assert.match(src, /readJsonBody\(req, UPLOAD_TOO_LARGE\)/, p);
    assert.doesNotMatch(src.slice(src.indexOf("export const POST")), /req\.json\(\)\.catch\(\(\) => \(\{\}\)\)/, `${p}: no silent {}`);
  }
  assert.match(read("./jsonBody.ts"), /status: 413/);
});
