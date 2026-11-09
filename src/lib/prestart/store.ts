// Vehicle & plant pre-start checks (stage 1, Ilies approved 8 Nov 2026) - the database side. The plain rules are in
// rules.ts, the checklists in checklists.ts.
//   Link side (the crew's phone, /api/site/in/prestart*): the token from a truck sign-in / sign-out says which sign-in
//   and which check. Words and dates only - no money, and the reporter's first name only.
//   Office side (/api/faults*, guardFaults): the list, the moves, the photos, the day's checks and the board flags.
// Signing in never waits on any of this: the sign-in is already saved when the token is handed out.
import { createHash } from "crypto";
import { prisma } from "../prisma";
import { readPrestartToken, sydneyTime, type PrestartKind } from "../signin";
import { linkLabel } from "../dailyLog/money";
import { fromSydneyLocal } from "../shiftTimes";
import { todaySydney } from "../today";
import { pushToAdmins } from "../push";
import { preparePhoto, removePhoto, writePreparedPhoto } from "../toolPhotos";
import type { Prisma } from "@prisma/client";
import { checklistFor, slotLabel, walkaroundSlotsFor, type Checklist } from "./checklists";
import {
  LIMITS, OPEN_STATUSES, PHOTO_LIMIT_NOTE, PRIORITY_LABEL, STATUS_LABEL, alertDecision, alertFor, alertMessage, canMove, cleanText, firstName, isOpenStatus,
  isPriority, marksDown, offerBackToAvailable, photoCapFull, photoPrecheck, photoRefusal, sortFaults, validateSubmission, validateWalkaround, walkaroundCutoff,
  capNotice, capsFull, type PhotoCap, type PhotoRole,
  walkaroundRequired, worstPriority, type FaultPriority, type FaultStatus,
} from "./rules";

export type Problem = { error: string; status: number; capFull?: true; cap?: PhotoCap };
const problem = (error: string, status = 400): Problem => ({ error, status });
const sydneyMidnight = (day = todaySydney()) => fromSydneyLocal(`${day}T00:00`)!;
const dayOf = (d: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" }).format(d);

// ---------- the link: which sign-in, which machine, which checklist ----------

type LinkCtx = {
  attendanceId: string; kind: PrestartKind; deviceId: string | null;
  person: { id: string | null; name: string };
  machine: { id: string; name: string; type: string; status: string };
  list: Checklist;
};

// The token -> its truck sign-in (not removed / rejected) -> the truck and its checklist. PS-006: a pre-start token
// stops working once that sign-in is signed out (the post-check token is for after).
export async function linkContext(token: unknown): Promise<LinkCtx | Problem> {
  const t = readPrestartToken(token);
  if (!t) return problem("That's timed out - do it with your next sign-in.", 401);
  const a = await prisma.siteAttendance.findUnique({
    where: { id: t.attendanceId },
    select: { id: true, place: true, vehicleId: true, resourceId: true, workerName: true, deviceId: true, status: true, removedAt: true, signOutAt: true },
  });
  if (!a || a.place !== "VEHICLE" || !a.vehicleId || a.removedAt || a.status === "REJECTED") return problem("That sign-in isn't on a truck any more.", 404);
  if (t.kind === "PRE" && a.signOutAt) return problem("You've signed out - the pre-start is closed. Do it with your next sign-in.", 409);
  const machine = await prisma.resource.findUnique({ where: { id: a.vehicleId }, select: { id: true, name: true, type: true, status: true } });
  const list = machine ? checklistFor(machine.type, t.kind) : null;
  if (!machine || !list) return problem("There's no checklist for this machine.", 404);
  return { attendanceId: a.id, kind: t.kind, deviceId: a.deviceId, person: { id: a.resourceId, name: a.workerName }, machine, list };
}

const openFaultsOf = (resourceId: string) =>
  prisma.assetFault.findMany({ where: { resourceId, status: { in: OPEN_STATUSES } }, orderBy: { reportedAt: "desc" }, take: 30 });

// Stage 1b (10 Nov 2026): today's pre-starts for this machine, earliest first - the first of the day must have the
// walk-around photos (rules.ts walkaroundRequired). Decided here, and again when the check is sent.
const preToday = (db: Prisma.TransactionClient | typeof prisma, resourceId: string, notId?: string) =>
  db.prestartCheck.findMany({
    where: { resourceId, kind: "PRE", createdAt: { gte: sydneyMidnight() }, ...(notId ? { id: { not: notId } } : {}) },
    select: { walkaround: true, personName: true, createdAt: true }, orderBy: { createdAt: "asc" },
  });
// Is a walk-around needed for this machine's pre-start now? (The sign-in reply says so, for the odometer step.)
export async function walkaroundRequiredFor(resourceId: string, resourceType: string): Promise<boolean> {
  if (!walkaroundSlotsFor(resourceType, "PRE").length) return false;
  return walkaroundRequired(await preToday(prisma, resourceId));
}
// The odometer photo of this sign-in (Receipts R1's OdometerReading): sent, or not (missing / "Can't now").
const odometerSent = async (db: Prisma.TransactionClient | typeof prisma, attendanceId: string) => {
  const r = await db.odometerReading.findUnique({ where: { siteAttendanceId: attendanceId }, select: { status: true } });
  return !!r && r.status !== "SKIPPED";
};

// GET: the checklist, the machine's open faults (first name of who reported it only), whether it's done already, and
// (truck pre-start) the walk-around: required or not, who took this morning's, and whether the odometer is in.
export async function linkView(ctx: LinkCtx) {
  const slots = walkaroundSlotsFor(ctx.machine.type, ctx.kind);
  const [open, done, today, odo] = await Promise.all([
    openFaultsOf(ctx.machine.id),
    prisma.prestartCheck.findUnique({ where: { attendanceId_kind: { attendanceId: ctx.attendanceId, kind: ctx.kind } }, select: { id: true } }),
    slots.length ? preToday(prisma, ctx.machine.id) : Promise.resolve([]),
    slots.length ? odometerSent(prisma, ctx.attendanceId) : Promise.resolve(true),
  ]);
  const first = today.find((c) => c.walkaround === "DONE" || c.walkaround === "LIMIT");
  return {
    kind: ctx.kind,
    machine: linkLabel(ctx.machine.name, "Truck"),
    title: ctx.list.title,
    checklist: { id: ctx.list.id, items: ctx.list.items },
    done: !!done,
    openFaults: sortFaults(open).map((f) => ({
      id: f.id, itemKey: f.itemKey, itemLabel: f.itemLabel, description: f.description, priority: f.priority as FaultPriority,
      priorityLabel: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority, reportedOn: dayOf(f.reportedAt), reportedBy: linkLabel(firstName(f.reportedBy), "Someone"),
    })),
    limits: { photosPerFault: LIMITS.photosPerFault, description: LIMITS.description },
    walkaround: slots.length ? {
      required: walkaroundRequired(today), slots,
      // "This morning's photos were taken at 6:12 by Turori" - first name only on a link.
      earlier: first ? { at: sydneyTime(first.createdAt), by: linkLabel(firstName(first.personName), "someone"), limit: first.walkaround === "LIMIT" } : null,
    } : null,
    odometer: slots.length ? (odo ? "SENT" : "MISSING") : null,
  };
}

class Refused extends Error { constructor(public p: Problem) { super(p.error); } }
// Interactive transactions wait their turn rather than failing under a burst.
const TX = { maxWait: 15_000, timeout: 15_000 };
// SQLite lets one writer in at a time, and two interactive transactions that overlap can time out on each other's
// locks (seen with 30 photos at once). Production is one server process, so this module's writes go one after another
// here - each still counts inside its own transaction, so the caps hold even if two ever did overlap.
const queue = globalThis as unknown as { __prestartQueue?: Promise<unknown>; __prestartWaiting?: number };
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  queue.__prestartWaiting = (queue.__prestartWaiting ?? 0) + 1;
  const done = () => { queue.__prestartWaiting = Math.max(0, (queue.__prestartWaiting ?? 1) - 1); };
  const run = (queue.__prestartQueue ?? Promise.resolve()).then(fn, fn).finally(done);
  queue.__prestartQueue = run.catch(() => undefined);
  return run;
}
// PS-009: how many writes are waiting their turn - over LIMITS.queueWaiting a photo is turned away (503) at once.
export const queueWaiting = () => queue.__prestartWaiting ?? 0;

// POST photo: kept for this sign-in and check (PRE / POST), not yet on a fault; none once the check is in.
// PS-001 (9 Nov 2026): the row is recorded first and then everything is counted in the same transaction - this
// sign-in (20), this machine today across every sign-in and phone (80, by resourceId so stage 2's plant gets it too),
// every machine today (400), the same photo twice on this sign-in, and the phone (60, a hint - the phone names
// itself). Over any of them the transaction is undone and nothing is written. The file is written only after.
// Stage 1b: `slot` = a walk-around photo (FRONT / BACK / DRIVER / PASSENGER / CAB - truck pre-start only), kept as
// role WALKAROUND; otherwise a fault photo. PS-012 (10 Nov 2026): the machine's day is counted per kind (15 walk-around,
// 65 fault photos), under the shared all-day ceiling - so fault photos can't use up the walk-around's allowance.
export async function linkPhoto(ctx: LinkCtx, dataUrl: unknown, deviceId: unknown, slot?: unknown): Promise<{ id: string } | Problem> {
  const slots = walkaroundSlotsFor(ctx.machine.type, ctx.kind);
  if (slot != null && !slots.some((s) => s.key === slot)) return problem("That photo slot isn't on this check.");
  const role: PhotoRole = slot != null ? "WALKAROUND" : "FAULT";
  const prepared = preparePhoto(dataUrl);
  if ("error" in prepared) return problem(prepared.error);
  const sha256 = createHash("sha256").update(prepared.bytes).digest("hex");
  const dev = typeof deviceId === "string" && deviceId ? deviceId.slice(0, 64) : ctx.deviceId;
  // PS-009: the caps read first, with nothing written and no place in the queue - a full cap answers straight away.
  const today = { gte: sydneyMidnight() };
  const [pSignIn, pMachine, pAll, pDevice, pSame] = await Promise.all([
    prisma.assetFaultMedia.count({ where: { attendanceId: ctx.attendanceId } }),
    prisma.assetFaultMedia.count({ where: { resourceId: ctx.machine.id, role, createdAt: today } }),
    prisma.assetFaultMedia.count({ where: { createdAt: today } }),
    dev ? prisma.assetFaultMedia.count({ where: { deviceId: dev, createdAt: today } }) : Promise.resolve(0),
    prisma.assetFaultMedia.count({ where: { attendanceId: ctx.attendanceId, sha256 } }),
  ]);
  const early = photoPrecheck({ role, signIn: pSignIn, roleMachineDay: pMachine, allDay: pAll, deviceDay: pDevice, sameOnSignIn: pSame });
  if (early) {
    if (early.capFull) await noticeFullCaps(ctx.machine).catch((e) => console.error("photo limit notice", e instanceof Error ? e.message : "failed"));
    return early;
  }
  if (queueWaiting() > LIMITS.queueWaiting) return problem("Busy - try again.", 503);
  let id: string;
  try {
    id = await oneAtATime(() => prisma.$transaction(async (tx) => {
      // The write comes first: SQLite gives one transaction the write lock at a time, so the others wait here and then
      // count what the earlier ones added (a transaction that read first and wrote later could deadlock under a burst).
      const m = await tx.assetFaultMedia.create({
        data: {
          resourceId: ctx.machine.id, attendanceId: ctx.attendanceId, deviceId: dev, kind: "PHOTO", checkKind: ctx.kind, role, slot: role === "WALKAROUND" ? (slot as string) : null,
          fileName: prepared.fileName, mime: prepared.mime, sha256,
        },
      });
      if (await tx.prestartCheck.findUnique({ where: { attendanceId_kind: { attendanceId: ctx.attendanceId, kind: ctx.kind } }, select: { id: true } }))
        throw new Refused(problem("That check is already in - thanks.", 409));
      const [signIn, roleMachineDay, allDay, deviceDay, sameOnSignIn] = await Promise.all([
        tx.assetFaultMedia.count({ where: { attendanceId: ctx.attendanceId } }),
        tx.assetFaultMedia.count({ where: { resourceId: ctx.machine.id, role, createdAt: today } }),
        tx.assetFaultMedia.count({ where: { createdAt: today } }),
        dev ? tx.assetFaultMedia.count({ where: { deviceId: dev, createdAt: today } }) : Promise.resolve(0),
        tx.assetFaultMedia.count({ where: { attendanceId: ctx.attendanceId, sha256 } }),
      ]);
      const refused = photoRefusal({ role, signIn, roleMachineDay, allDay, deviceDay, sameOnSignIn });
      if (refused) throw new Refused(refused);
      return m.id;
    }, TX));
  } catch (e) {
    if (e instanceof Refused) {
      if (e.p.capFull) await noticeFullCaps(ctx.machine).catch((err) => console.error("photo limit notice", err instanceof Error ? err.message : "failed"));
      return e.p;
    }
    throw e;
  }
  // PS-012: this photo may have just filled an allowance - tell the Admins once (never fails the upload).
  await noticeFullCaps(ctx.machine).catch((e) => console.error("photo limit notice", e instanceof Error ? e.message : "failed"));
  try {
    await writePreparedPhoto(prepared);
  } catch (e) {
    await prisma.assetFaultMedia.delete({ where: { id } }).catch(() => {});
    throw e;
  }
  return { id };
}

// PS-012 (10 Nov 2026): when a machine's walk-around or fault allowance, or the all-day ceiling, is full, ONE push to the
// Admins per cap per machine per Sydney day (the ceiling once for everyone). PhotoCapNotice's unique key records it -
// a second fill the same day (or a restart, or two uploads at once) sends nothing more. No money in it.
export async function noticeFullCaps(machine: { id: string; name: string }): Promise<PhotoCap[]> {
  const today = { gte: sydneyMidnight() };
  const [walkaroundMachineDay, faultMachineDay, allDay] = await Promise.all([
    prisma.assetFaultMedia.count({ where: { resourceId: machine.id, role: "WALKAROUND", createdAt: today } }),
    prisma.assetFaultMedia.count({ where: { resourceId: machine.id, role: "FAULT", createdAt: today } }),
    prisma.assetFaultMedia.count({ where: { createdAt: today } }),
  ]);
  const day = todaySydney();
  const sent: PhotoCap[] = [];
  for (const cap of capsFull({ walkaroundMachineDay, faultMachineDay, allDay })) {
    const resourceId = cap === "ALL" ? "*" : machine.id;
    try {
      await prisma.photoCapNotice.create({ data: { resourceId, cap, day } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") continue; // already told today
      throw e;
    }
    sent.push(cap);
    const msg = capNotice(cap, linkLabel(machine.name, "a truck"));
    await pushToAdmins({ ...msg, url: "/faults", tag: `photo-limit-${cap}-${resourceId}` }, "normal").catch((e) => console.error("photo limit push", e instanceof Error ? e.message : "failed"));
  }
  return sent;
}

// Do not use: the machine goes DOWN (only if it isn't already). Returns the machine record's updatedAt as that write
// left it (PS-008 - kept on the fault), or null when it was already Down.
async function markDown(tx: Prisma.TransactionClient, resourceId: string): Promise<Date | null> {
  const n = (await tx.resource.updateMany({ where: { id: resourceId, status: { not: "DOWN" } }, data: { status: "DOWN" } })).count;
  if (n !== 1) return null;
  return (await tx.resource.findUnique({ where: { id: resourceId }, select: { updatedAt: true } }))?.updatedAt ?? null;
}

// PS-002: one alert per check, at most one per machine every 15 minutes and 6 a Sydney day. The decision is recorded
// (AssetFaultAlert) in a transaction with the count it was based on, so a restart or two checks at once can't double it.
export async function alertForCheck(machine: { id: string; name: string }, checkId: string, by: string,
  faults: { id: string; itemLabel: string; priority: string; description: string; markedDown: boolean }[], now = new Date()) {
  const msg = alertMessage(machine.name, by, faults);
  if (!msg) return null;
  const loud = faults.filter((f) => alertFor(f.priority)).map((f) => f.id);
  const doNotUse = faults.some((f) => f.priority === "DO_NOT_USE");
  const decision = await oneAtATime(() => prisma.$transaction(async (tx) => {
    // The row first (the write lock - see linkPhoto), then the decision from the ones before it.
    const row = await tx.assetFaultAlert.create({ data: { resourceId: machine.id, checkId, decision: "PENDING", doNotUse, faultIds: JSON.stringify(loud), at: now } });
    const sent = await tx.assetFaultAlert.findMany({ where: { resourceId: machine.id, decision: "SENT", at: { gte: sydneyMidnight() }, id: { not: row.id } }, select: { at: true, doNotUse: true } });
    const d = alertDecision(sent, now, doNotUse);
    await tx.assetFaultAlert.update({ where: { id: row.id }, data: { decision: d } });
    return d;
  }, TX));
  if (decision === "SENT") await pushToAdmins({ ...msg, url: "/faults", tag: `fault-machine-${machine.id}`, sticky: true }, "high");
  return decision;
}

// POST the check: in ONE transaction the check, its new faults (photos attached - this sign-in's own, not yet used),
// the "Still there" sightings, the history, and DOWN for Do not use. Then the Admins' pushes (after it's saved; an
// alert that fails never fails the check).
export async function submitCheck(ctx: LinkCtx, body: unknown) {
  const open = await openFaultsOf(ctx.machine.id);
  // PS-010: is the day's photo limit full for this machine (or everyone)? Counted here, never taken from the phone.
  const today = { gte: sydneyMidnight() };
  // PS-012: per kind - a fault's photo is waived only when the FAULT allowance (or the ceiling) is full, the walk-around
  // let through only when the WALK-AROUND allowance (or the ceiling) is full.
  const allDay = await prisma.assetFaultMedia.count({ where: { createdAt: today } });
  const roleDay = (role: PhotoRole) => prisma.assetFaultMedia.count({ where: { resourceId: ctx.machine.id, role, createdAt: today } });
  const faultFull = photoCapFull("FAULT", { roleMachineDay: await roleDay("FAULT"), allDay });
  const walkFull = photoCapFull("WALKAROUND", { roleMachineDay: await roleDay("WALKAROUND"), allDay });
  const v = validateSubmission(ctx.list, body, open.map((f) => ({ id: f.id, itemKey: f.itemKey })), { capFull: faultFull });
  if (!v.ok) return problem(v.error);
  const slots = walkaroundSlotsFor(ctx.machine.type, ctx.kind);
  const { answers, faults, stillThere } = v.value;
  const allMedia = faults.flatMap((f) => f.mediaIds);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const deviceId = typeof b.deviceId === "string" && b.deviceId ? b.deviceId.slice(0, 64) : ctx.deviceId;
  const by = ctx.person.name;
  let result: { checkId: string; walkaround: string | null; created: { id: string; itemLabel: string; priority: FaultPriority; description: string; markedDown: boolean }[] };
  try {
    result = await oneAtATime(() => prisma.$transaction(async (tx) => {
      // Written first (see linkPhoto); a second check for the sign-in hits the unique key -> 409.
      const check = await tx.prestartCheck.create({
        data: {
          resourceId: ctx.machine.id, resourceName: ctx.machine.name, resourceType: ctx.machine.type, kind: ctx.kind, attendanceId: ctx.attendanceId,
          personId: ctx.person.id, personName: by, deviceId, checklist: ctx.list.id, answers: JSON.stringify(answers),
          faultCount: faults.length, seenCount: stillThere.length,
        },
      });
      if (allMedia.length) {
        const mine = await tx.assetFaultMedia.count({ where: { id: { in: allMedia }, attendanceId: ctx.attendanceId, checkKind: ctx.kind, role: "FAULT", faultId: null } });
        if (mine !== allMedia.length) throw new Refused(problem("A photo didn't go through - take it again.", 400));
      }
      // Stage 1b: the walk-around. "First of the day" decided again now, against every other pre-start already in -
      // two drivers at once can't leave the day without photos. Required = the five photos and the odometer.
      let walkaround: string | null = null;
      if (slots.length) {
        const required = walkaroundRequired(await preToday(tx, ctx.machine.id, check.id));
        const w = validateWalkaround(b.walkaround, slots, { required, capFull: walkFull });
        if (!w.ok) throw new Refused(problem(w.error, 400));
        if (required && !(await odometerSent(tx, ctx.attendanceId))) throw new Refused(problem("Take the odometer photo first.", 400));
        for (const [s, mediaId] of Object.entries(w.photos)) {
          const ok = await tx.assetFaultMedia.updateMany({
            where: { id: mediaId, attendanceId: ctx.attendanceId, checkKind: ctx.kind, role: "WALKAROUND", slot: s, faultId: null, checkId: null },
            data: { checkId: check.id },
          });
          if (ok.count !== 1) throw new Refused(problem("A walk-around photo didn't go through - take it again.", 400));
        }
        walkaround = w.status;
        await tx.prestartCheck.update({ where: { id: check.id }, data: { walkaround } });
      } else if (b.walkaround != null && Object.keys(b.walkaround as object).length) {
        throw new Refused(problem("No walk-around photos on this check.", 400));
      }
      let status = ctx.machine.status;
      const created: { id: string; itemLabel: string; priority: FaultPriority; description: string; markedDown: boolean }[] = [];
      for (const f of faults) {
        const down = marksDown(f.priority, status) ? await markDown(tx, ctx.machine.id) : null;
        if (down) status = "DOWN";
        const row = await tx.assetFault.create({
          data: {
            resourceId: ctx.machine.id, resourceName: ctx.machine.name, checkId: check.id, itemKey: f.itemKey, itemLabel: f.itemLabel,
            description: f.description, priority: f.priority, reportedBy: by, markedDown: !!down, markedDownAt: down,
            photoNote: f.mediaIds.length ? null : PHOTO_LIMIT_NOTE, // PS-010: let through without a photo
          },
        });
        const attached = await tx.assetFaultMedia.updateMany({ where: { id: { in: f.mediaIds }, attendanceId: ctx.attendanceId, checkKind: ctx.kind, role: "FAULT", faultId: null }, data: { faultId: row.id } });
        if (attached.count !== f.mediaIds.length) throw new Refused(problem("A photo didn't go through - take it again.", 400));
        await tx.assetFaultEvent.create({ data: { faultId: row.id, by, action: "REPORTED", to: f.priority, note: `${ctx.kind === "PRE" ? "Pre-start" : "Post-check"}: ${f.itemLabel}` } });
        if (down) await tx.assetFaultEvent.create({ data: { faultId: row.id, by, action: "DOWN", to: "DOWN", note: "Marked Down on the register (Do not use)" } });
        created.push({ id: row.id, itemLabel: f.itemLabel, priority: f.priority, description: f.description, markedDown: !!down });
      }
      const now = new Date();
      for (const id of stillThere) {
        const seen = await tx.assetFault.updateMany({
          where: { id, resourceId: ctx.machine.id, status: { in: OPEN_STATUSES } },
          data: { lastSeenAt: now, lastSeenBy: by, seenCount: { increment: 1 } },
        });
        if (seen.count !== 1) throw new Refused(problem("That fault has been fixed or changed - reload the page.", 409));
        await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "SEEN", note: `Still there (${ctx.kind === "PRE" ? "pre-start" : "post-check"})` } });
      }
      return { checkId: check.id, walkaround, created };
    }, TX));
  } catch (e) {
    if (e instanceof Refused) return e.p;
    if ((e as { code?: string }).code === "P2002") return problem("That check is already in - thanks.", 409);
    throw e;
  }

  // After it's saved: one alert to the Admins' phones for the check's Urgent / Do-not-use faults - throttled per
  // machine (PS-002). Held back or failed, the faults are saved and listed all the same; it never fails the check.
  await alertForCheck(ctx.machine, result.checkId, by, result.created).catch((e) => console.error("fault alert", e instanceof Error ? e.message : "failed"));
  const sent = result.created.map((f) => ({ itemLabel: f.itemLabel, priority: PRIORITY_LABEL[f.priority], markedDown: f.markedDown }));
  const what = ctx.kind === "PRE" ? "Pre-start" : "Post-check";
  const limitNote = result.walkaround === "LIMIT" ? " Walk-around photos couldn't be added (the day's photo limit) - noted." : "";
  return {
    ok: true as const, id: result.checkId, sent, seen: stillThere.length, walkaround: result.walkaround,
    message: (sent.length ? `${what} sent - ${sent.length} fault${sent.length > 1 ? "s" : ""} sent to the office.` : `${what} sent - thanks.`) + limitNote,
  };
}


// ---------- the office ----------

export type FaultDTO = {
  id: string; resourceId: string; resourceName: string; machineStatus: string | null; itemLabel: string | null; description: string;
  priority: FaultPriority; priorityLabel: string; status: FaultStatus; statusLabel: string;
  reportedBy: string; reportedAt: string; lastSeenAt: string | null; lastSeenBy: string | null; seenCount: number;
  markedDown: boolean; fixedAt: string | null; fixedBy: string | null; fixNote: string | null;
  checkKind: string | null; mediaIds: string[]; canBackToAvailable: boolean; photoNote: string | null;
  // PS-004 (9 Nov 2026): where the report came from, so the office can spot one that doesn't look right.
  source: { staff: boolean; company: string | null; method: string; point: string | null; runBy: string | null } | null;
  events: { at: string; by: string; action: string; from: string | null; to: string | null; note: string | null }[];
};

const METHOD_LABEL: Record<string, string> = {
  POINT: "Truck QR", SUPERVISOR_QR: "Supervisor's QR", POSTER: "Site poster", MANUAL: "Ticked in by the supervisor", OFFICE: "Added by the office",
};

export async function listFaults(q: { status?: string | null; resourceId?: string | null }): Promise<{ faults: FaultDTO[]; machines: { id: string; name: string }[] }> {
  const statusWhere = q.status === "ALL" ? {} : q.status === "FIXED" ? { status: "FIXED" } : q.status === "OPEN" || q.status === "IN_HAND" ? { status: q.status } : { status: { in: OPEN_STATUSES } };
  const rows = await prisma.assetFault.findMany({
    where: { ...statusWhere, ...(q.resourceId ? { resourceId: q.resourceId } : {}) },
    include: { media: { select: { id: true }, orderBy: { createdAt: "asc" } }, events: { orderBy: { at: "asc" } }, check: { select: { kind: true, attendanceId: true } } },
    orderBy: { reportedAt: "desc" },
    take: 300,
  });
  const ids = [...new Set(rows.map((r) => r.resourceId))];
  const [machines, siblings, all] = await Promise.all([
    prisma.resource.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, updatedAt: true } }),
    prisma.assetFault.findMany({ where: { resourceId: { in: ids }, status: { in: OPEN_STATUSES } }, select: { id: true, resourceId: true, priority: true, status: true } }),
    prisma.assetFault.findMany({ distinct: ["resourceId"], select: { resourceId: true, resourceName: true }, orderBy: { resourceName: "asc" } }),
  ]);
  const statusOf = new Map(machines.map((m) => [m.id, m.status]));
  const machineOf = new Map(machines.map((m) => [m.id, m]));
  const attIds = [...new Set(rows.map((r) => r.check?.attendanceId).filter((x): x is string => !!x))];
  const atts = attIds.length
    ? await prisma.siteAttendance.findMany({ where: { id: { in: attIds } }, select: { id: true, resourceId: true, company: true, signInMethod: true, placeLabel: true, runBy: true } })
    : [];
  const attOf = new Map(atts.map((a) => [a.id, a]));
  return {
    faults: sortFaults(rows).map((f) => ({
      id: f.id, resourceId: f.resourceId, resourceName: f.resourceName, machineStatus: statusOf.get(f.resourceId) ?? null, itemLabel: f.itemLabel, description: f.description,
      priority: f.priority as FaultPriority, priorityLabel: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority,
      status: f.status as FaultStatus, statusLabel: STATUS_LABEL[f.status as FaultStatus] ?? f.status,
      reportedBy: f.reportedBy, reportedAt: f.reportedAt.toISOString(), lastSeenAt: f.lastSeenAt?.toISOString() ?? null, lastSeenBy: f.lastSeenBy, seenCount: f.seenCount,
      markedDown: f.markedDown, fixedAt: f.fixedAt?.toISOString() ?? null, fixedBy: f.fixedBy, fixNote: f.fixNote, checkKind: f.check?.kind ?? null,
      mediaIds: f.media.map((m) => m.id), photoNote: f.photoNote,
      // Offered while it's open (ticked when fixing) - the same rule decides again when it's applied.
      canBackToAvailable: isOpenStatus(f.status) && offerBackToAvailable(f, machineOf.get(f.resourceId) ?? null, siblings.filter((s) => s.resourceId === f.resourceId)),
      source: (() => {
        const a = f.check?.attendanceId ? attOf.get(f.check.attendanceId) : undefined;
        return a ? { staff: !!a.resourceId, company: a.company, method: METHOD_LABEL[a.signInMethod] ?? a.signInMethod, point: a.placeLabel, runBy: a.runBy } : null;
      })(),
      events: f.events.map((e) => ({ at: e.at.toISOString(), by: e.by, action: e.action, from: e.from, to: e.to, note: e.note })),
    })),
    machines: all.map((m) => ({ id: m.resourceId, name: m.resourceName })),
  };
}

// PATCH: { status: IN_HAND | FIXED, note?, backToAvailable? } and / or { priority }. Status moves are conditional
// (only from the status it's in now), so two people can't both apply one. Fixed needs a note. Do not use (from the
// office too) marks the machine Down; "back to Available" only where the rule allows it.
export async function updateFault(id: string, body: Record<string, unknown>, by: string) {
  const f = await prisma.assetFault.findUnique({ where: { id } });
  if (!f) return problem("That fault isn't there any more.", 404);
  const to = body.status, priority = body.priority;
  const note = cleanText(body.note, LIMITS.note);
  if (to === undefined && priority === undefined && !note) return problem("Nothing to change.");
  if (to !== undefined && to !== "IN_HAND" && to !== "FIXED") return problem("Pick In hand or Fixed.");
  if (priority !== undefined && !isPriority(priority)) return problem("Pick a priority.");
  if (!isOpenStatus(f.status)) return problem("That fault is already fixed.", 409);
  if (to !== undefined && !canMove(f.status, to as string)) return problem(`It's already ${STATUS_LABEL[f.status as FaultStatus]?.toLowerCase() ?? f.status}.`, 409);
  if (to === "FIXED" && note.length < LIMITS.minFixNote) return problem("Say what was done to fix it.");
  const wantBack = to === "FIXED" && body.backToAvailable === true;

  try {
    return await oneAtATime(() => prisma.$transaction(async (tx) => {
      let back = false;
      if (to !== undefined) {
        const moved = await tx.assetFault.updateMany({
          where: { id, status: f.status },
          data: { status: to as string, ...(to === "FIXED" ? { fixedAt: new Date(), fixedBy: by, fixNote: note } : {}) },
        });
        if (moved.count !== 1) throw new Refused(problem("Someone else has just changed it - reload.", 409));
        await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "STATUS", from: f.status, to: to as string, note: note || null } });
        if (wantBack) {
          const machine = await tx.resource.findUnique({ where: { id: f.resourceId }, select: { status: true, updatedAt: true } });
          const others = await tx.assetFault.findMany({ where: { resourceId: f.resourceId, status: { in: OPEN_STATUSES } }, select: { id: true, priority: true, status: true } });
          // PS-008: re-checked here, against the record as it is now (a status change since this fault's Down wins).
          if (!offerBackToAvailable(f, machine, others)) throw new Refused(problem("It can't go back to Available from here - change its status on the register.", 409));
          back = (await tx.resource.updateMany({ where: { id: f.resourceId, status: "DOWN", updatedAt: machine!.updatedAt }, data: { status: "AVAILABLE" } })).count === 1;
          if (!back) throw new Refused(problem("The machine has just been changed - reload.", 409));
          if (back) await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "BACK_AVAILABLE", from: "DOWN", to: "AVAILABLE", note: "Back to Available on the register" } });
        }
      } else if (note) {
        await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "NOTE", note } });
      }
      if (priority !== undefined && priority !== f.priority) {
        const changed = await tx.assetFault.updateMany({ where: { id, priority: f.priority }, data: { priority: priority as string } });
        if (changed.count !== 1) throw new Refused(problem("Someone else has just changed it - reload.", 409));
        await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "PRIORITY", from: f.priority, to: priority as string } });
        // Do not use from the office as well: off the board, as from a phone (this fault set it, if it did).
        if (to !== "FIXED" && priority === "DO_NOT_USE") {
          const down = await markDown(tx, f.resourceId);
          if (down) {
            await tx.assetFault.update({ where: { id }, data: { markedDown: true, markedDownAt: down } });
            await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "DOWN", to: "DOWN", note: "Marked Down on the register (Do not use)" } });
          }
        }
      }
      return { ok: true as const, backToAvailable: back };
    }, TX));
  } catch (e) {
    if (e instanceof Refused) return e.p;
    throw e;
  }
}

export const faultMedia = (id: string) => prisma.assetFaultMedia.findUnique({ where: { id }, select: { fileName: true, mime: true, faultId: true, checkId: true } });
// The odometer photo of a truck sign-in, for the Checks tab - only a photo that belongs to an odometer reading (never a
// tip docket or fuel receipt).
export const odometerPhoto = (id: string) =>
  prisma.receiptPhoto.findFirst({ where: { id, odometerReadingId: { not: null } }, select: { fileName: true } });

// The board / register icon: each machine with an open fault -> how many and the worst priority.
export async function faultFlags(): Promise<Record<string, { open: number; worst: FaultPriority }>> {
  const rows = await prisma.assetFault.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { resourceId: true, priority: true } });
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.resourceId, [...(by.get(r.resourceId) ?? []), r.priority]);
  const out: Record<string, { open: number; worst: FaultPriority }> = {};
  for (const [id, ps] of by) { const w = worstPriority(ps); if (w) out[id] = { open: ps.length, worst: w }; }
  return out;
}

// The Checks tab: that Sydney day's truck sign-ins, each with its pre-start and post-check (or "No pre-start").
export async function checksForDay(day: string) {
  const signIns = await prisma.siteAttendance.findMany({
    where: { place: "VEHICLE", date: day, removedAt: null, status: { not: "REJECTED" } },
    select: { id: true, workerName: true, company: true, placeLabel: true, vehicleId: true, signInAt: true, signOutAt: true },
    orderBy: { signInAt: "asc" },
    take: 500,
  });
  const checks = signIns.length
    ? await prisma.prestartCheck.findMany({ where: { attendanceId: { in: signIns.map((s) => s.id) } }, include: { faults: { select: { id: true, itemLabel: true, priority: true, status: true } } } })
    : [];
  const of = (id: string, kind: string) => checks.find((c) => c.attendanceId === id && c.kind === kind);
  // Stage 1b: each check's walk-around photos, and each sign-in's odometer photo and reading (km once read).
  const [walk, odos] = checks.length || signIns.length ? await Promise.all([
    prisma.assetFaultMedia.findMany({ where: { checkId: { in: checks.map((c) => c.id) }, role: "WALKAROUND" }, select: { id: true, checkId: true, slot: true }, orderBy: { createdAt: "asc" } }),
    prisma.odometerReading.findMany({ where: { siteAttendanceId: { in: signIns.map((s) => s.id) } }, select: { siteAttendanceId: true, status: true, km: true, photos: { select: { id: true } } } }),
  ]) : [[], []];
  const view = (c: (typeof checks)[number] | undefined) => c ? {
    at: sydneyTime(c.createdAt), checklist: c.checklist, faultCount: c.faultCount, seenCount: c.seenCount,
    answers: (JSON.parse(c.answers) as { key: string; label: string; answer: string }[]),
    faults: c.faults.map((f) => ({ id: f.id, itemLabel: f.itemLabel, priority: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority, status: STATUS_LABEL[f.status as FaultStatus] ?? f.status })),
    walkaround: c.walkaround,
    walkaroundPhotos: walk.filter((m) => m.checkId === c.id).map((m) => ({ id: m.id, slot: m.slot, label: slotLabel(m.slot) })),
  } : null;
  return {
    day,
    signIns: signIns.map((s) => {
      const pre = view(of(s.id, "PRE")), post = view(of(s.id, "POST"));
      return {
        id: s.id, person: s.company ? `${s.workerName} (${s.company})` : s.workerName, machine: s.placeLabel ?? "Truck", machineId: s.vehicleId,
        signedIn: sydneyTime(s.signInAt), signedOut: sydneyTime(s.signOutAt),
        pre, post,
        odometer: (() => {
          const o = odos.find((r) => r.siteAttendanceId === s.id);
          return o ? { status: o.status, km: o.km, photoIds: o.photos.map((p) => p.id) } : null;
        })(),
        preStatus: pre ? (pre.faultCount ? `Done - ${pre.faultCount} fault${pre.faultCount > 1 ? "s" : ""}` : "Done") : "No pre-start",
        postStatus: post ? (post.faultCount ? `Done - ${post.faultCount} fault${post.faultCount > 1 ? "s" : ""}` : "Done") : s.signOutAt ? "No post-check" : "Still signed in",
      };
    }),
  };
}

// ---------- PS-003 (9 Nov 2026, Ilies approved the deletion): photos never sent with a check ----------
// A photo uploaded for a check that was never sent stays unattached. Once a day, those older than 24 hours go: the
// file first (only the file that row names - TOOL_PHOTO_DIR is shared with the Tools register), then the row. The
// token they came with lasted 2 hours, so nothing can attach them any more. FAULT_PHOTO_CLEANUP=off stops it.
export const STALE_MEDIA_HOURS = 24;
export async function cleanupUnattachedMedia(now = new Date()): Promise<{ removed: number } | { skipped: true }> {
  if (process.env.FAULT_PHOTO_CLEANUP === "off") return { skipped: true };
  const stale = await prisma.assetFaultMedia.findMany({
    where: { faultId: null, checkId: null, createdAt: { lt: new Date(now.getTime() - STALE_MEDIA_HOURS * 3_600_000) } },
    select: { id: true, fileName: true },
    take: 1000,
  });
  let removed = 0;
  for (const m of stale) {
    try {
      await removePhoto(m.fileName);
    } catch (e) {
      // Already gone is fine; a name removePhoto refuses (not one savePhoto made) or any other error keeps the row.
      if ((e as { code?: string }).code !== "ENOENT") continue;
    }
    // Only if it is still unattached (it can't be, but the row is the record of the file).
    removed += (await prisma.assetFaultMedia.deleteMany({ where: { id: m.id, faultId: null, checkId: null } })).count;
  }
  return { removed };
}

// Stage 1b (Ilies, 10 Nov 2026): walk-around photos are deleted 12 months after they were taken - sent or not; the
// file first (only the file the row names, one savePhoto made), then the row. Fault photos are never removed by age.
// WALKAROUND_RETENTION=off stops it.
export async function cleanupOldWalkaround(now = new Date()): Promise<{ removed: number } | { skipped: true }> {
  if (process.env.WALKAROUND_RETENTION === "off") return { skipped: true };
  const old = await prisma.assetFaultMedia.findMany({
    where: { role: "WALKAROUND", faultId: null, createdAt: { lt: walkaroundCutoff(now) } },
    select: { id: true, fileName: true },
    take: 1000,
  });
  let removed = 0;
  for (const m of old) {
    try {
      await removePhoto(m.fileName);
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") continue;
    }
    removed += (await prisma.assetFaultMedia.deleteMany({ where: { id: m.id, role: "WALKAROUND", faultId: null } })).count;
  }
  return { removed };
}

// From the instrumentation tick: once a Sydney day, from 3am. In memory only - a restart may run it again, which is
// harmless (it removes the same kind of rows, or nothing).
const cleanupState = globalThis as unknown as { __faultPhotoCleanupDay?: string };
export async function faultPhotoCleanupTick(now = new Date()) {
  if (process.env.FAULT_PHOTO_CLEANUP === "off" && process.env.WALKAROUND_RETENTION === "off") return null;
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(now));
  const today = todaySydney();
  if (hour < 3 || cleanupState.__faultPhotoCleanupDay === today) return null;
  cleanupState.__faultPhotoCleanupDay = today;
  const r = await cleanupUnattachedMedia(now);
  if ("removed" in r) console.log(`fault photo cleanup: ${r.removed} removed`);
  const w = await cleanupOldWalkaround(now);
  if ("removed" in w) console.log(`walk-around photos over 12 months: ${w.removed} removed`);
  return { unsent: r, walkaround: w };
}
