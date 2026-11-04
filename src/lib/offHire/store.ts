// The off-hire save (rules in ./rules.ts): one tap sets the hire item to Off-hired with the day it was
// called off and the off-hire number, and closes the item's open off-hire request(s) so the supervisor
// sees it's done. Putting it back on hire undoes the item only (a closed request can be reopened on
// the Requests board as usual).
import { prisma } from "../prisma";
import { addEvent } from "../siteRequests";
import { todaySydney } from "../today";
import { CLOSABLE_BY_OFF_HIRE, offHireError, offHireOutcome, offHireRef } from "./rules";

type Problem = { error: string; status: number };

export async function offHireItem(id: string, body: Record<string, unknown>, by: string): Promise<Problem | { closed: number }> {
  const item = await prisma.resource.findUnique({ where: { id }, select: { type: true, category: true, onHireDate: true, active: true } });
  if (!item || !item.active) return { error: "That item isn't on the register any more.", status: 404 };
  const today = todaySydney();
  const date = body.date;
  const err = offHireError(item, date, today);
  if (err) return { error: err, status: 400 };
  const ref = offHireRef(body.ref);
  if ("error" in ref) return { error: ref.error, status: 400 };
  const day = date as string;

  await prisma.resource.update({
    where: { id },
    data: { hireStatus: "RETURNED", offHiredOn: day, offHireRef: ref.ref, offHiredBy: by, offHiredAt: new Date() },
  });
  return { closed: await closeOffHireRequests(id, day, ref.ref, by) };
}

// Its open off-hire request(s) -> done, with the day (and number) for the supervisor. Recorded on the
// request since 25 Oct 2026, before that found through the hire check answer that raised them.
export async function closeOffHireRequests(id: string, day: string, ref: string | null, by: string): Promise<number> {
  const today = todaySydney();
  const viaChecks = (await prisma.hireCheck.findMany({ where: { resourceId: id, requestId: { not: null } }, select: { requestId: true } })).map((c) => c.requestId!);
  const open = await prisma.siteRequest.findMany({
    where: { kind: "OFF_HIRE", status: { in: CLOSABLE_BY_OFF_HIRE }, OR: [{ hireResourceId: id }, { id: { in: viaChecks } }] },
    select: { id: true, status: true },
  });
  const outcome = offHireOutcome(day, ref, today);
  let closed = 0;
  for (const r of open) {
    // Only if it's still where it was a moment ago (the yard or Ilies may be on it).
    const n = await prisma.siteRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: "DONE", outcome, doneAt: new Date() } });
    if (n.count) {
      closed++;
      await addEvent(r.id, "DONE", by, outcome);
    }
  }
  return closed;
}

export async function backOnHire(id: string): Promise<Problem | { ok: true }> {
  const item = await prisma.resource.findUnique({ where: { id }, select: { type: true, hireStatus: true, offHiredOn: true } });
  if (!item || item.type !== "HIRE") return { error: "That item isn't on the register any more.", status: 404 };
  if (item.hireStatus !== "RETURNED" && !item.offHiredOn) return { error: "It isn't off-hired.", status: 400 };
  await prisma.resource.update({
    where: { id },
    data: { hireStatus: "ON_HIRE", offHiredOn: null, offHireRef: null, offHiredBy: null, offHiredAt: null },
  });
  return { ok: true };
}
