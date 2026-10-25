// Receipts (R1 capture): what a phone may send, that nothing it gets back carries a price, the
// odometer token after a truck sign-in, and that only real photos are stored. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fs from "fs";
import { LIMITS, STATUS_LABEL, linkSafe, parseReceipt } from "./rules";

process.env.AUTH_SECRET ??= "test-secret-for-receipts-0123456789";
process.env.RECEIPT_FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "receipts-test-"));

const id = (n: number) => `cm${String(n).padStart(23, "0")}`;
const tip = (x: Record<string, unknown> = {}) => ({ kind: "TIP", photoIds: [id(1)], jobId: id(9), asbestos: false, ...x });
const fuel = (x: Record<string, unknown> = {}) => ({ kind: "FUEL", photoIds: [id(1)], vehicleId: id(8), ...x });
const err = (b: Record<string, unknown>) => (parseReceipt(b) as { error: string }).error;

test("a tip docket needs a photo, a job and the asbestos tap", () => {
  assert.deepEqual(parseReceipt(tip()), { kind: "TIP", jobId: id(9), vehicleId: null, asbestos: false, photoIds: [id(1)] });
  assert.equal((parseReceipt(tip({ asbestos: true })) as { asbestos: boolean }).asbestos, true);
  assert.match(err(tip({ photoIds: [] })), /photo/);
  assert.match(err(tip({ jobId: undefined })), /job/);
  assert.match(err(tip({ asbestos: undefined })), /Asbestos/);
  assert.match(err(tip({ asbestos: "yes" })), /Asbestos/);
  // a truck sent with a tip docket is ignored, not stored
  assert.equal((parseReceipt(tip({ vehicleId: id(8) })) as { vehicleId: string | null }).vehicleId, null);
});

test("a fuel receipt needs a photo and a truck - no job, no asbestos", () => {
  assert.deepEqual(parseReceipt(fuel({ jobId: id(9), asbestos: true })), { kind: "FUEL", jobId: null, vehicleId: id(8), asbestos: null, photoIds: [id(1)] });
  assert.match(err(fuel({ vehicleId: "" })), /truck/);
});

test("kind, photo count and ids are checked", () => {
  assert.match(err({ ...tip(), kind: "TOLL" }), /Tip docket or fuel/);
  assert.match(err(tip({ photoIds: [id(1), id(2), id(3)] })), new RegExp(`At most ${LIMITS.photosPerReceipt}`));
  // duplicates collapse; junk ids are dropped
  assert.deepEqual((parseReceipt(tip({ photoIds: [id(1), id(1), "../../etc", 5] })) as { photoIds: string[] }).photoIds, [id(1)]);
  assert.match(err(tip({ jobId: "x'; drop table" })), /job/);
});

test("what a phone gets back never carries a dollar figure", () => {
  const row = { id: id(1), kind: "TIP", label: "Tip docket", for: "Myers (night)", at: "7:42am", asbestos: true, photos: 2, status: STATUS_LABEL.SENT };
  assert.equal(linkSafe({ today: [row] }), true);
  assert.equal(linkSafe({ today: [{ ...row, status: "Read - $412.50" }] }), false);
  for (const s of Object.values(STATUS_LABEL)) assert.equal(linkSafe(s), true, s);
});

test("the odometer token: tied to one sign-in, refused when tampered with or after 30 minutes", async () => {
  const { makeOdometerToken, readOdometerToken, makeTicket, readTicket } = await import("../signin");
  const t0 = Date.parse("2026-10-26T06:00:00Z");
  const tok = makeOdometerToken("att123", t0);
  assert.equal(readOdometerToken(tok, t0 + 29 * 60_000), "att123");
  assert.equal(readOdometerToken(tok, t0 + 31 * 60_000), null);
  assert.equal(readOdometerToken(tok.slice(0, -2) + "xx", t0), null);
  assert.equal(readOdometerToken("junk", t0), null);
  // a sign-in ticket isn't an odometer token, and the other way round
  const ticket = makeTicket({ jobIds: ["att123"], method: "POINT", linkId: "l1" }, t0);
  assert.equal(readOdometerToken(ticket, t0), null);
  assert.equal(readTicket(tok, t0), null);
});

test("only real photos are stored, under names that can't leave the folder", async () => {
  const { saveReceiptPhoto, readReceiptPhoto } = await import("./files");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const ok = await saveReceiptPhoto(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  assert.ok("fileName" in ok && /^\d+-[0-9a-f]{16}\.jpg$/.test(ok.fileName));
  if ("fileName" in ok) assert.deepEqual(await readReceiptPhoto(ok.fileName), jpeg);
  assert.match((await saveReceiptPhoto(`data:image/jpeg;base64,${Buffer.from("<html>").toString("base64")}`) as { error: string }).error, /doesn't look like a photo/);
  assert.match((await saveReceiptPhoto("data:image/svg+xml;base64,PHN2Zz4=") as { error: string }).error, /JPEG, PNG or WebP/);
  assert.match((await saveReceiptPhoto(42) as { error: string }).error, /No photo/);
  await assert.rejects(readReceiptPhoto("../../.env"));
});
