// Office chat (27 Oct 2026), server side: the shared "Office" room and one-to-one threads between office logins,
// optionally about a record. The sender may edit or delete their own message (every earlier text kept in
// MessageVersion, append-only). The rules are rules.ts; this file loads, saves and sends the existing push alerts.
// Design: docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3 (no site-link side).
import { prisma } from "../prisma";
import { pushToUsers } from "../push";
import { purchaseNo } from "../purchases/rules";
import { requestNo } from "../requestTypes";
import { AI_DAILY_LIMIT, isOperationsAi } from "../infoRequests/rules";
import { isOwner } from "../owner";
import {
  ROOM_FIRST_VISIT_DAYS, ROOM_KEY, ROOM_TITLE, alertText, canChange, canMessage, canStart, canUseSubject, chatName, checkBody, isSubjectType, labelOf,
  roomSeenBy, seenBy, unreadCount, visibleHistory, type SubjectType,
} from "./rules";

type Problem = { error: string; status: number };
const bad = (error: string, status = 400): Problem => ({ error, status });

// An office login reading / writing (name is its chat name - "Operations AI" for the Building Agent).
export type Viewer = { userId: string; role: string; email: string; name: string };
type Participant = { id: string; userId: string | null; name: string; lastSeenAt: Date | null };

// The Office room: one thread, made the first time anyone opens Messages.
async function room() {
  return prisma.messageThread.upsert({
    where: { roomKey: ROOM_KEY },
    create: { kind: "ROOM", roomKey: ROOM_KEY, subjectLabel: ROOM_TITLE, moneyAllowed: true, createdBy: "Operations" },
    update: {},
  });
}

// My row in the room, made on first visit - it holds my "seen".
async function roomSeat(threadId: string, me: Viewer, seen: boolean) {
  const p = await prisma.messageParticipant.findFirst({ where: { threadId, kind: "USER", userId: me.userId } });
  if (p) return p;
  return prisma.messageParticipant.create({ data: { threadId, kind: "USER", userId: me.userId, name: me.name, role: me.role, lastSeenAt: seen ? new Date() : null } });
}

// Who this login can start a one-to-one with: every other active office login, by chat name.
export async function directory(me: Viewer) {
  const users = await prisma.user.findMany({ where: { active: true, id: { not: me.userId } }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } });
  return { users: users.filter((u) => "ok" in canStart(me.role, u.role)).map((u) => ({ id: u.id, name: chatName(u.name, u.email), role: u.role })) };
}

// The record a thread is about: it must exist; its label is what both people see.
async function subjectLabel(type: SubjectType, key: string | null): Promise<{ label: string } | Problem> {
  if (type === "NONE") return { label: "Message" };
  if (!key) return bad("Which record is it about?");
  switch (type) {
    case "PURCHASE": {
      const r = await prisma.purchaseRequest.findUnique({ where: { id: key }, select: { number: true, what: true } });
      return r ? { label: labelOf(purchaseNo(r.number), r.what) } : bad("That purchase request isn't there.", 404);
    }
    case "REIMBURSEMENT": {
      const r = await prisma.reimbursement.findUnique({ where: { id: key }, select: { description: true, spentOn: true, personName: true } });
      return r ? { label: labelOf(`Reimbursement ${r.spentOn.split("-").reverse().join("/")}`, `${r.personName} · ${r.description}`) } : bad("That reimbursement isn't there.", 404);
    }
    case "PAY_WEEK": {
      const [weekStart, personKey] = key.split("|");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "") || !personKey) return bad("Pick the pay week and person.");
      const r = await prisma.payWeekReview.findFirst({ where: { weekStart, personKey }, select: { personName: true }, orderBy: { at: "desc" } });
      return { label: labelOf(`Pay week from ${weekStart.split("-").reverse().join("/")}`, r?.personName ?? null) };
    }
    case "ABN_INVOICE": {
      const r = await prisma.abnInvoice.findUnique({ where: { id: key }, select: { personName: true, periodFrom: true, periodTo: true } });
      return r ? { label: labelOf("ABN invoice", [r.personName, r.periodFrom && r.periodTo ? `${r.periodFrom} to ${r.periodTo}` : null].filter(Boolean).join(" · ")) } : bad("That ABN invoice isn't there.", 404);
    }
    case "SITE_REQUEST": {
      const r = await prisma.siteRequest.findUnique({ where: { id: key }, select: { number: true, summary: true } });
      return r ? { label: labelOf(requestNo(r.number), r.summary) } : bad("That request isn't there.", 404);
    }
  }
  return bad("Unknown record type.");
}

// Phone alert to the other person in a one-to-one - who it's from, never the text or label. The room sends none (D-Q9).
async function alertOther(thread: { id: string }, otherUserId: string | null, fromName: string) {
  if (!otherUserId) return;
  try {
    await pushToUsers([otherUserId], { ...alertText(fromName), url: `/messages?t=${thread.id}`, tag: `msg-${thread.id}` }, "high");
  } catch (e) {
    console.error("message alert failed", e);
  }
}

// Operations AI shares a 20-a-day limit on chat posts (D-Q10; its questions are counted separately).
async function aiOverLimit(me: Viewer) {
  if (!isOperationsAi(me.email)) return false;
  const seats = (await prisma.messageParticipant.findMany({ where: { kind: "USER", userId: me.userId }, select: { id: true } })).map((p) => p.id);
  const sent = await prisma.message.count({ where: { authorId: { in: seats }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  return sent >= AI_DAILY_LIMIT;
}
const AI_LIMIT_TEXT = `Operations AI has sent ${AI_DAILY_LIMIT} messages in the last 24 hours - that's the most for a day.`;

// Start a one-to-one (optionally about a record) with its first message.
export async function startThread(me: Viewer, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const subjectType = b.subjectType ?? "NONE";
  if (!isSubjectType(subjectType)) return bad("Unknown record type.");
  if (!canUseSubject(me.role, subjectType)) return bad("Your login can't message about that record.", 403);
  const u = typeof b.toUserId === "string" && b.toUserId ? await prisma.user.findUnique({ where: { id: b.toUserId }, select: { id: true, name: true, email: true, role: true, active: true } }) : null;
  if (!u || !u.active || u.id === me.userId) return bad("Pick who it's to.");
  const allowed = canStart(me.role, u.role);
  if ("error" in allowed) return bad(allowed.error, 403);
  if (await aiOverLimit(me)) return bad(AI_LIMIT_TEXT, 429);

  const body = checkBody(b.body);
  if ("error" in body) return bad(body.error);
  const subjectKey = subjectType === "NONE" ? null : typeof b.subjectKey === "string" ? b.subjectKey.slice(0, 120) : null;
  const label = await subjectLabel(subjectType, subjectKey);
  if ("error" in label) return label;

  const now = new Date();
  const thread = await prisma.$transaction(async (tx) => {
    const t = await tx.messageThread.create({ data: { kind: "DIRECT", subjectType, subjectKey, subjectLabel: label.label, moneyAllowed: true, createdBy: me.name, lastMessageAt: now } });
    const mine = await tx.messageParticipant.create({ data: { threadId: t.id, kind: "USER", userId: me.userId, name: me.name, role: me.role, lastSeenAt: now } });
    await tx.messageParticipant.create({ data: { threadId: t.id, kind: "USER", userId: u.id, name: chatName(u.name, u.email), role: u.role } });
    await tx.message.create({ data: { threadId: t.id, authorId: mine.id, authorName: me.name, body: body.text, createdAt: now } });
    return t;
  });
  await alertOther(thread, u.id, me.name);
  return { id: thread.id };
}

// The thread and my seat in it: the room for any office login (seat made on first visit), a one-to-one for its two people.
async function openFor(me: Viewer, threadId: string, seen = false) {
  const t = await prisma.messageThread.findUnique({ where: { id: threadId }, include: { participants: true } });
  if (!t || !canMessage(me.role)) return null;
  if (t.kind === "ROOM") {
    const seat = await roomSeat(t.id, me, seen);
    return { t, mine: seat as Participant, others: t.participants.filter((p) => p.id !== seat.id) as Participant[] };
  }
  const mine = t.participants.find((p) => p.userId === me.userId);
  return mine ? { t, mine: mine as Participant, others: t.participants.filter((p) => p.id !== mine.id) as Participant[] } : null;
}

// A reply.
export async function postMessage(me: Viewer, threadId: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  // A first-time room seat starts unseen: a refused message mustn't mark the room read; a sent one does, below.
  const o = await openFor(me, threadId, false);
  if (!o) return bad("Not found.", 404);
  const { t, mine } = o;
  const body = checkBody(b.body);
  if ("error" in body) return bad(body.error);
  if (await aiOverLimit(me)) return bad(AI_LIMIT_TEXT, 429);
  const now = new Date();
  const m = await prisma.$transaction(async (tx) => {
    const row = await tx.message.create({ data: { threadId: t.id, authorId: mine.id, authorName: me.name, body: body.text, createdAt: now } });
    await tx.messageThread.update({ where: { id: t.id }, data: { lastMessageAt: now } });
    await tx.messageParticipant.update({ where: { id: mine.id }, data: { lastSeenAt: now } });
    return row;
  });
  if (t.kind === "DIRECT") await alertOther(t, o.others[0]?.userId ?? null, me.name);
  return { id: m.id };
}

// The sender edits their own message in place (the earlier text kept as an EDIT version), or deletes it (the text
// kept as a DELETE version - the owner only sees it). No approval, no alert; nobody changes someone else's message.
async function ownMessage(me: Viewer, threadId: string, messageId: unknown) {
  const o = await openFor(me, threadId);
  if (!o || typeof messageId !== "string") return bad("Not found.", 404);
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.threadId !== o.t.id) return bad("That message isn't in this conversation.", 404);
  const can = canChange(m, o.mine.id);
  return "error" in can ? bad(can.error, 403) : m;
}

export async function editMessage(me: Viewer, threadId: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const m = await ownMessage(me, threadId, b.messageId);
  if ("error" in m) return m;
  const body = checkBody(b.body);
  if ("error" in body) return bad(body.error);
  if (body.text === m.body) return { id: m.id };
  await prisma.$transaction([
    prisma.messageVersion.create({ data: { messageId: m.id, kind: "EDIT", body: m.body, by: me.name } }),
    prisma.message.update({ where: { id: m.id }, data: { body: body.text, editedAt: new Date() } }),
  ]);
  return { id: m.id };
}

export async function deleteMessage(me: Viewer, threadId: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const m = await ownMessage(me, threadId, b.messageId);
  if ("error" in m) return m;
  await prisma.$transaction([
    prisma.messageVersion.create({ data: { messageId: m.id, kind: "DELETE", body: m.body, by: me.name } }),
    prisma.message.update({ where: { id: m.id }, data: { body: "", deletedAt: new Date() } }),
  ]);
  return { id: m.id };
}

// Opening a thread marks it seen for me.
export async function markSeen(me: Viewer, threadId: string): Promise<{ ok: true } | Problem> {
  const o = await openFor(me, threadId, true);
  if (!o) return bad("Not found.", 404);
  await prisma.messageParticipant.update({ where: { id: o.mine.id }, data: { lastSeenAt: new Date() } });
  return { ok: true };
}

const roomFloor = () => new Date(Date.now() - ROOM_FIRST_VISIT_DAYS * 86_400_000);

// My conversations: the Office room first, then my one-to-ones, newest first, with my unread counts.
export async function listThreads(me: Viewer) {
  const r = await room();
  const seat = await prisma.messageParticipant.findFirst({ where: { threadId: r.id, kind: "USER", userId: me.userId } });
  const roomLast = await prisma.message.findFirst({ where: { threadId: r.id }, orderBy: { createdAt: "desc" }, select: { body: true, authorName: true } });
  const roomUnread = await prisma.message.count({
    where: { threadId: r.id, createdAt: { gt: seat?.lastSeenAt ?? roomFloor() }, ...(seat ? { authorId: { not: seat.id } } : {}) },
  });
  const roomRow = {
    id: r.id, room: true, title: ROOM_TITLE, subjectType: "NONE", subjectKey: null, subjectLabel: "Everyone in the office", other: null,
    lastMessageAt: r.lastMessageAt.toISOString(), last: roomLast ? { by: roomLast.authorName, text: roomLast.body ? roomLast.body.slice(0, 140) : "message deleted" } : null,
    unread: roomUnread,
  };

  const parts = await prisma.messageParticipant.findMany({ where: { kind: "USER", userId: me.userId, thread: { kind: "DIRECT" } }, select: { threadId: true } });
  const threads = await prisma.messageThread.findMany({
    where: { id: { in: parts.map((p) => p.threadId) } },
    include: { participants: true, messages: { orderBy: { createdAt: "asc" }, select: { authorId: true, createdAt: true, body: true, authorName: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
  });
  const direct = threads.map((t) => {
    const mine = t.participants.find((p) => p.userId === me.userId)!;
    const other = t.participants.find((p) => p.id !== mine.id);
    const last = t.messages[t.messages.length - 1];
    return {
      id: t.id, room: false, title: other?.name ?? "Conversation", subjectType: t.subjectType, subjectKey: t.subjectKey, subjectLabel: t.subjectLabel,
      other: other ? { name: other.name } : null,
      lastMessageAt: t.lastMessageAt.toISOString(), last: last ? { by: last.authorName, text: last.body ? last.body.slice(0, 140) : "message deleted" } : null,
      unread: unreadCount(t.messages, mine.id, mine.lastSeenAt),
    };
  });
  return [roomRow, ...direct];
}

const ROOM_SHOWN = 200; // the room shows its latest 200 messages; nothing is ever deleted

export async function getThread(me: Viewer, threadId: string) {
  const o = await openFor(me, threadId);
  if (!o) return null;
  const { t, mine, others } = o;
  const isRoom = t.kind === "ROOM";
  const msgs = (await prisma.message.findMany({
    where: { threadId: t.id }, orderBy: { createdAt: "desc" }, take: isRoom ? ROOM_SHOWN : 2000,
    include: { versions: { orderBy: { at: "asc" } } },
  })).reverse();
  const owner = isOwner(me.email);
  const other = isRoom ? null : others[0] ?? null;
  return {
    id: t.id, room: isRoom, title: isRoom ? ROOM_TITLE : other?.name ?? "Conversation",
    subjectType: t.subjectType, subjectKey: t.subjectKey, subjectLabel: isRoom ? "Everyone in the office" : t.subjectLabel,
    other: other ? { name: other.name } : null,
    messages: msgs.map((m) => {
      const own = m.authorId === mine.id;
      const seenNames = own && isRoom ? roomSeenBy(m.createdAt, others) : [];
      const deleted = !!m.deletedAt;
      return {
        id: m.id, mine: own, by: m.authorName, text: deleted ? null : m.body, at: m.createdAt.toISOString(),
        edited: !!m.editedAt && !deleted, editedAt: m.editedAt?.toISOString() ?? null, deleted, deletedAt: m.deletedAt?.toISOString() ?? null,
        history: visibleHistory(m.versions, deleted, owner), canChange: own && !deleted,
        seen: own ? (isRoom ? seenNames.length > 0 : seenBy(m.createdAt, other?.lastSeenAt)) : null,
        seenAt: own && !isRoom && other?.lastSeenAt && seenBy(m.createdAt, other.lastSeenAt) ? other.lastSeenAt.toISOString() : null,
        seenBy: own && isRoom ? seenNames : null,
      };
    }),
  };
}

// Unread messages for the nav badge.
export async function unreadTotal(me: Viewer) {
  return (await listThreads(me)).reduce((n, t) => n + t.unread, 0);
}
