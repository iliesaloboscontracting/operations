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
import { COLLECTED, COLLECTED_DAYS, YARD_STATUSES, yardActionError, type YardAction } from "./rules";

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

export async function yardReadyToday(linkId: string) {
  return prisma.siteRequest.count({ where: { readySiteLinkId: linkId, readyAt: { gte: new Date(Date.now() - 86_400_000) } } });
}

// fromYard: the yard itself acted (its link or login) - no point alerting the yard about it.
type Act = { by: string; linkId?: string | null; photo?: unknown; note?: unknown; reason?: unknown; fromYard?: boolean };
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

// `db` is only ever swapped in tests (lib/yard/store.test.ts).
export async function applyYardAction(r: SiteRequest, action: YardAction, a: Act, db: Db = prisma): Promise<Result> {
  const err = yardActionError(action, r.status);
  if (err) return { error: err, status: err === "Unknown action." ? 400 : 409 };
  const no = requestNo(r.number);
  switch (action) {
    case "ON_IT": {
      await addEvent(r.id, "YARD_ON_IT", a.by, null);
      return { request: r };
    }
    case "READY": {
      // The photo is required: the supervisor sees exactly what's waiting for them.
      if (!a.photo) return { error: "Take a photo of the gear first.", status: 400 };
      if (a.linkId && (await yardReadyToday(a.linkId)) >= YARD_DAILY_READY_LIMIT)
        return { error: "That's the most this link can mark ready in a day - call the office.", status: 429 };
      const saved = await savePhoto(a.photo);
      if ("error" in saved) return { error: saved.error, status: 400 };
      const missing = text(a.note) || null;
      const updated = await moveIfStill(db, r.id, r.status, {
        status: "READY", readyAt: new Date(), readyBy: a.by, readyNote: missing, readyPhotoFile: saved.fileName, readySiteLinkId: a.linkId ?? null,
      });
      if (!updated) {
        await removePhoto(saved.fileName).catch(() => undefined); // never kept for a move that didn't happen
        return CHANGED;
      }
      await addEvent(r.id, "YARD_READY", a.by, missing ? `Missing: ${missing}` : null);
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
