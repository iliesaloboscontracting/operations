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

// YD-003a (Ilies approved 4 Nov 2026): a supervisor's cancel from their link is always conditional on the status read.
function onceOnly() {
  const calls: { where: unknown; data: unknown }[] = [];
  let status = "SEEN";
  const db = {
    siteRequest: {
      updateMany: async (a: { where: { status: string }; data: { status: string } }) => {
        calls.push(a);
        if (a.where.status !== status) return { count: 0 };
        status = a.data.status;
        return { count: 1 };
      },
      findUnique: async () => ({ ...stale(status) }),
    },
  };
  return { db: db as never, calls, setStatus: (s: string) => { status = s; } };
}

test("YD-003a: cancel twice at once - one CANCELLED (one event), the other 409 with nothing written", async () => {
  const { cancelFromLink, CHANGED } = await import("./store");
  const f = onceOnly();
  const events: string[] = [];
  const record = (async (_id: string, action: string) => { events.push(action); }) as never;
  const [a, b] = await Promise.all([cancelFromLink(stale("SEEN"), "Tom", null, f.db, record), cancelFromLink(stale("SEEN"), "Tom", null, f.db, record)]);
  const ok = [a, b].filter((x) => "request" in x);
  assert.equal(ok.length, 1);
  assert.deepEqual([a, b].find((x) => "error" in x), CHANGED);
  assert.deepEqual(events, ["CANCELLED"], "one CANCELLED event");
  for (const c of f.calls) assert.deepEqual(c.where, { id: "r1", status: "SEEN" }, "conditional on the status read");
});

test("YD-003a: a cancel that crosses the Admin's 'send to yard' gets 409 - nothing written, nobody alerted", async () => {
  const { cancelFromLink, CHANGED } = await import("./store");
  const f = onceOnly();
  f.setStatus("YARD"); // the Admin's send landed after the supervisor's page read SEEN
  const events: string[] = [];
  const rec = (async (_i: string, a: string) => { events.push(a); }) as never;
  const out = await cancelFromLink(stale("SEEN"), "Tom", "not needed", f.db, rec);
  assert.deepEqual(out, CHANGED);
  assert.equal(events.length, 0);
  // Reloaded, the supervisor cancels again - now from YARD: it goes through, and the route tells the yard.
  const again = await cancelFromLink(stale("YARD"), "Tom", "not needed", f.db, rec);
  assert.ok("request" in again);
  assert.deepEqual(events, ["CANCELLED"]);
  // A closed one is refused before anything is asked of the database.
  const g = onceOnly();
  assert.deepEqual(await cancelFromLink(stale("CANCELLED"), "Tom", null, g.db), { error: "This one is already closed.", status: 400 });
  assert.equal(g.calls.length, 0);
});

test("YD-003a: the link's CANCEL goes only through cancelFromLink (no unconditional update), alerts only after it", () => {
  const route = fs.readFileSync(new URL("../../app/api/site/[token]/requests/[id]/route.ts", import.meta.url), "utf8");
  const cancel = route.slice(route.indexOf('body.action === "CANCEL"'), route.indexOf('body.action === "COLLECTED"'));
  assert.match(cancel, /const out = await cancelFromLink\(r, link\.person\.name, text\(body\.reason\) \|\| null\);\s*if \("error" in out\) return NextResponse\.json/);
  assert.doesNotMatch(cancel, /siteRequest\.update\(/);
  assert.ok(cancel.indexOf("cancelFromLink(") < cancel.indexOf("notifyRequestUpdate(") && cancel.indexOf("cancelFromLink(") < cancel.indexOf("notifyYard("), "alerts only after the cancel went through");
});