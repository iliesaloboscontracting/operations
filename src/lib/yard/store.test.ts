// YD-003 (Ilies approved 4 Nov 2026): a yard move only happens if the request is still in the
// status that was checked. A stand-in database says "nothing matched" (someone cancelled / pulled
// it back in between): the answer is 409, nothing else is written, and a photo saved for a READY
// that didn't happen is removed again. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SiteRequest } from "@prisma/client";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yard-store-test-"));
process.env.TOOL_PHOTO_DIR = dir;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const stale = (status: string) => ({ id: "r1", number: 5, status, kind: "TOOLS", summary: "grinder", siteLabel: "Myers", siteLinkId: "l1", yardAt: new Date() }) as unknown as SiteRequest;
// Records what was asked; never matches (the record has moved on).
function movedOn() {
  const calls: { where: unknown; data: unknown }[] = [];
  let reads = 0;
  const db = {
    siteRequest: {
      updateMany: async (a: { where: unknown; data: unknown }) => { calls.push(a); return { count: 0 }; },
      findUnique: async () => { reads++; return null; },
    },
  };
  return { db: db as never, calls, reads: () => reads };
}

test("READY on a request that moved on: 409, conditional on YARD, and the saved photo is removed", async () => {
  const { applyYardAction } = await import("./store");
  const f = movedOn();
  const out = await applyYardAction(stale("YARD"), "READY", { by: "Yard - Sam", photo: PNG, note: "only 1" }, f.db);
  assert.deepEqual(out, { error: "It changed - reload the list.", status: 409 });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].where, { id: "r1", status: "YARD" });
  assert.equal(f.reads(), 0);
  assert.deepEqual(fs.readdirSync(dir), [], "no photo file left behind");
});

test("CANT_DO and COLLECTED on a request that moved on: 409, each conditional on the status checked", async () => {
  const { applyYardAction } = await import("./store");
  const a = movedOn();
  assert.equal((await applyYardAction(stale("YARD"), "CANT_DO", { by: "Yard - Sam", reason: "none left" }, a.db) as { status: number }).status, 409);
  assert.deepEqual(a.calls[0].where, { id: "r1", status: "YARD" });
  const b = movedOn();
  assert.equal((await applyYardAction(stale("READY"), "COLLECTED", { by: "Tom" }, b.db) as { status: number }).status, 409);
  assert.deepEqual(b.calls[0].where, { id: "r1", status: "READY" });
});

test("a status the rules already refuse never reaches the database", async () => {
  const { applyYardAction } = await import("./store");
  const f = movedOn();
  const out = await applyYardAction(stale("CANCELLED"), "READY", { by: "Yard - Sam", photo: PNG }, f.db);
  assert.equal((out as { status: number }).status, 409);
  assert.equal(f.calls.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
