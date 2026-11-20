// Office batch upload of tip dockets (20 Nov 2026) - server side. The office (Manager+) starts a batch for one project,
// then sends the photos one per request; each becomes a TIP Receipt (status SENT, officeBatchId) with its photo in
// RECEIPT_FILE_DIR, read in the background by the same reader and plain checks as a phone-sent docket. Rules:
// ./batchRules.ts. Nothing from a batch is ever on a phone link: no sentByResourceId, a siteLinkId no link resolves to,
// and the daily log's docket count leaves batches out. Append-only - REJECT on /receipts is the only way to set one aside.
import { prisma } from "../prisma";
import { UPLOAD_FILE_MAX } from "../uploadLimits";
import { checkReceiptPhoto, writeReceiptPhoto } from "./files";
import { BATCH_LIMITS, batchLinkMarker, capProblem, samePhotoProblem } from "./batchRules";
import { MAX_TRIES, logOf, readReceipt, readingEnabled } from "./runner";

type Problem = { error: string; status: number };
type Who = { id: string; name: string };
const ID = /^[a-z0-9]{20,40}$/;
const dayAgo = () => new Date(Date.now() - 86_400_000);

export async function createBatch(who: Who, body: Record<string, unknown>): Promise<{ id: string; project: string } | Problem> {
  const projectId = typeof body.projectId === "string" && ID.test(body.projectId) ? body.projectId : null;
  const project = projectId ? await prisma.project.findFirst({ where: { id: projectId, archived: false }, select: { id: true, name: true } }) : null;
  if (!project) return { error: "Pick the project the dockets are for.", status: 400 };
  const b = await prisma.receiptBatch.create({ data: { projectId: project.id, createdById: who.id, createdBy: who.name } });
  return { id: b.id, project: project.name };
}

// How many photos this login has put in batches in the last 24 hours.
async function userToday(userId: string): Promise<number> {
  const batches = await prisma.receiptBatch.findMany({ where: { createdById: userId, createdAt: { gte: new Date(Date.now() - (BATCH_LIMITS.batchOpenHours + 24) * 3_600_000) } }, select: { id: true } });
  if (!batches.length) return 0;
  return prisma.receipt.count({ where: { officeBatchId: { in: batches.map((b) => b.id) }, sentAt: { gte: dayAgo() } } });
}

export async function addBatchPhoto(who: Who, batchId: string, body: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const batch = ID.test(batchId) ? await prisma.receiptBatch.findUnique({ where: { id: batchId } }) : null;
  // Only its own uploader adds to a batch, and only while it's open.
  if (!batch || batch.createdById !== who.id) return { error: "Not found", status: 404 };
  if (Date.now() - batch.createdAt.getTime() > BATCH_LIMITS.batchOpenHours * 3_600_000) return { error: "That batch is closed - start a new one.", status: 409 };
  const cap = capProblem({ inBatch: await prisma.receipt.count({ where: { officeBatchId: batch.id } }), userToday: await userToday(who.id) });
  if (cap) return { error: cap, status: 429 };
  const photo = checkReceiptPhoto(body.dataUrl, UPLOAD_FILE_MAX);
  if ("error" in photo) return { error: photo.error, status: 400 };
  // The same photo (same bytes) already in, on a receipt that isn't set aside -> refused, nothing written.
  const earlier = await prisma.receiptPhoto.findMany({ where: { sha256: photo.sha256, receiptId: { not: null } }, select: { createdAt: true, receipt: { select: { status: true, sentBy: true } } }, orderBy: { createdAt: "asc" } });
  const live = earlier.find((p) => p.receipt && p.receipt.status !== "REJECTED");
  const same = samePhotoProblem(live?.receipt ? { receiptStatus: live.receipt.status, sentBy: live.receipt.sentBy, at: live.createdAt } : null);
  if (same) return { error: same, status: 409 };
  const fileName = await writeReceiptPhoto(photo);
  const r = await prisma.receipt.create({
    data: {
      kind: "TIP", siteLinkId: batchLinkMarker(batch.id), sentBy: who.name, sentByResourceId: null, officeBatchId: batch.id,
      projectId: batch.projectId, jobId: null, asbestos: null, // no tap in a batch - never defaulted (decided on /receipts)
      photos: { create: [{ fileName, siteLinkId: null, takenBy: who.name, sha256: photo.sha256 }] },
    },
  });
  readBatchSoon();
  return { id: r.id };
}

// The batch's photos are read one at a time (not 100 at once): one loop per server, oldest first. The one-minute tick
// (runner.readWaiting) also picks up anything waiting; the duplicate check is safe either way (runner's tip lock).
let looping = false;
export function readBatchSoon() {
  if (looping || !readingEnabled()) return;
  looping = true;
  (async () => {
    try {
      for (let n = 0; n < 500; n++) {
        const waiting = await prisma.receipt.findMany({ where: { status: "SENT", officeBatchId: { not: null } }, select: { id: true, reading: true }, orderBy: { sentAt: "asc" }, take: 20 });
        const next = waiting.find((r) => (logOf(r.reading).tries ?? 0) < MAX_TRIES);
        if (!next) break;
        await readReceipt(next.id);
        const after = await prisma.receipt.findUnique({ where: { id: next.id }, select: { status: true, reading: true } });
        if (after?.status === "SENT" && (logOf(after.reading).tries ?? 0) === (logOf(next.reading).tries ?? 0)) break; // not read and no try counted (e.g. no key) - the tick tries later
      }
    } catch (e) {
      console.error("receipts: batch reading", e instanceof Error ? e.message : "failed");
    } finally {
      looping = false;
    }
  })();
}
