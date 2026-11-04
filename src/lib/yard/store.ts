// Yard jobs (Ilies, 4 Nov 2026) - server side: the yard's list and what the yard
// (or whoever collects) does to a job. Shared by the yard's phone link
// (/api/site/<link>/yard), the /yard page (/api/yard), the supervisor's own link
// ("Collected") and the Requests page (an Admin's "Collected"). The guard - who
// may act - is the caller's job (lib/yard/rules.ts mayActOnYard); the status
// moves are checked here (yardActionError). Nothing is bought, booked or created.
import type { Prisma, SiteRequest } from "@prisma/client";
import { prisma } from "../prisma";
import { removePhoto, savePhoto } from "../toolPhotos";
import { assertNoMoney } from "../moneyGuard";
import { OFFICE_KINDS, requestNo } from "../requestTypes";
import { LINK_WHERE, addEvent, linkVisible, yardView } from "../siteRequests";
import { notifyRequestUpdate } from "../requestAlerts";
import { notifySupervisorReady, notifyYard } from "./alerts";
import { COLLECTED, COLLECTED_DAYS, YARD_STATUSES, onItIsRepeat, onYardList, yardActionError, type YardAction } from "./rules";
import { StockError, afterStockChange, checkStockLines, takeForYardJob } from "../inventory/store";
import { fmtQty } from "../inventory/rules";

// Most "ready" photos one yard link can send in a day - plenty for real use, and a cap on
// what a leaked link could do before it's switched off (like DAILY_PHOTO_LIMIT).
export const YARD_DAILY_READY_LIMIT = 60;

const withEvents = { events: { orderBy: { at: "asc" as const } } };

export async function listYardJobs(now = new Date()) {
  const since = new Date(now.getTime() - COLLECTED_DAYS * 86_400_000);
  const rows = await prisma.siteRequest.findMany({
    where: {
      ...LINK_WHERE,
      kind: { notIn: OFFICE_KINDS },
      yardAt: { not: null },
      OR: [{ status: { in: YARD_STATUSES } }, { status: "DONE", outcome: COLLECTED, doneAt: { gte: since } }],
    },
    orderBy: { neededBy: "asc" },
    take: 300,
    include: withEvents,
  });
  return rows.filter(linkVisible).map(yardView);
}

// One yard job, as the yard may see it (null = not on the yard's list / not for a link).
export async function findYardJob(id: string) {
  const r = await prisma.siteRequest.findUnique({ where: { id }, include: withEvents });
  if (!r || !r.yardAt || OFFICE_KINDS.includes(r.kind) || !linkVisible(r)) return null;
  return r;
}

// YD-006 (Ilies approved 4 Nov 2026): the photos are only for a job that's on the yard's list now -
// with the yard, ready, or collected in the last 7 days (rules.ts onYardList). Pulled back, cancelled,
// declined or long collected: null (404).
export async function findListedYardJob(id: string) {
  const r = await findYardJob(id);
  return r && onYardList(r) ? r : null;
}

export async function yardReadyToday(linkId: string) {
  return prisma.siteRequest.count({ where: { readySiteLinkId: linkId, readyAt: { gte: new Date(Date.now() - 86_400_000) } } });
}

// fromYard: the yard itself acted (its link or login) - no point alerting the yard about it.
// stock (Yard Stage C): READY's "Took from stock" lines - logins only (the routes decide); byUserId: the login.
type Act = { by: string; byUserId?: string | null; linkId?: string | null; photo?: unknown; note?: unknown; reason?: unknown; fromYard?: boolean; stock?: { itemId: string; qty: number }[] };
// "Took from stock: 2 box P2 masks, 1 roll Duct tape" for the request's history.
async function stockNote(lines: { itemId: string; qty: number }[]) {
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, select: { id: true, name: true, unit: true } });
  return `Took from stock: ${lines.map((l) => { const i = items.find((x) => x.id === l.itemId); return `${fmtQty(l.qty)} ${i?.unit ?? ""} ${i?.name ?? "item"}`.replace(/\s+/g, " "); }).join(", ")}`;
}
const text = (x: unknown, max = 500) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
type Result = { request: SiteRequest } | { error: string; status: number };

// YD-003 (Ilies approved 4 Nov 2026): every status move is conditional on the status that was
// checked - if someone else moved it in the meantime (cancelled, pulled back, collected), nothing
// is written, no alert goes out, and the caller answers 409.
export const CHANGED = { error: "It changed - reload the list.", status: 409 } as const;
type Db = { siteRequest: Pick<typeof prisma.siteRequest, "updateMany" | "findUnique"> };
export async function moveIfStill(db: Db, id: string, from: string, data: Prisma.SiteRequestUpdateManyMutationInput): Promise<SiteRequest | null> {
  const { count } = await db.siteRequest.updateMany({ where: { id, status: from }, data });
  return count ? db.siteRequest.findUnique({ where: { id } }) : null;
}

// YD-003a (Ilies approved 4 Nov 2026): a supervisor's "no longer needed" from their link. Always conditional on the
// status that was read - whether or not the yard has it - so cancelling twice, or cancelling while an Admin sends it
// to the yard / the yard marks it ready, can't both win: the late one gets 409 (CHANGED), writes nothing and alerts
// nobody. Returns the request as it was (its old status says whether the yard has to be told).
export const CLOSED_ALREADY = "This one is already closed.";
export async function cancelFromLink(r: SiteRequest, by: string, reason: string | null, db: Db = prisma, record: typeof addEvent = addEvent): Promise<Result> {
  if (["DONE", "DECLINED", "CANCELLED"].includes(r.status)) return { error: CLOSED_ALREADY, status: 400 };
  const updated = await moveIfStill(db, r.id, r.status, { status: "CANCELLED" });
  if (!updated) return CHANGED;
  await record(r.id, "CANCELLED", by, reason);
  return { request: updated };
}

// `db` is only ever swapped in tests (lib/yard/store.test.ts).
export async function applyYardAction(r: SiteRequest, action: YardAction, a: Act, db: Db = prisma): Promise<Result> {
  const err = yardActionError(action, r.status);
  if (err) return { error: err, status: err === "Unknown action." ? 400 : 409 };
  const no = requestNo(r.number);
  switch (action) {
    case "ON_IT": {
      // YD-005 (Ilies approved 4 Nov 2026): the same person again within 10 minutes - unchanged, no new event.
      const latest = await prisma.siteRequestEvent.findFirst({ where: { requestId: r.id }, orderBy: { at: "desc" }, select: { action: true, by: true, at: true } });
      if (!onItIsRepeat(latest, a.by)) await addEvent(r.id, "YARD_ON_IT", a.by, null);
      return { request: r };
    }
    case "READY": {
      // The photo is required: the supervisor sees exactly what's waiting for them.
      if (!a.photo) return { error: "Take a photo of the gear first.", status: 400 };
      if (a.linkId && (await yardReadyToday(a.linkId)) >= YARD_DAILY_READY_LIMIT)
        return { error: "That's the most this link can mark ready in a day - call the office.", status: 429 };
      // Yard Stage C (Ilies, 4 Nov 2026): "Took from stock" - checked before the photo is kept; the shelf itself is
      // re-checked inside the transaction below.
      const lines = a.stock ?? [];
      const badStock = await checkStockLines(lines);
      if (badStock) return badStock;
      const saved = await savePhoto(a.photo);
      if ("error" in saved) return { error: saved.error, status: 400 };
      const missing = text(a.note) || null;
      const data = { status: "READY", readyAt: new Date(), readyBy: a.by, readyNote: missing, readyPhotoFile: saved.fileName, readySiteLinkId: a.linkId ?? null };
      let updated: SiteRequest | null;
      if (!lines.length) updated = await moveIfStill(db, r.id, r.status, data);
      else {
        // The READY move (YD-003: only from the status checked) and every stock OUT go together or not at all: a 409
        // on the move, or a shelf that can't cover a line, leaves the request and the stock exactly as they were.
        try {
          updated = await prisma.$transaction(async (tx) => {
            const u = await moveIfStill(tx, r.id, r.status, data);
            if (!u) throw new StockError(CHANGED);
            await takeForYardJob(tx, lines, r, { id: a.byUserId ?? null, name: a.by });
            return u;
          });
        } catch (e) {
          if (!(e instanceof StockError)) throw e;
          await removePhoto(saved.fileName).catch(() => undefined);
          return e.fail;
        }
      }
      if (!updated) {
        await removePhoto(saved.fileName).catch(() => undefined); // never kept for a move that didn't happen
        return CHANGED;
      }
      const took = lines.length ? await stockNote(lines) : null;
      await addEvent(r.id, "YARD_READY", a.by, [missing ? `Missing: ${missing}` : null, took].filter(Boolean).join(" · ") || null);
      if (lines.length) await afterStockChange(lines.map((l) => l.itemId));
      // A missing item alerts the Admins out loud - nothing is bought or created automatically.
      const what = missing ? `${no} ready - missing: ${assertNoMoney(missing) ? missing : "see the request"}` : `${no} ready for collection at the yard`;
      await notifyRequestUpdate(updated, what, { loud: !!missing });
      await notifySupervisorReady(updated);
      return { request: updated };
    }
    case "CANT_DO": {
      const reason = text(a.reason ?? a.note, 300);
      if (reason.length < 2) return { error: "Say why it can't be done - it goes back to the office.", status: 400 };
      // Back to the Admins to decide again (CANT_DO is "to decide").
      const updated = await moveIfStill(db, r.id, r.status, { status: "CANT_DO", outcome: reason });
      if (!updated) return CHANGED;
      await addEvent(r.id, "CANT_DO", a.by, reason);
      await notifyRequestUpdate(updated, `The yard can't do it: ${reason}`);
      return { request: updated };
    }
    case "COLLECTED": {
      const updated = await moveIfStill(db, r.id, r.status, { status: "DONE", outcome: COLLECTED, doneAt: new Date() });
      if (!updated) return CHANGED;
      await addEvent(r.id, "COLLECTED", a.by, null);
      await notifyRequestUpdate(updated, `${no} collected - ${a.by}`);
      if (!a.fromYard) await notifyYard(updated, `Collected - ${a.by}`);
      return { request: updated };
    }
  }
}

export const reread = (id: string) => prisma.siteRequest.findUnique({ where: { id }, include: withEvents });
