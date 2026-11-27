// TL-001 (Ilies approved 27 Nov 2026): the daily photo caps on the phone links (bin, tipper load and receipt photos) are
// counted again right before the save, one save at a time per link, so parallel requests from one link can't all pass
// the count and fill the disk; and at most a few uploads per link may be in progress at once (like the media bucket's
// "3 in progress per source"). The photo is checked (type, size, first bytes - lib/receipts/files.ts) before anything
// is written. The server is one `next start` process, so both the in-progress count and the one-at-a-time queue are
// plain in-memory maps (on globalThis so a dev reload keeps them) - no database lock is held while a file is written
// (a locked transaction around the write timed out other queries under a burst). Nothing here deletes anything.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { checkReceiptPhoto, writeReceiptPhoto } from "./receipts/files";

export const IN_FLIGHT_PER_LINK = 3;
export const IN_FLIGHT_MESSAGE = "Photos are still sending - wait a moment and try again.";

const g = globalThis as unknown as { __linkUploadsInFlight?: Map<string, number>; __linkUploadQueue?: Map<string, Promise<unknown>> };
const inFlight = (g.__linkUploadsInFlight ??= new Map<string, number>());
const queue = (g.__linkUploadQueue ??= new Map<string, Promise<unknown>>());

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

// Runs `fn` after every earlier `oneAtATime(key, ...)` for the same key has finished (whether it worked or not).
export async function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = queue.get(key) ?? Promise.resolve();
  const run = before.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  queue.set(key, tail);
  try {
    return await run;
  } finally {
    if (queue.get(key) === tail) queue.delete(key);
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

// Checks the photo, takes an in-progress slot for `key` (the link), then - one at a time for that key - re-counts the
// day's photos and only if under `cap` writes the file and creates its row (`create`). 429 when over either cap.
export async function savePhotoUnderCap<T>(o: {
  key: string;
  dataUrl: unknown;
  cap: number;
  capMessage: string;
  count: (db: Db) => Promise<number>;
  create: (db: Db, saved: { fileName: string; sha256: string }) => Promise<T>;
}): Promise<T | { error: string; status: number }> {
  const checked = checkReceiptPhoto(o.dataUrl);
  if ("error" in checked) return { error: checked.error, status: 400 };
  const release = beginUpload(o.key);
  if (!release) return { error: IN_FLIGHT_MESSAGE, status: 429 };
  try {
    return await oneAtATime(o.key, async (): Promise<T | { error: string; status: number }> => {
      if ((await o.count(prisma)) >= o.cap) return { error: o.capMessage, status: 429 };
      const fileName = await writeReceiptPhoto(checked);
      return o.create(prisma, { fileName, sha256: checked.sha256 });
    });
  } finally {
    release();
  }
}
