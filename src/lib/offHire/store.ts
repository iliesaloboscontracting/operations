// The off-hire save (rules in ./rules.ts): one tap sets the hire item to Off-hired with the day it was
// called off and the off-hire number, and closes the item's open off-hire request(s) so the supervisor
// sees it's done. Putting it back on hire undoes the item only (a closed request can be reopened on
// the Requests board as usual). Every off-hire and put-back is kept in HireOffHireEvent (OH-002).
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { addEvent } from "../siteRequests";
import { todaySydney } from "../today";
import { CLOSABLE_BY_OFF_HIRE, isOffHireGear, offHireError, offHireOutcome, offHireRef } from "./rules";

type Problem = { error: string; status: number };
type Via = "BUTTON" | "STATUS_BOX" | "ADDED";
const short = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });

// The history row (append-only) - inside the caller's transaction when it has one.
export function recordOffHire(db: Prisma.TransactionClient | typeof prisma, resourceId: string, row: { action: "OFF_HIRED" | "BACK_ON_HIRE"; day: string | null; ref: string | null; via: Via; by: string }) {
  return db.hireOffHireEvent.create({ data: { resourceId, ...row } });
}

// Board bookings after the off-hire day - left for the office to take off (OH-005), never removed by itself.
async function laterBookings(id: string, day: string) {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return prisma.assignment.count({ where: { resourceId: id, job: { date: { gte: next } } } });
}

export async function offHireItem(id: string, body: Record<string, unknown>, by: string): Promise<Problem | { closed: number; later: number }> {
  const item = await prisma.resource.findUnique({ where: { id }, select: { type: true, category: true, onHireDate: true, active: true, offHiredOn: true } });
  if (!item || !item.active) return { error: "That item isn't on the register any more.", status: 404 };
  const today = todaySydney();
  const date = body.date;
  const err = offHireError(item, date, today);
  if (err) return { error: err, status: 400 };
  // OH-002: an off-hire is never quietly replaced - put it back on hire first (that's recorded too).
  if (item.offHiredOn) return { error: `Already off-hired ${short(item.offHiredOn)} - put it back on hire first to change it.`, status: 409 };
  const ref = offHireRef(body.ref);
  if ("error" in ref) return { error: ref.error, status: 400 };
  const day = date as string;

  // Only if nobody off-hired it a moment ago.
  const done = await prisma.$transaction(async (tx) => {
    const n = await tx.resource.updateMany({
      where: { id, offHiredOn: null },
      data: { hireStatus: "RETURNED", offHiredOn: day, offHireRef: ref.ref, offHiredBy: by, offHiredAt: new Date() },
    });
    if (n.count) await recordOffHire(tx, id, { action: "OFF_HIRED", day, ref: ref.ref, via: "BUTTON", by });
    return n.count > 0;
  });
  if (!done) return { error: "Someone has just off-hired it - reload to see when.", status: 409 };
  return { closed: await closeOffHireRequests(id, day, ref.ref, by), later: await laterBookings(id, day) };
}

// Its open off-hire request(s) -> done, with the day (and number) for the supervisor. Recorded on the
// request since 25 Oct 2026, before that found through the hire check answer that raised them.
// OH-001 (Ilies, 5 Nov 2026: yes - off-hiring closes it, for anyone who may off-hire): one still waiting
// on the supervisor's answer stays open and gets the off-hire as an update instead.
export async function closeOffHireRequests(id: string, day: string, ref: string | null, by: string): Promise<number> {
  const today = todaySydney();
  const viaChecks = (await prisma.hireCheck.findMany({ where: { resourceId: id, requestId: { not: null } }, select: { requestId: true } })).map((c) => c.requestId!);
  const open = await prisma.siteRequest.findMany({
    where: { kind: "OFF_HIRE", status: { in: [...CLOSABLE_BY_OFF_HIRE, "NEEDS_INFO"] }, OR: [{ hireResourceId: id }, { id: { in: viaChecks } }] },
    select: { id: true, status: true },
  });
  const outcome = offHireOutcome(day, ref, today);
  let closed = 0;
  for (const r of open) {
    if (r.status === "NEEDS_INFO") {
      await addEvent(r.id, "UPDATE", by, `${outcome} Left open - it's waiting on the supervisor's answer.`);
      continue;
    }
    // Only if it's still where it was a moment ago (the yard or Ilies may be on it).
    const n = await prisma.siteRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: "DONE", outcome, doneAt: new Date() } });
    if (n.count) {
      closed++;
      await addEvent(r.id, "DONE", by, outcome);
    }
  }
  return closed;
}

export async function backOnHire(id: string, by: string): Promise<Problem | { ok: true }> {
  const item = await prisma.resource.findUnique({ where: { id }, select: { type: true, category: true, active: true, hireStatus: true, offHiredOn: true, offHireRef: true } });
  // OH-004: the same items the Off-hired button takes - active hire gear, not labour hire.
  if (!item || !item.active || !isOffHireGear(item)) return { error: "That item isn't on the hire register any more.", status: 404 };
  if (item.hireStatus !== "RETURNED" && !item.offHiredOn) return { error: "It isn't off-hired.", status: 400 };
  await prisma.$transaction(async (tx) => {
    await tx.resource.update({
      where: { id },
      data: { hireStatus: "ON_HIRE", offHiredOn: null, offHireRef: null, offHiredBy: null, offHiredAt: null },
    });
    await recordOffHire(tx, id, { action: "BACK_ON_HIRE", day: item.offHiredOn, ref: item.offHireRef, via: "BUTTON", by });
  });
  return { ok: true };
}
