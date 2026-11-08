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
import { savePhoto } from "../toolPhotos";
import { checklistFor, type Checklist } from "./checklists";
import {
  LIMITS, OPEN_STATUSES, PRIORITY_DOT, PRIORITY_LABEL, STATUS_LABEL, alertFor, canMove, cleanText, firstName, isOpenStatus, isPriority, marksDown,
  offerBackToAvailable, sortFaults, validateSubmission, worstPriority, type FaultPriority, type FaultStatus,
} from "./rules";

export type Problem = { error: string; status: number };
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

// The token -> its truck sign-in (not removed / rejected) -> the truck and its checklist.
export async function linkContext(token: unknown): Promise<LinkCtx | Problem> {
  const t = readPrestartToken(token);
  if (!t) return problem("That's timed out - do it with your next sign-in.", 401);
  const a = await prisma.siteAttendance.findUnique({
    where: { id: t.attendanceId },
    select: { id: true, place: true, vehicleId: true, resourceId: true, workerName: true, deviceId: true, status: true, removedAt: true },
  });
  if (!a || a.place !== "VEHICLE" || !a.vehicleId || a.removedAt || a.status === "REJECTED") return problem("That sign-in isn't on a truck any more.", 404);
  const machine = await prisma.resource.findUnique({ where: { id: a.vehicleId }, select: { id: true, name: true, type: true, status: true } });
  const list = machine ? checklistFor(machine.type, t.kind) : null;
  if (!machine || !list) return problem("There's no checklist for this machine.", 404);
  return { attendanceId: a.id, kind: t.kind, deviceId: a.deviceId, person: { id: a.resourceId, name: a.workerName }, machine, list };
}

const openFaultsOf = (resourceId: string) =>
  prisma.assetFault.findMany({ where: { resourceId, status: { in: OPEN_STATUSES } }, orderBy: { reportedAt: "desc" }, take: 30 });

// GET: the checklist, the machine's open faults (first name of who reported it only), and whether it's done already.
export async function linkView(ctx: LinkCtx) {
  const [open, done] = await Promise.all([
    openFaultsOf(ctx.machine.id),
    prisma.prestartCheck.findUnique({ where: { attendanceId_kind: { attendanceId: ctx.attendanceId, kind: ctx.kind } }, select: { id: true } }),
  ]);
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
  };
}

// POST photo: kept for this sign-in, not yet on a fault. 20 a sign-in, 60 a phone a day; none once the check is in.
export async function linkPhoto(ctx: LinkCtx, dataUrl: unknown, deviceId: unknown): Promise<{ id: string } | Problem> {
  if (await prisma.prestartCheck.findUnique({ where: { attendanceId_kind: { attendanceId: ctx.attendanceId, kind: ctx.kind } }, select: { id: true } }))
    return problem("That check is already in - thanks.", 409);
  const dev = typeof deviceId === "string" && deviceId ? deviceId.slice(0, 64) : ctx.deviceId;
  if ((await prisma.assetFaultMedia.count({ where: { attendanceId: ctx.attendanceId } })) >= LIMITS.photosPerSignIn)
    return problem(`That's ${LIMITS.photosPerSignIn} photos for this sign-in - send the check.`, 429);
  if (dev && (await prisma.assetFaultMedia.count({ where: { deviceId: dev, createdAt: { gte: sydneyMidnight() } } })) >= LIMITS.photosPerDeviceDay)
    return problem("Too many photos from this phone today - call the office.", 429);
  const sha256 = typeof dataUrl === "string" ? createHash("sha256").update(dataUrl.slice(dataUrl.indexOf(",") + 1)).digest("hex") : "";
  const saved = await savePhoto(dataUrl);
  if ("error" in saved) return problem(saved.error);
  const mime = saved.fileName.endsWith(".png") ? "image/png" : saved.fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const m = await prisma.assetFaultMedia.create({
    data: { resourceId: ctx.machine.id, attendanceId: ctx.attendanceId, deviceId: dev, kind: "PHOTO", fileName: saved.fileName, mime, sha256 },
  });
  return { id: m.id };
}

class Refused extends Error { constructor(public p: Problem) { super(p.error); } }

// POST the check: in ONE transaction the check, its new faults (photos attached - this sign-in's own, not yet used),
// the "Still there" sightings, the history, and DOWN for Do not use. Then the Admins' pushes (after it's saved; an
// alert that fails never fails the check).
export async function submitCheck(ctx: LinkCtx, body: unknown) {
  const open = await openFaultsOf(ctx.machine.id);
  const v = validateSubmission(ctx.list, body, open.map((f) => ({ id: f.id, itemKey: f.itemKey })));
  if (!v.ok) return problem(v.error);
  const { answers, faults, stillThere } = v.value;
  const allMedia = faults.flatMap((f) => f.mediaIds);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const deviceId = typeof b.deviceId === "string" && b.deviceId ? b.deviceId.slice(0, 64) : ctx.deviceId;
  const by = ctx.person.name;
  let result: { checkId: string; created: { id: string; itemLabel: string; priority: FaultPriority; description: string; markedDown: boolean }[] };
  try {
    result = await prisma.$transaction(async (tx) => {
      if (await tx.prestartCheck.findUnique({ where: { attendanceId_kind: { attendanceId: ctx.attendanceId, kind: ctx.kind } }, select: { id: true } }))
        throw new Refused(problem("That check is already in - thanks.", 409));
      if (allMedia.length) {
        const mine = await tx.assetFaultMedia.count({ where: { id: { in: allMedia }, attendanceId: ctx.attendanceId, faultId: null } });
        if (mine !== allMedia.length) throw new Refused(problem("A photo didn't go through - take it again.", 400));
      }
      const check = await tx.prestartCheck.create({
        data: {
          resourceId: ctx.machine.id, resourceName: ctx.machine.name, resourceType: ctx.machine.type, kind: ctx.kind, attendanceId: ctx.attendanceId,
          personId: ctx.person.id, personName: by, deviceId, checklist: ctx.list.id, answers: JSON.stringify(answers),
          faultCount: faults.length, seenCount: stillThere.length,
        },
      });
      let status = ctx.machine.status;
      const created: { id: string; itemLabel: string; priority: FaultPriority; description: string; markedDown: boolean }[] = [];
      for (const f of faults) {
        let down = false;
        if (marksDown(f.priority, status)) {
          down = (await tx.resource.updateMany({ where: { id: ctx.machine.id, status: { not: "DOWN" } }, data: { status: "DOWN" } })).count === 1;
          if (down) status = "DOWN";
        }
        const row = await tx.assetFault.create({
          data: {
            resourceId: ctx.machine.id, resourceName: ctx.machine.name, checkId: check.id, itemKey: f.itemKey, itemLabel: f.itemLabel,
            description: f.description, priority: f.priority, reportedBy: by, markedDown: down,
          },
        });
        const attached = await tx.assetFaultMedia.updateMany({ where: { id: { in: f.mediaIds }, attendanceId: ctx.attendanceId, faultId: null }, data: { faultId: row.id } });
        if (attached.count !== f.mediaIds.length) throw new Refused(problem("A photo didn't go through - take it again.", 400));
        await tx.assetFaultEvent.create({ data: { faultId: row.id, by, action: "REPORTED", to: f.priority, note: `${ctx.kind === "PRE" ? "Pre-start" : "Post-check"}: ${f.itemLabel}` } });
        if (down) await tx.assetFaultEvent.create({ data: { faultId: row.id, by, action: "DOWN", to: "DOWN", note: "Marked Down on the register (Do not use)" } });
        created.push({ id: row.id, itemLabel: f.itemLabel, priority: f.priority, description: f.description, markedDown: down });
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
      return { checkId: check.id, created };
    });
  } catch (e) {
    if (e instanceof Refused) return e.p;
    if ((e as { code?: string }).code === "P2002") return problem("That check is already in - thanks.", 409);
    throw e;
  }

  // After it's saved: Do not use / Urgent go to the Admins' phones. Never fails the check.
  for (const f of result.created) {
    const a = alertFor(f.priority);
    if (!a) continue;
    await pushToAdmins({
      title: `${PRIORITY_DOT[f.priority]} ${PRIORITY_LABEL[f.priority]} - ${ctx.machine.name}`,
      body: `${f.itemLabel}: ${f.description}\n${by}${f.markedDown ? " · marked Down on the register" : ""}`,
      url: "/faults", tag: `fault-${f.id}`, sticky: a.sticky,
    }, a.urgency).catch((e) => console.error("fault alert", e));
  }
  const sent = result.created.map((f) => ({ itemLabel: f.itemLabel, priority: PRIORITY_LABEL[f.priority], markedDown: f.markedDown }));
  const what = ctx.kind === "PRE" ? "Pre-start" : "Post-check";
  return {
    ok: true as const, id: result.checkId, sent, seen: stillThere.length,
    message: sent.length ? `${what} sent - ${sent.length} fault${sent.length > 1 ? "s" : ""} sent to the office.` : `${what} sent - thanks.`,
  };
}


// ---------- the office ----------

export type FaultDTO = {
  id: string; resourceId: string; resourceName: string; machineStatus: string | null; itemLabel: string | null; description: string;
  priority: FaultPriority; priorityLabel: string; status: FaultStatus; statusLabel: string;
  reportedBy: string; reportedAt: string; lastSeenAt: string | null; lastSeenBy: string | null; seenCount: number;
  markedDown: boolean; fixedAt: string | null; fixedBy: string | null; fixNote: string | null;
  checkKind: string | null; mediaIds: string[]; canBackToAvailable: boolean;
  events: { at: string; by: string; action: string; from: string | null; to: string | null; note: string | null }[];
};

export async function listFaults(q: { status?: string | null; resourceId?: string | null }): Promise<{ faults: FaultDTO[]; machines: { id: string; name: string }[] }> {
  const statusWhere = q.status === "ALL" ? {} : q.status === "FIXED" ? { status: "FIXED" } : q.status === "OPEN" || q.status === "IN_HAND" ? { status: q.status } : { status: { in: OPEN_STATUSES } };
  const rows = await prisma.assetFault.findMany({
    where: { ...statusWhere, ...(q.resourceId ? { resourceId: q.resourceId } : {}) },
    include: { media: { select: { id: true }, orderBy: { createdAt: "asc" } }, events: { orderBy: { at: "asc" } }, check: { select: { kind: true } } },
    orderBy: { reportedAt: "desc" },
    take: 300,
  });
  const ids = [...new Set(rows.map((r) => r.resourceId))];
  const [machines, siblings, all] = await Promise.all([
    prisma.resource.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }),
    prisma.assetFault.findMany({ where: { resourceId: { in: ids }, status: { in: OPEN_STATUSES } }, select: { id: true, resourceId: true, priority: true, status: true } }),
    prisma.assetFault.findMany({ distinct: ["resourceId"], select: { resourceId: true, resourceName: true }, orderBy: { resourceName: "asc" } }),
  ]);
  const statusOf = new Map(machines.map((m) => [m.id, m.status]));
  return {
    faults: sortFaults(rows).map((f) => ({
      id: f.id, resourceId: f.resourceId, resourceName: f.resourceName, machineStatus: statusOf.get(f.resourceId) ?? null, itemLabel: f.itemLabel, description: f.description,
      priority: f.priority as FaultPriority, priorityLabel: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority,
      status: f.status as FaultStatus, statusLabel: STATUS_LABEL[f.status as FaultStatus] ?? f.status,
      reportedBy: f.reportedBy, reportedAt: f.reportedAt.toISOString(), lastSeenAt: f.lastSeenAt?.toISOString() ?? null, lastSeenBy: f.lastSeenBy, seenCount: f.seenCount,
      markedDown: f.markedDown, fixedAt: f.fixedAt?.toISOString() ?? null, fixedBy: f.fixedBy, fixNote: f.fixNote, checkKind: f.check?.kind ?? null,
      mediaIds: f.media.map((m) => m.id),
      // Offered while it's open (ticked when fixing) - the same rule decides again when it's applied.
      canBackToAvailable: isOpenStatus(f.status) && offerBackToAvailable(f, statusOf.get(f.resourceId) ?? "", siblings.filter((s) => s.resourceId === f.resourceId)),
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
    return await prisma.$transaction(async (tx) => {
      let back = false;
      if (to !== undefined) {
        const moved = await tx.assetFault.updateMany({
          where: { id, status: f.status },
          data: { status: to as string, ...(to === "FIXED" ? { fixedAt: new Date(), fixedBy: by, fixNote: note } : {}) },
        });
        if (moved.count !== 1) throw new Refused(problem("Someone else has just changed it - reload.", 409));
        await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "STATUS", from: f.status, to: to as string, note: note || null } });
        if (wantBack) {
          const machine = await tx.resource.findUnique({ where: { id: f.resourceId }, select: { status: true } });
          const others = await tx.assetFault.findMany({ where: { resourceId: f.resourceId, status: { in: OPEN_STATUSES } }, select: { id: true, priority: true, status: true } });
          if (!machine || !offerBackToAvailable(f, machine.status, others)) throw new Refused(problem("It can't go back to Available from here - change its status on the register.", 409));
          back = (await tx.resource.updateMany({ where: { id: f.resourceId, status: "DOWN" }, data: { status: "AVAILABLE" } })).count === 1;
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
          const down = (await tx.resource.updateMany({ where: { id: f.resourceId, status: { not: "DOWN" } }, data: { status: "DOWN" } })).count === 1;
          if (down) {
            await tx.assetFault.update({ where: { id }, data: { markedDown: true } });
            await tx.assetFaultEvent.create({ data: { faultId: id, by, action: "DOWN", to: "DOWN", note: "Marked Down on the register (Do not use)" } });
          }
        }
      }
      return { ok: true as const, backToAvailable: back };
    });
  } catch (e) {
    if (e instanceof Refused) return e.p;
    throw e;
  }
}

export const faultMedia = (id: string) => prisma.assetFaultMedia.findUnique({ where: { id }, select: { fileName: true, mime: true, faultId: true } });

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
  const view = (c: (typeof checks)[number] | undefined) => c ? {
    at: sydneyTime(c.createdAt), checklist: c.checklist, faultCount: c.faultCount, seenCount: c.seenCount,
    answers: (JSON.parse(c.answers) as { key: string; label: string; answer: string }[]),
    faults: c.faults.map((f) => ({ id: f.id, itemLabel: f.itemLabel, priority: PRIORITY_LABEL[f.priority as FaultPriority] ?? f.priority, status: STATUS_LABEL[f.status as FaultStatus] ?? f.status })),
  } : null;
  return {
    day,
    signIns: signIns.map((s) => {
      const pre = view(of(s.id, "PRE")), post = view(of(s.id, "POST"));
      return {
        id: s.id, person: s.company ? `${s.workerName} (${s.company})` : s.workerName, machine: s.placeLabel ?? "Truck", machineId: s.vehicleId,
        signedIn: sydneyTime(s.signInAt), signedOut: sydneyTime(s.signOutAt),
        pre, post,
        preStatus: pre ? (pre.faultCount ? `Done - ${pre.faultCount} fault${pre.faultCount > 1 ? "s" : ""}` : "Done") : "No pre-start",
        postStatus: post ? (post.faultCount ? `Done - ${post.faultCount} fault${post.faultCount > 1 ? "s" : ""}` : "Done") : s.signOutAt ? "No post-check" : "Still signed in",
      };
    }),
  };
}
