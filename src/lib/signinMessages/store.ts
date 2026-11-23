// Message at sign-in (23 Nov 2026) - the database side. Messages and "Got it" rows are only ever added; archiving fills
// the message's archived fields and the row stays (keep forever). The plain rules are in ./rules.ts.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { writeLock, type Who as By } from "../history/store";
import { todaySydney } from "../today";
import {
  mayMark, messagesFor, officeView, personKeyOf, rateRefusal, toCrew,
  type CrewMessage, type MessageInput, type OfficeMessage, type SeenWhere, type Who,
} from "./rules";

type Problem = { error: string; status: number };
const byName = (w: By) => ((w?.name && w.name.trim()) || "Office").slice(0, 120);

// Write a message. People: active Labour-register people only. 30 a day per login - counted inside one locked
// transaction, so two taps at once can't get past it.
// SM-003 accepted by Ilies 23 Nov 2026: the Building Agent may send; it only sends text Ilies approved word-for-word in chat.
export async function createMessage(input: MessageInput, by: By): Promise<{ id: string } | Problem> {
  if (!by?.id) return { error: "Not signed in", status: 401 };
  const people = input.audience === "PEOPLE"
    ? await prisma.resource.findMany({ where: { id: { in: input.resourceIds }, type: "PERSONNEL", active: true }, select: { id: true, name: true } })
    : [];
  if (input.audience === "PEOPLE" && people.length !== input.resourceIds.length)
    return { error: "Pick people from the Labour register (someone picked isn't on it, or is switched off).", status: 400 };
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const recent = await tx.signinMessage.count({ where: { createdById: by.id!, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } });
    const limited = rateRefusal(recent);
    if (limited) return { error: limited, status: 429 };
    const m = await tx.signinMessage.create({
      data: { text: input.text, audience: input.audience, showUntil: input.showUntil, createdBy: byName(by), createdById: by.id ?? null },
      select: { id: true },
    });
    for (const p of people) await tx.signinMessageRecipient.create({ data: { messageId: m.id, resourceId: p.id, name: p.name } });
    return { id: m.id };
  });
}

// Archive: hidden from crew from now on; the message, its people and every "Got it" stay.
export async function archiveMessage(id: string, reason: string | null, by: By): Promise<{ ok: true } | Problem> {
  const row = await prisma.signinMessage.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
  if (!row) return { error: "That message isn't there.", status: 404 };
  if (row.archivedAt) return { error: "That message is already archived.", status: 409 };
  const done = await prisma.signinMessage.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date(), archivedBy: byName(by), archivedById: by?.id ?? null, archiveReason: reason },
  });
  if (!done.count) return { error: "That message is already archived.", status: 409 };
  return { ok: true };
}

// Live messages and what this person has seen of them.
async function liveFor(who: Who, today: string) {
  const key = personKeyOf(who);
  const rid = "resourceId" in who ? who.resourceId : null;
  // Only their own rows are read - never another person's recipients or "Got it".
  const recips = rid ? await prisma.signinMessageRecipient.findMany({ where: { resourceId: rid }, select: { messageId: true, resourceId: true } }) : [];
  const messages = await prisma.signinMessage.findMany({
    where: {
      archivedAt: null, showUntil: { gte: today },
      OR: [{ audience: "ALL" }, ...(recips.length ? [{ audience: "PEOPLE", id: { in: recips.map((r) => r.messageId) } }] : [])],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const seen = await prisma.signinMessageSeen.findMany({ where: { messageId: { in: messages.map((m) => m.id) }, personKey: key }, select: { messageId: true } });
  const recipients = new Map<string, Set<string>>();
  for (const r of recips) recipients.set(r.messageId, (recipients.get(r.messageId) ?? new Set()).add(r.resourceId));
  return { messages, recipients, seen: new Set(seen.map((s) => s.messageId)) };
}

// What this person's phone shows: their own unseen messages and the "everyone" ones - only the words and the day.
export async function crewMessages(who: Who, today = todaySydney()): Promise<CrewMessage[]> {
  const live = await liveFor(who, today);
  return messagesFor({ ...live, who, today }).map(toCrew).filter((m): m is CrewMessage => !!m);
}

// "Got it": one row per message per person (a second tap, or the other screen, finds it already there).
export async function markSeen(
  messageId: string, who: Who, ctx: { deviceId: string | null; where: SeenWhere; attendanceId?: string | null; siteLinkId?: string | null }, today = todaySydney(),
): Promise<{ ok: true } | Problem> {
  const m = await prisma.signinMessage.findUnique({ where: { id: messageId } });
  const rids = m?.audience === "PEOPLE" && "resourceId" in who
    ? new Set((await prisma.signinMessageRecipient.findMany({ where: { messageId, resourceId: who.resourceId }, select: { resourceId: true } })).map((r) => r.resourceId))
    : undefined;
  // Not theirs, archived or finished: the same answer as a message that isn't there - nothing about other people's.
  if (!m || !mayMark(m, rids, who, today)) return { error: "That message isn't there.", status: 404 };
  try {
    await prisma.signinMessageSeen.create({
      data: {
        messageId, personKey: personKeyOf(who),
        resourceId: "resourceId" in who ? who.resourceId : null,
        hireName: "hire" in who ? who.hire.name.slice(0, 60) : null,
        hireCompany: "hire" in who ? who.hire.company.slice(0, 60) : null,
        deviceId: ctx.deviceId ? ctx.deviceId.slice(0, 64) : null,
        where: ctx.where, attendanceId: ctx.attendanceId ?? null, siteLinkId: ctx.siteLinkId ?? null,
      },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // already seen - fine
  }
  return { ok: true };
}

// Who a sign-in was: the person on it (a Labour-register person, or the hire worker's typed name and company).
export async function whoSignedIn(attendanceId: string): Promise<{ who: Who; attendanceId: string } | null> {
  const a = await prisma.siteAttendance.findUnique({ where: { id: attendanceId }, select: { id: true, resourceId: true, workerName: true, company: true, status: true } });
  if (!a || a.status === "REJECTED") return null;
  if (a.resourceId) return { who: { resourceId: a.resourceId }, attendanceId: a.id };
  if (!a.workerName || !a.company) return null;
  return { who: { hire: { name: a.workerName, company: a.company } }, attendanceId: a.id };
}

// The office's list: the newest messages (live, finished and archived), each with seen / not seen yet.
export async function officeMessages(today = todaySydney()): Promise<OfficeMessage[]> {
  const messages = await prisma.signinMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const ids = messages.map((m) => m.id);
  const [recipients, seen] = await Promise.all([
    prisma.signinMessageRecipient.findMany({ where: { messageId: { in: ids } } }),
    prisma.signinMessageSeen.findMany({ where: { messageId: { in: ids } } }),
  ]);
  const rids = [...new Set([...recipients.map((r) => r.resourceId), ...seen.flatMap((s) => (s.resourceId ? [s.resourceId] : []))])];
  const names = new Map((await prisma.resource.findMany({ where: { id: { in: rids } }, select: { id: true, name: true } })).map((r) => [r.id, r.name]));
  return messages.map((m) => officeView(m, recipients, seen, names, today));
}

// The people the office can pick: active Labour-register people, names only.
export function pickablePeople() {
  return prisma.resource.findMany({ where: { type: "PERSONNEL", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 });
}
