// TL-001 (Ilies approved 27 Nov 2026): the daily photo caps on the phone links (bin, tipper load and receipt photos) are
// counted again INSIDE one locked transaction with the save, so parallel requests from one link can't all pass the count
// and fill the disk; and at most a few uploads per link may be in progress at once (like the media bucket's "3 in
// progress per source"). The photo is checked (type, size, first bytes - lib/receipts/files.ts) before anything is written.
// The server is one `next start` process, so the in-progress count is a plain in-memory map (on globalThis so a dev
// reload keeps it). Nothing here deletes anything.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { writeLock } from "./history/store";
import { checkReceiptPhoto, writeReceiptPhoto } from "./receipts/files";

export const IN_FLIGHT_PER_LINK = 3;
export const IN_FLIGHT_MESSAGE = "Photos are still sending - wait a moment and try again.";

const g = globalThis as unknown as { __linkUploadsInFlight?: Map<string, number> };
const inFlight = (g.__linkUploadsInFlight ??= new Map<string, number>());

// Takes one in-progress slot for this key, or null when it already has `max`. The returned function gives it back (once).
export function beginUpload(key: string, max = IN_FLIGHT_PER_LINK): (() => void) | null {
  const n = inFlight.get(key) ?? 0;
  if (n >= max) return null;
  inFlight.set(key, n + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const m = (inFlight.get(key) ?? 1) - 1;
    if (m <= 0) inFlight.delete(key); else inFlight.set(key, m);
  };
}
export const uploadsInFlight = (key: string) => inFlight.get(key) ?? 0;

class OverCap extends Error {}
type Tx = Prisma.TransactionClient;

// Checks the photo, takes an in-progress slot for `key` (the link), then - under the write lock - re-counts the day's
// photos and only if under `cap` writes the file and creates its row (`create`). 429 when over either cap.
export async function savePhotoUnderCap<T>(o: {
  key: string;
  dataUrl: unknown;
  cap: number;
  capMessage: string;
  count: (tx: Tx) => Promise<number>;
  create: (tx: Tx, saved: { fileName: string; sha256: string }) => Promise<T>;
}): Promise<T | { error: string; status: number }> {
  const checked = checkReceiptPhoto(o.dataUrl);
  if ("error" in checked) return { error: checked.error, status: 400 };
  const release = beginUpload(o.key);
  if (!release) return { error: IN_FLIGHT_MESSAGE, status: 429 };
  try {
    return await prisma.$transaction(async (tx) => {
      await writeLock(tx);
      if ((await o.count(tx)) >= o.cap) throw new OverCap(o.capMessage);
      const fileName = await writeReceiptPhoto(checked);
      return o.create(tx, { fileName, sha256: checked.sha256 });
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (e) {
    if (e instanceof OverCap) return { error: e.message, status: 429 };
    throw e;
  } finally {
    release();
  }
}
