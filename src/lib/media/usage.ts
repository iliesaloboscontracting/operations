// PS-043 (11 Nov 2026): the media bucket's daily usage watch. A signed upload address binds one key, one type and one
// length, and the server never hands out another once an upload is READY - but an address still within its few minutes
// can be used again (a new VERSION of the same key), and unfinished multipart parts sit in the bucket unseen. Once a
// Sydney day this lists every version (ListObjectVersions) and every unfinished multipart upload (ListMultipartUploads)
// - on the allowed host only, through the store - and compares the total with what Operations recorded (each checked
// upload's storedBytes, plus uploads still on their way). ONE Admin push a day (PhotoCapNotice "*media" MEDIA_USAGE)
// when the bucket holds more than recorded + 5% + 100 MB, or a READY key has more than one version. Read-only: it
// never deletes, aborts or changes anything. If the bucket key isn't allowed to list, a scrubbed note is logged once
// and the watch skips. Never touches an upload. MEDIA_USAGE_WATCH=off stops it.
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { usageVerdict, usageWatchOn } from "./rules";
import { getMediaStore, MediaStoreError } from "./store";
import { noticeOnce } from "./protocol";

const memo = globalThis as unknown as { __mediaUsageDay?: string; __mediaUsageDenied?: boolean };

export type UsageResult = { ran: boolean; skipped?: string; bucketBytes?: number; recordedBytes?: number; extraVersionKeys?: number; reasons?: string[]; notified?: boolean };

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
  const rows = await prisma.mediaObject.findMany({ select: { objectKey: true, state: true, storedBytes: true, bytes: true, abortedAt: true } });
  // Recorded: what each checked upload stored, and what an upload still on its way (not stopped) declared.
  const recordedBytes = rows.reduce((a, r) => a + (r.storedBytes ?? (r.state === "PENDING" && !r.abortedAt ? r.bytes : 0)), 0);
  const bucketBytes = versions.reduce((a, v) => a + v.size, 0) + uploads.reduce((a, u) => a + u.bytes, 0);
  const ready = new Set(rows.filter((r) => r.state === "READY").map((r) => r.objectKey));
  const perKey = new Map<string, number>();
  for (const v of versions) if (ready.has(v.key)) perKey.set(v.key, (perKey.get(v.key) ?? 0) + 1);
  const extraVersionKeys = [...perKey.values()].filter((n) => n > 1).length;
  const v = usageVerdict({ bucketBytes, recordedBytes, extraVersionKeys });
  let notified = false;
  if (v.alert) {
    const gb = (n: number) => `${Math.round((n / 1024 ** 3) * 10) / 10} GB`;
    notified = await noticeOnce("MEDIA_USAGE", {
      title: "Media bucket: more stored than recorded",
      body: [v.reasons.includes("OVER") ? `The bucket holds ${gb(bucketBytes)}; Operations recorded ${gb(recordedBytes)}.` : "",
        v.reasons.includes("EXTRA_VERSION") ? `${extraVersionKeys} checked upload${extraVersionKeys > 1 ? "s have" : " has"} an extra version (sent again after it was checked - never shown).` : ""].filter(Boolean).join(" "),
    }).catch(() => false);
  }
  return { ran: true, bucketBytes, recordedBytes, extraVersionKeys, reasons: v.reasons, notified };
}
