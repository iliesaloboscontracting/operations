// DB-002 / DB-004 / DB-005 (security review of the docket batch upload, approved by Ilies 20 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BATCH_BODY_MAX, BATCH_LIMITS } from "./batchRules";

test("DB-002: the tip lock, the being-read set and the batch loop flag live on globalThis, shared by every route bundle", async () => {
  await import("./runner");
  await import("./batch");
  const g = globalThis as unknown as { __tipChain?: unknown; __receiptInFlight?: unknown; __receiptBatchLooping?: unknown; __receiptBatchChain?: unknown };
  assert.ok(g.__tipChain instanceof Promise, "loading runner.ts puts the tip lock on globalThis");
  assert.ok(g.__receiptInFlight instanceof Set, "...and the being-read set");
  assert.equal(typeof g.__receiptBatchLooping, "boolean", "loading batch.ts puts the loop flag on globalThis");
  assert.ok(g.__receiptBatchChain instanceof Promise, "...and the upload queue (DB-005)");
  // A second copy of the module (another bundle) reuses them: `??=`, never a fresh one.
  const src = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  assert.match(src, /__receiptInFlight \?\?= new Set/);
  assert.match(src, /shared\.__tipChain \?\?= Promise\.resolve\(\)/);
});

test("DB-004: used-up rows never hide a fresh one - the search pages past them", async () => {
  const { pagedDue, MAX_TRIES, SCAN_BOUND } = await import("./runner");
  const used = JSON.stringify({ tries: MAX_TRIES });
  const rows = [...Array.from({ length: 125 }, (_, i) => ({ id: `u${String(i).padStart(4, "0")}`, reading: used })), { id: "zfresh", reading: null }];
  const page = async (cursor: string | null) => { const from = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0; return rows.slice(from, from + 40); };
  assert.deepEqual(await pagedDue(page, 1), ["zfresh"], "the fresh one after 125 used-up rows is found");
  // Bounded: past SCAN_BOUND rows it stops looking.
  const many = [...Array.from({ length: SCAN_BOUND + 40 }, (_, i) => ({ id: `u${String(i).padStart(5, "0")}`, reading: used })), { id: "zlate", reading: null }];
  const page2 = async (cursor: string | null) => { const from = cursor ? many.findIndex((r) => r.id === cursor) + 1 : 0; return many.slice(from, from + 40); };
  assert.deepEqual(await pagedDue(page2, 1), [], `no more than ${SCAN_BOUND} rows are looked at in one go`);
});

test("DB-004: a batch photo is at most 3.5 MB, and the request is cut off before it's read", () => {
  assert.equal(BATCH_LIMITS.photoMaxBytes, Math.round(3.5 * 1024 * 1024));
  assert.ok(BATCH_BODY_MAX < 5 * 1024 * 1024 && BATCH_BODY_MAX > (BATCH_LIMITS.photoMaxBytes * 4) / 3);
  const route = readFileSync(new URL("../../app/api/receipts/batches/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /content-length[\s\S]*BATCH_BODY_MAX[\s\S]*readJsonBody/, "content-length is checked before the body is read");
  const batch = readFileSync(new URL("./batch.ts", import.meta.url), "utf8");
  assert.match(batch, /checkReceiptPhoto\(body\.dataUrl, BATCH_LIMITS\.photoMaxBytes\)/);
  const ui = readFileSync(new URL("../../components/receipts/DocketBatch.tsx", import.meta.url), "utf8");
  assert.match(ui, /size > BATCH_LIMITS\.photoMaxBytes\) dataUrl = await resizePhoto\(item\.file, 2400, 0\.9\)/, "the browser shrinks bigger ones first");
});

test("DB-005: the caps are counted and the receipt made inside one queue", () => {
  const batch = readFileSync(new URL("./batch.ts", import.meta.url), "utf8");
  const inQueue = batch.slice(batch.indexOf("await serial("), batch.indexOf("readBatchSoon();", batch.indexOf("await serial(")));
  assert.match(inQueue, /capProblem/);
  assert.match(inQueue, /receipt\.create/);
});
