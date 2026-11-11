// PS-043 (11 Nov 2026): the media bucket's daily usage watch. A signed upload address binds one key, one type and one
// length, and the server never hands out another once an upload is READY - but an address still within its few minutes
// can be used again (a new VERSION of the same key), and unfinished multipart parts sit in the bucket unseen. Once a
// Sydney day this lists every version (ListObjectVersions) and every unfinished multipart upload (ListMultipartUploads)
// - on the allowed host only, through the store - and compares the total with what Operations recorded (each checked
// upload's storedBytes, plus uploads still on their way - only while fresh, PS-049). ONE Admin push a day (PhotoCapNotice
// "*media" MEDIA_USAGE) when the bucket holds more than recorded + 5% + 100 MB, a READY key has more than one version, or
// (PS-049) any key's versions add up to more than 2x its declared size, whatever its state. Read-only: it
// never deletes, aborts or changes anything. If the bucket key isn't allowed to list, a scrubbed note is logged once
// and the watch skips. Never touches an upload. MEDIA_USAGE_WATCH=off stops it.
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { usageFigures, usageVerdict, usageWatchOn } from "./rules";
import { getMediaStore, MediaStoreError } from "./store";
import { noticeOnce } from "./protocol";

const memo = globalThis as unknown as { __mediaUsageDay?: string; __mediaUsageDenied?: boolean };

export type UsageResult = { ran: boolean; skipped?: string; bucketBytes?: number; recordedBytes?: number; extraVersionKeys?: number; oversizeKeys?: number; reasons?: string[]; notified?: boolean };

export async function watchBucketUsage(o: { force?: boolean } = {}): Promise<UsageResult> {
  if (!usageWatchOn()) return { ran: false, skipped: "OFF" };
  const day = todaySydney();
  if (!o.force && memo.__mediaUsageDay === day) return { ran: false, skipped: "DONE_TODAY" };
  const store = await getMediaStore({ read: true });
  if (!store) return { ran: false, skipped: "NO_STORE" };
  memo.__mediaUsageDay = day;
  let versions: Awaited<ReturnType<typeof store.listVersions>>, uploads: Awaited<ReturnType<typeof store.listUploads>>;
  try {
    [versions, uploads] = await Promise.all([store.listVersions(), store.listUploads()]);
  } catch (e) {
    const code = e instanceof MediaStoreError ? e.code : "failed";
    if (!memo.__mediaUsageDenied) console.error("media usage watch skipped", `(${code})`); // once - never a key or an address
    memo.__mediaUsageDenied = true;
    return { ran: false, skipped: /AccessDenied|\/403/.test(code) ? "DENIED" : "ERROR" };
  }
  const rows = await prisma.mediaObject.findMany({ select: { objectKey: true, state: true, storedBytes: true, bytes: true, abortedAt: true, createdAt: true, kind: true } });
  // PS-049: recorded = each checked upload's stored bytes + a PENDING declaration only while fresh (rules.ts countedBytes).
  const { bucketBytes, recordedBytes, extraVersionKeys, oversizeKeys } = usageFigures(rows, versions, uploads, new Date());
  const v = usageVerdict({ bucketBytes, recordedBytes, extraVersionKeys, oversizeKeys });
  let notified = false;
  if (v.alert) {
    const gb = (n: number) => `${Math.round((n / 1024 ** 3) * 10) / 10} GB`;
    notified = await noticeOnce("MEDIA_USAGE", {
      title: "Media bucket: more stored than recorded",
      body: [v.reasons.includes("OVER") ? `The bucket holds ${gb(bucketBytes)}; Operations recorded ${gb(recordedBytes)}.` : "",
        v.reasons.includes("EXTRA_VERSION") ? `${extraVersionKeys} checked upload${extraVersionKeys > 1 ? "s have" : " has"} an extra version (sent again after it was checked - never shown).` : "",
        v.reasons.includes("OVERSIZE_KEY") ? `${oversizeKeys} upload${oversizeKeys > 1 ? "s hold" : " holds"} more than twice the size declared (the same address used again and again).` : ""].filter(Boolean).join(" "),
    }).catch(() => false);
  }
  return { ran: true, bucketBytes, recordedBytes, extraVersionKeys, oversizeKeys, reasons: v.reasons, notified };
}
