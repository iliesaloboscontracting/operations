// Office batch upload of tip dockets (20 Nov 2026) - server side. The office (Manager+) starts a batch for one project,
// then sends the photos one per request; each becomes a TIP Receipt (status SENT, officeBatchId) with its photo in
// RECEIPT_FILE_DIR, read in the background by the same reader and plain checks as a phone-sent docket. Rules:
// ./batchRules.ts. Nothing from a batch is ever on a phone link: no sentByResourceId, a siteLinkId no link resolves to,
// and the daily log's docket count leaves batches out. Append-only - REJECT on /receipts is the only way to set one aside.
import { prisma } from "../prisma";
import { checkReceiptPhoto, writeReceiptPhoto } from "./files";
import { BATCH_LIMITS, batchLinkMarker, bulkNoAsbestos, capProblem, samePhotoProblem } from "./batchRules";
import { dueReceipts, logOf, readReceipt, readingEnabled } from "./runner";

type Problem = { error: string; status: number };
type Who = { id: string; name: string };
const ID = /^[a-z0-9]{20,40}$/;
const dayAgo = () => new Date(Date.now() - 86_400_000);

// DB-002 / DB-005: shared by every route bundle on this server (globalThis), like media/protocol.ts.
const shared = globalThis as unknown as { __receiptBatchChain?: Promise<unknown>; __receiptBatchLooping?: boolean };
shared.__receiptBatchChain ??= Promise.resolve();
shared.__receiptBatchLooping ??= false;
// One photo at a time on this server from "count the caps / look for the same photo" to "receipt made", so a burst
// of parallel uploads can't all slip under a cap (DB-005).
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = (shared.__receiptBatchChain ?? Promise.resolve()).then(f, f);
  shared.__receiptBatchChain = run.catch(() => undefined);
  return run;
}

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
  // Checked before the queue (no database): type by its bytes, at most 3.5 MB (DB-004).
  const photo = checkReceiptPhoto(body.dataUrl, BATCH_LIMITS.photoMaxBytes);
  if ("error" in photo) return { error: photo.error, status: 400 };
  const out = await serial(async (): Promise<{ id: string } | Problem> => {
    const cap = capProblem({ inBatch: await prisma.receipt.count({ where: { officeBatchId: batch.id } }), userToday: await userToday(who.id) });
    if (cap) return { error: cap, status: 429 };
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
    return { id: r.id };
  });
  if ("id" in out) readBatchSoon();
  return out;
}

// Asbestos option (b), Ilies 20 Nov 2026: "None of this batch is asbestos". Any Manager / Admin (an office colleague
// may finish someone else's batch). Narrowed by DB-006 (Ilies approved 23 Nov 2026, "approve all"): sets asbestos = false
// only on the batch's tip dockets still unanswered, not set aside, already read (READ / CHECK) and whose waste type
// doesn't read as asbestos (bulkNoAsbestos, ./batchRules.ts) - never one a person already answered, never one that says
// asbestos (answered one by one), never one not read yet (SENT). DB-008: each docket it answers gets a correction
// (via "batch", who / when) in its log, and the press is kept with who / when / which ones (ReceiptBatchEvent,
// append-only). Confirms nothing and never changes status, reasons or job: each docket still goes through the normal
// confirm; a single one can still be changed afterwards.
export async function noAsbestosForBatch(who: Who, batchId: string): Promise<{ ok: true; changed: number; leftAsbestos: number; waiting: number } | Problem> {
  const batch = ID.test(batchId) ? await prisma.receiptBatch.findUnique({ where: { id: batchId }, select: { id: true } }) : null;
  if (!batch) return { error: "Not found", status: 404 };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.receipt.findMany({
      where: { officeBatchId: batch.id, kind: "TIP", asbestos: null, status: { not: "REJECTED" } },
      select: { id: true, kind: true, status: true, asbestos: true, wasteType: true, reading: true },
    });
    const now = new Date();
    const changedIds: string[] = [];
    let leftAsbestos = 0, waiting = 0;
    for (const row of rows) {
      const rule = bulkNoAsbestos(row);
      if (rule === "SKIP_ASBESTOS") leftAsbestos++;
      if (rule === "SKIP_UNREAD") waiting++;
      if (rule !== "SET") continue;
      const log = logOf(row.reading);
      const corrections = [...(log.corrections ?? []), { at: now.toISOString(), by: who.name, field: "asbestos", before: null, after: false, via: "batch" as const }];
      const n = await tx.receipt.updateMany({
        where: { id: row.id, asbestos: null, status: { in: ["READ", "CHECK"] } },
        data: { asbestos: false, reading: JSON.stringify({ ...log, corrections }), correctedBy: who.name, correctedAt: now },
      });
      if (n.count === 1) changedIds.push(row.id);
    }
    await tx.receiptBatchEvent.create({ data: { batchId: batch.id, action: "NO_ASBESTOS", by: who.name, byId: who.id, count: changedIds.length, receiptIds: JSON.stringify(changedIds) } });
    return { ok: true as const, changed: changedIds.length, leftAsbestos, waiting };
  });
}

// The batch's photos are read one at a time (not 100 at once): one loop per server (the flag is on globalThis, so the
// route bundles share it), oldest first, paging past ones that used up their tries (DB-004). The one-minute tick
// (runner.readWaiting) also picks up anything waiting; the duplicate check is safe either way (runner's tip lock, also
// on globalThis).
export function readBatchSoon() {
  if (shared.__receiptBatchLooping || !readingEnabled()) return;
  shared.__receiptBatchLooping = true;
  (async () => {
    try {
      for (let n = 0; n < 500; n++) {
        const [next] = await dueReceipts({ officeBatchId: { not: null } }, 1);
        if (!next) break;
        const before = await prisma.receipt.findUnique({ where: { id: next }, select: { reading: true } });
        await readReceipt(next);
        const after = await prisma.receipt.findUnique({ where: { id: next }, select: { status: true, reading: true } });
        if (after?.status === "SENT" && (logOf(after.reading).tries ?? 0) === (logOf(before?.reading).tries ?? 0)) break; // not read and no try counted (e.g. no key) - the tick tries later
      }
    } catch (e) {
      console.error("receipts: batch reading", e instanceof Error ? e.message : "failed");
    } finally {
      shared.__receiptBatchLooping = false;
    }
  })();
}
