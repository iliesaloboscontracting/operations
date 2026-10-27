// Office chat (27 Oct 2026), server side: the shared "Office" room and one-to-one threads between office logins,
// optionally about a record. The sender may edit or delete their own message (every earlier text kept in
// MessageVersion, append-only). The rules are rules.ts; this file loads, saves and sends the existing push alerts.
// Design: docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3 (no site-link side).
import { prisma } from "../prisma";
import { pushToUsers } from "../push";
import { purchaseNo } from "../purchases/rules";
import { requestNo } from "../requestTypes";
import { AI_DAILY_LIMIT, isOperationsAi } from "../infoRequests/rules";
import { OWNER_EMAIL, isOwner } from "../owner";
import {
  ROOM_FIRST_VISIT_DAYS, ROOM_KEY, ROOM_TITLE, alertText, canChange, canMessage, canReadAllThreads, canStart, canUseSubject, chatName, checkBody, isSubjectType, labelOf,
  ALERT_GAP_MS, POSTS_PER_MINUTE, ROOM_ID, overChatLimit, overPostRate, requestSubjectError, roomSeenBy, seenBy, visibleHistory, type SubjectType,
} from "./rules";

type Problem = { error: string; status: number };
const bad = (error: string, status = 400): Problem => ({ error, status });

// An office login reading / writing (name is its chat name - "Operations AI" for the Building Agent).
export type Viewer = { userId: string; role: string; email: string; name: string };
type Participant = { id: string; userId: string | null; name: string; lastSeenAt: Date | null };

// The Office room: one thread with a fixed id (CH-026). Reading never creates it - until the first post or "seen" it
// shows as an empty room; writing makes it.
const emptyRoom = () => ({ id: ROOM_ID, kind: "ROOM", roomKey: ROOM_KEY, subjectType: "NONE", subjectKey: null, subjectLabel: ROOM_TITLE, moneyAllowed: true, createdBy: "Operations", createdAt: new Date(0), lastMessageAt: new Date(0), participants: [] as Participant[] });
const findRoom = () => prisma.messageThread.findUnique({ where: { roomKey: ROOM_KEY }, include: { participants: true } });
async function ensureRoom() {
  return prisma.messageThread.upsert({
    where: { roomKey: ROOM_KEY },
    create: { id: ROOM_ID, kind: "ROOM", roomKey: ROOM_KEY, subjectLabel: ROOM_TITLE, moneyAllowed: true, createdBy: "Operations" },
    update: {},
    include: { participants: true },
  });
}

// My row in the room, made the first time I write to it (a post, or "seen") - it holds my "seen".
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
// CH-026: at most one per thread per recipient every 2 minutes - claimed in one conditional update, so two quick
// messages can't both alert.
async function alertOther(thread: { id: string }, other: { id: string; userId: string | null } | undefined, fromName: string) {
  if (!other?.userId) return;
  const now = new Date();
  const claimed = await prisma.messageParticipant.updateMany({
    where: { id: other.id, OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: new Date(now.getTime() - ALERT_GAP_MS) } }] },
    data: { lastAlertedAt: now },
  });
  if (!claimed.count) return;
  try {
    await pushToUsers([other.userId], { ...alertText(fromName), url: `/messages?t=${thread.id}`, tag: `msg-${thread.id}` }, "high");
  } catch (e) {
    console.error("message alert failed", e);
  }
}

// Posting limits: everyone 30 a minute (CH-026); Operations AI also 20 a day (D-Q10; its questions are counted apart).
const AI_LIMIT_TEXT = `Operations AI has sent ${AI_DAILY_LIMIT} messages in the last 24 hours - that's the most for a day.`;
const RATE_TEXT = `That's ${POSTS_PER_MINUTE} messages in a minute - wait a moment and try again.`;
async function postLimit(me: Viewer): Promise<Problem | null> {
  const seats = (await prisma.messageParticipant.findMany({ where: { kind: "USER", userId: me.userId }, select: { id: true } })).map((p) => p.id);
  if (!seats.length) return null;
  const now = Date.now();
  if (overPostRate(await prisma.message.count({ where: { authorId: { in: seats }, createdAt: { gte: new Date(now - 60_000) } } }))) return bad(RATE_TEXT, 429);
  if (isOperationsAi(me.email) && overChatLimit(me.email, await prisma.message.count({ where: { authorId: { in: seats }, createdAt: { gte: new Date(now - 86_400_000) } } }))) return bad(AI_LIMIT_TEXT, 429);
  return null;
}

// Start a one-to-one (optionally about a record) with its first message.
export async function startThread(me: Viewer, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const subjectType = b.subjectType ?? "NONE";
  if (!isSubjectType(subjectType)) return bad("Unknown record type.");
  if (!canUseSubject(me.role, subjectType)) return bad("Your login can't message about that record.", 403);
  const u = typeof b.toUserId === "string" && b.toUserId ? await prisma.user.findUnique({ where: { id: b.toUserId }, select: { id: true, name: true, email: true, role: true, active: true, directorAccess: true } }) : null;
  if (!u || !u.active || u.id === me.userId) return bad("Pick who it's to.");
  const allowed = canStart(me.role, u.role);
  if ("error" in allowed) return bad(allowed.error, 403);
  const limited = await postLimit(me);
  if (limited) return limited;

  const body = checkBody(b.body);
  if ("error" in body) return bad(body.error);
  const subjectKey = subjectType === "NONE" ? null : typeof b.subjectKey === "string" ? b.subjectKey.slice(0, 120) : null;
  // CH-024: a request both people can see on their own board, or not attached at all.
  if (subjectType === "SITE_REQUEST" && subjectKey) {
    const r = await prisma.siteRequest.findUnique({ where: { id: subjectKey }, select: { audience: true } });
    const meUser = await prisma.user.findUnique({ where: { id: me.userId }, select: { email: true, role: true, directorAccess: true } });
    if (!r || !meUser) return bad("That request isn't there.", 404);
    const why = requestSubjectError(meUser, { ...u, name: chatName(u.name, u.email) }, r);
    if (why) return bad(why, 403);
  }
  const label = await subjectLabel(subjectType, subjectKey);
  if ("error" in label) return label;

  const now = new Date();
  const thread = await prisma.$transaction(async (tx) => {
    const t = await tx.messageThread.create({ data: { kind: "DIRECT", subjectType, subjectKey, subjectLabel: label.label, moneyAllowed: true, createdBy: me.name, lastMessageAt: now } });
    const mine = await tx.messageParticipant.create({ data: { threadId: t.id, kind: "USER", userId: me.userId, name: me.name, role: me.role, lastSeenAt: now } });
    const other = await tx.messageParticipant.create({ data: { threadId: t.id, kind: "USER", userId: u.id, name: chatName(u.name, u.email), role: u.role } });
    await tx.message.create({ data: { threadId: t.id, authorId: mine.id, authorName: me.name, body: body.text, createdAt: now } });
    return { ...t, other };
  });
  await alertOther(thread, thread.other, me.name);
  return { id: thread.id };
}

// The thread and my seat in it: the room for any office login, a one-to-one for its two people.
// mode "read" writes nothing (CH-026): no room, no seat is created - mine is null until I first write to the room.
// mode "write" makes the room and my seat if needed (seen: whether a new seat starts as seen).
type Opened = { t: { id: string; kind: string; subjectType: string; subjectKey: string | null; subjectLabel: string; moneyAllowed: boolean }; mine: Participant | null; others: Participant[]; readOnly: boolean };
async function openFor(me: Viewer, threadId: string, mode: "read" | "write", seen = false): Promise<Opened | null> {
  if (!canMessage(me.role)) return null;
  let t: (Opened["t"] & { participants: Participant[] }) | null = await prisma.messageThread.findUnique({ where: { id: threadId }, include: { participants: true } });
  if (!t && threadId === ROOM_ID) t = mode === "write" ? await ensureRoom() : ((await findRoom()) ?? emptyRoom());
  if (!t) return null;
  if (t.kind === "ROOM") {
    const seat = mode === "write" ? await roomSeat(t.id, me, seen) : (t.participants.find((p) => p.userId === me.userId) ?? null);
    return { t, mine: seat as Participant | null, others: t.participants.filter((p) => p.id !== seat?.id) as Participant[], readOnly: false };
  }
  const mine = t.participants.find((p) => p.userId === me.userId);
  return mine ? { t, mine: mine as Participant, others: t.participants.filter((p) => p.id !== mine.id) as Participant[], readOnly: false } : null;
}

// A reply.
export async function postMessage(me: Viewer, threadId: string, b: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const peek = await openFor(me, threadId, "read");
  if (!peek) return bad("Not found.", 404);
  const body = checkBody(b.body);
  if ("error" in body) return bad(body.error);
  const limited = await postLimit(me);
  if (limited) return limited;
  // Only now make the room / my seat (a first-time seat starts unseen; the post marks it seen, below).
  const o = await openFor(me, threadId, "write", false);
  if (!o || !o.mine) return bad("Not found.", 404);
  const { t, mine } = o;
  const now = new Date();
  const m = await prisma.$transaction(async (tx) => {
    const row = await tx.message.create({ data: { threadId: t.id, authorId: mine.id, authorName: me.name, body: body.text, createdAt: now } });
    await tx.messageThread.update({ where: { id: t.id }, data: { lastMessageAt: now } });
    await tx.messageParticipant.update({ where: { id: mine.id }, data: { lastSeenAt: now } });
    return row;
  });
  if (t.kind === "DIRECT") await alertOther(t, o.others[0], me.name);
  return { id: m.id };
}

// The sender edits their own message in place (the earlier text kept as an EDIT version), or deletes it (the text
// kept as a DELETE version - the owner only sees it). No approval, no alert; nobody changes someone else's message.
async function ownMessage(me: Viewer, threadId: string, messageId: unknown) {
  const o = await openFor(me, threadId, "read");
  if (!o || typeof messageId !== "string") return bad("Not found.", 404);
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.threadId !== o.t.id) return bad("That message isn't in this conversation.", 404);
  if (!o.mine) return bad("You can only change your own messages.", 403);
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
  const o = await openFor(me, threadId, "write", true);
  if (!o || !o.mine) return bad("Not found.", 404);
  await prisma.messageParticipant.update({ where: { id: o.mine.id }, data: { lastSeenAt: new Date() } });
  return { ok: true };
}

const roomFloor = () => new Date(Date.now() - ROOM_FIRST_VISIT_DAYS * 86_400_000);

// Unread in SQL (CH-026): messages by someone else after my last "seen" (an unopened room: the last week only).
// Nothing is written and no conversation is loaded whole. A conversation with nothing since I last looked isn't counted.
async function roomUnreadFor(me: Viewer) {
  const r = await prisma.messageThread.findUnique({ where: { roomKey: ROOM_KEY }, select: { id: true, lastMessageAt: true } });
  if (!r) return { room: null, seat: null, unread: 0 };
  const seat = await prisma.messageParticipant.findFirst({ where: { threadId: r.id, kind: "USER", userId: me.userId }, select: { id: true, lastSeenAt: true } });
  const since = seat?.lastSeenAt ?? roomFloor();
  const unread = r.lastMessageAt > since
    ? await prisma.message.count({ where: { threadId: r.id, createdAt: { gt: since }, ...(seat ? { authorId: { not: seat.id } } : {}) } })
    : 0;
  return { room: r, seat, unread };
}
async function directSeats(me: Viewer) {
  return prisma.messageParticipant.findMany({
    where: { kind: "USER", userId: me.userId, thread: { kind: "DIRECT" } },
    select: { id: true, threadId: true, lastSeenAt: true, thread: { select: { lastMessageAt: true } } },
    orderBy: { thread: { lastMessageAt: "desc" } },
    take: 300,
  });
}
const unreadIn = (s: { id: string; threadId: string; lastSeenAt: Date | null; thread: { lastMessageAt: Date } }) =>
  s.lastSeenAt && s.thread.lastMessageAt <= s.lastSeenAt
    ? Promise.resolve(0)
    : prisma.message.count({ where: { threadId: s.threadId, authorId: { not: s.id }, ...(s.lastSeenAt ? { createdAt: { gt: s.lastSeenAt } } : {}) } });
const lastIn = (threadId: string) => prisma.message.findFirst({ where: { threadId }, orderBy: { createdAt: "desc" }, select: { body: true, authorName: true } });
const lastText = (m: { body: string; authorName: string } | null) => (m ? { by: m.authorName, text: m.body ? m.body.slice(0, 140) : "message deleted" } : null);

// My conversations: the Office room first, then my one-to-ones, newest first, with my unread counts. Reads only.
export async function listThreads(me: Viewer) {
  const room = await roomUnreadFor(me);
  const roomRow = {
    id: room.room?.id ?? ROOM_ID, room: true, title: ROOM_TITLE, subjectType: "NONE", subjectKey: null, subjectLabel: "Everyone in the office", other: null,
    lastMessageAt: (room.room?.lastMessageAt ?? new Date(0)).toISOString(), last: room.room ? lastText(await lastIn(room.room.id)) : null,
    unread: room.unread,
  };
  const seats = await directSeats(me);
  const threads = await prisma.messageThread.findMany({ where: { id: { in: seats.map((s) => s.threadId) } }, include: { participants: { select: { id: true, name: true } } } });
  const byId = new Map(threads.map((t) => [t.id, t]));
  const direct = await Promise.all(seats.map(async (s) => {
    const t = byId.get(s.threadId)!;
    const other = t.participants.find((p) => p.id !== s.id);
    const [unread, last] = await Promise.all([unreadIn(s), lastIn(t.id)]);
    return {
      id: t.id, room: false, title: other?.name ?? "Conversation", subjectType: t.subjectType, subjectKey: t.subjectKey, subjectLabel: t.subjectLabel,
      other: other ? { name: other.name } : null, lastMessageAt: t.lastMessageAt.toISOString(), last: lastText(last), unread,
    };
  }));
  return [roomRow, ...direct];
}

const ROOM_SHOWN = 200; // the room shows its latest 200 messages; nothing is ever deleted

export async function getThread(me: Viewer, threadId: string) {
  const o = (await openFor(me, threadId, "read")) ?? (await ownerReads(me, threadId));
  if (!o) return null;
  const { t, mine, others, readOnly } = o; // readOnly: the owner reading someone else's one-to-one
  const isRoom = t.kind === "ROOM";
  const msgs = (await prisma.message.findMany({
    where: { threadId: t.id }, orderBy: { createdAt: "desc" }, take: isRoom ? ROOM_SHOWN : 2000,
    include: { versions: { orderBy: { at: "asc" } } },
  })).reverse();
  const owner = isOwner(me.email);
  const other = isRoom || readOnly ? null : others[0] ?? null;
  return {
    id: t.id, room: isRoom, readOnly, title: isRoom ? ROOM_TITLE : readOnly ? others.map((p) => p.name).join(" ↔ ") : other?.name ?? "Conversation",
    subjectType: t.subjectType, subjectKey: t.subjectKey, subjectLabel: isRoom ? "Everyone in the office" : t.subjectLabel,
    other: other ? { name: other.name } : null,
    messages: msgs.map((m) => {
      const own = !!mine && m.authorId === mine.id;
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

// D-Q11: the owner opens a one-to-one he isn't in - read-only, no seat, nothing marked seen.
async function ownerReads(me: Viewer, threadId: string) {
  if (!canReadAllThreads(me.email, OWNER_EMAIL)) return null;
  const t = await prisma.messageThread.findUnique({ where: { id: threadId }, include: { participants: true } });
  if (!t || t.kind !== "DIRECT") return null;
  return { t, mine: null as Participant | null, others: t.participants as Participant[], readOnly: true };
}

// D-Q11: "All conversations" - every one-to-one, for the owner only: the two people, what it's about, the last message.
export async function allThreads(me: Viewer) {
  if (!canReadAllThreads(me.email, OWNER_EMAIL)) return null;
  const threads = await prisma.messageThread.findMany({
    where: { kind: "DIRECT" },
    include: { participants: { select: { name: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorName: true } }, _count: { select: { messages: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 500,
  });
  return threads.map((t) => {
    const last = t.messages[0];
    return {
      id: t.id, room: false, title: t.participants.map((p) => p.name).join(" ↔ "), subjectType: t.subjectType, subjectKey: t.subjectKey,
      subjectLabel: `${t.subjectLabel} · ${t._count.messages} message${t._count.messages === 1 ? "" : "s"}`, other: null,
      lastMessageAt: t.lastMessageAt.toISOString(), last: last ? { by: last.authorName, text: last.body ? last.body.slice(0, 140) : "message deleted" } : null, unread: 0,
    };
  });
}

// Unread messages for the nav badge - counts only (CH-026), no previews, nothing written.
export async function unreadTotal(me: Viewer) {
  const [room, seats] = await Promise.all([roomUnreadFor(me), directSeats(me)]);
  return room.unread + (await Promise.all(seats.map(unreadIn))).reduce((n, x) => n + x, 0);
}
