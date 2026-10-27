// Information requests, server side (Task I, 25 Oct 2026). A sent question
// is a SiteRequest of kind QUERY with no finding (origin DIRECTOR), audience
// DIRECTOR - so it never reaches a site link and Managers never see it - and
// it goes to one login: accounts, Nick or Yoel (or another director-access
// login). They answer in the app (Directors -> My queries; accounts'
// Invoices -> Queries); an FYI is just marked read. Answers never change any
// record. No phone alerts to the person asked (Ilies: no director alerts);
// "Nudge" just records a reminder they see on their banner.
// Drafts (InfoRequestDraft) wait for the owner to tick and send them.
import type { SiteRequest } from "@prisma/client";
import { prisma } from "../prisma";
import { OWNER_EMAIL } from "../owner";
import { addEvent, insertRequest } from "../siteRequests";
import { QUERY_TYPE, requestNo } from "../requestTypes";
import { todaySydney } from "../today";
import { assigneeView, queryTargetError, recordQueryDecision } from "../findings/queries";
import type { Actor } from "../findings/actions";
import {
  OPEN_STATUSES, OPERATIONS_AI_NAME, aiQuestionError, aiTargetError, canBeAsked, daysWaiting, isOperationsAi, overAiLimit, parseDraftFile, parseInfoItem, readDetails, resolveTo, whyUnresolved,
  AI_DAILY_LIMIT, AI_DETAILS_MARKER, askedByAiUser, type InfoItem,
} from "./rules";

const ASKABLE_SELECT = { id: true, name: true, email: true, role: true, directorAccess: true, active: true } as const;
const DECIDABLE = ["SENT", "SEEN", "TODO", "NEEDS_INFO", "ANSWERED"];

// Due date -> 5pm Sydney that day (UTC+10/11 - 07:00Z is 5pm or 6pm, either is fine for a due time).
const dueAt = (d: string | null) => (d ? new Date(`${d}T07:00:00.000Z`) : new Date(Date.now() + 7 * 86_400_000));

// ---------- raise one ----------

export async function raiseInfoRequest(item: InfoItem, assigneeUserId: string, actor: Actor, batch?: string): Promise<{ request: SiteRequest } | { error: string; status?: number }> {
  const user = await prisma.user.findUnique({ where: { id: assigneeUserId }, select: ASKABLE_SELECT });
  // Operations AI (the Building Agent login) asks a wider group, at most 20 a day.
  const ai = isOperationsAi(actor.email, actor.role);
  const bad = ai ? aiTargetError(user, actor.id, OWNER_EMAIL) ?? aiQuestionError(item) : queryTargetError(user ? { type: "USER", user } : null, actor, item.question);
  if (bad || !user) return { error: bad ?? "Pick who to ask." };
  if (ai) {
    // Counted by what the server stored (CH-023), not by the "asked by" name.
    const sent = (await prisma.siteRequest.findMany({ where: { kind: QUERY_TYPE.kind, details: { contains: AI_DETAILS_MARKER }, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, select: { details: true } }))
      .filter((r) => askedByAiUser(r.details, actor.id)).length;
    if (overAiLimit(sent)) return { error: `Operations AI has sent ${AI_DAILY_LIMIT} questions in the last 24 hours - that's the most for a day.`, status: 429 };
  }
  const by = ai ? OPERATIONS_AI_NAME : actor.name;
  const dup = await prisma.siteRequest.findFirst({
    where: { kind: QUERY_TYPE.kind, findingId: null, assigneeUserId, summary: item.title, status: { in: [...OPEN_STATUSES, "ANSWERED"] } },
    select: { number: true },
  });
  if (dup) return { error: `${user.name} already has this question open (${requestNo(dup.number)}).` };
  const details: Record<string, string> = { question: item.question, infoType: item.infoType };
  if (item.need) details.need = item.need;
  if (item.why) details.why = item.why;
  if (batch) details.batch = batch;
  if (ai) { details.askedByAi = "1"; details.askedByUserId = actor.id; }
  const made = await insertRequest({
    kind: QUERY_TYPE.kind,
    priority: item.infoType === "FYI" ? "LOW" : "HIGH",
    neededBy: dueAt(item.dueDate),
    project: { id: null, name: "Information request" },
    summary: item.title,
    details,
    note: null, photoFile: null, by, byId: null, siteLinkId: null,
    extra: { origin: "DIRECTOR", audience: "DIRECTOR", status: "TODO", seenAt: new Date(), assigneeName: user.name, assigneeUserId: user.id },
  });
  if ("error" in made) return made;
  await addEvent(made.request.id, "ASKED_QUERY", by, `To ${user.name}${item.infoType === "FYI" ? " (FYI)" : ""}`);
  return made;
}

// ---------- drafts (owner) ----------

export async function loadDraftFile(json: unknown, createdBy: string) {
  const today = todaySydney();
  const parsed = parseDraftFile(json, today);
  if ("error" in parsed) return parsed;
  const users = await prisma.user.findMany({ select: ASKABLE_SELECT });
  const rows = [];
  for (const it of parsed.items) {
    if ("error" in it) { rows.push({ to: it.to, error: it.error }); continue; }
    const who = resolveTo(it.to, users, OWNER_EMAIL);
    const d = await prisma.infoRequestDraft.create({
      data: {
        batch: parsed.batch, toText: it.to, assigneeUserId: who?.id ?? null, infoType: it.item.infoType, title: it.item.title,
        question: it.item.question, need: it.item.need, why: it.item.why, dueDate: it.item.dueDate, createdBy,
      },
    });
    rows.push({ to: it.to, id: d.id, resolvedTo: who?.name ?? null, whyNot: who ? null : whyUnresolved(it.to, users, OWNER_EMAIL) });
  }
  return { batch: parsed.batch, rows };
}

export async function listDrafts() {
  const [drafts, users] = await Promise.all([
    prisma.infoRequestDraft.findMany({ where: { status: "DRAFT" }, orderBy: [{ createdAt: "asc" }] }),
    prisma.user.findMany({ select: ASKABLE_SELECT }),
  ]);
  const name = new Map(users.map((u) => [u.id, `${u.name}${u.role === "DIRECTOR" ? " (director login)" : u.role === "ACCOUNTS" ? " (accounts)" : ""}`]));
  return drafts.map((d) => ({ ...d, toName: d.assigneeUserId ? name.get(d.assigneeUserId) ?? null : null, whyNot: d.assigneeUserId ? null : whyUnresolved(d.toText, users, OWNER_EMAIL) }));
}

export async function discardDraft(id: string, by: string) {
  const d = await prisma.infoRequestDraft.findUnique({ where: { id } });
  if (!d || d.status !== "DRAFT") return { error: "That draft isn't waiting any more." };
  await prisma.infoRequestDraft.update({ where: { id }, data: { status: "DISCARDED", decidedBy: by, decidedAt: new Date() } });
  return { ok: true as const };
}

// ---------- batch send (owner): drafts by id, or typed items ----------

type BatchItem = { draftId?: unknown; toUserId?: unknown } & Record<string, unknown>;

export async function sendBatch(items: unknown, actor: Actor) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return { error: "Send 1 to 100 questions at a time.", results: [] };
  const today = todaySydney();
  // Check everything first: nothing is sent unless every item is sendable.
  const plan: { item: InfoItem; userId: string; draftId: string | null; batch?: string }[] = [];
  const problems: { index: number; error: string }[] = [];
  for (const [i, raw] of (items as BatchItem[]).entries()) {
    if (typeof raw?.draftId === "string") {
      const d = await prisma.infoRequestDraft.findUnique({ where: { id: raw.draftId } });
      if (!d || d.status !== "DRAFT") { problems.push({ index: i, error: "That draft isn't waiting any more." }); continue; }
      if (!d.assigneeUserId) { problems.push({ index: i, error: `"${d.toText}" doesn't match one login - fix who it's to.` }); continue; }
      const item = parseInfoItem({ type: d.infoType, title: d.title, question: d.question, need: d.need, why: d.why, dueDate: d.dueDate && d.dueDate >= today ? d.dueDate : null }, today);
      if ("error" in item) { problems.push({ index: i, error: item.error }); continue; }
      plan.push({ item, userId: d.assigneeUserId, draftId: d.id, batch: d.batch });
    } else {
      const item = parseInfoItem(raw ?? {}, today);
      if ("error" in item) { problems.push({ index: i, error: item.error }); continue; }
      if (typeof raw?.toUserId !== "string") { problems.push({ index: i, error: "Pick who it's to." }); continue; }
      plan.push({ item, userId: raw.toUserId, draftId: null });
    }
  }
  if (problems.length) return { error: "Nothing was sent - fix these first.", problems, results: [] };
  const results = [];
  for (const p of plan) {
    const r = await raiseInfoRequest(p.item, p.userId, actor, p.batch);
    if ("error" in r) { results.push({ title: p.item.title, error: r.error }); continue; }
    if (p.draftId) await prisma.infoRequestDraft.update({ where: { id: p.draftId }, data: { status: "SENT", sentRequestId: r.request.id, decidedBy: actor.name, decidedAt: new Date() } });
    results.push({ title: p.item.title, ref: requestNo(r.request.number) });
  }
  return { results };
}

// ---------- the tracker (owner + director access) ----------

// aiUserId: the Building Agent reads back only the questions it sent (D-Q5) - by its user id, not a name (CH-023).
export async function tracker(now = new Date(), aiUserId: string | null = null) {
  const found = await prisma.siteRequest.findMany({
    where: { kind: QUERY_TYPE.kind, assigneeUserId: { not: null }, ...(aiUserId ? { details: { contains: AI_DETAILS_MARKER } } : {}) },
    include: { events: { orderBy: { at: "asc" } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  const rows = aiUserId ? found.filter((r) => askedByAiUser(r.details, aiUserId)) : found;
  const findingTitles = new Map(
    (await prisma.finding.findMany({ where: { id: { in: rows.map((r) => r.findingId).filter((x): x is string => !!x) } }, select: { id: true, title: true } })).map((f) => [f.id, f.title]),
  );
  return rows.map((r) => {
    const d = readDetails(r.details);
    const last = (a: string) => [...r.events].reverse().find((e) => e.action === a)?.at ?? null;
    const open = OPEN_STATUSES.includes(r.status);
    return {
      id: r.id, ref: requestNo(r.number), title: r.findingId ? (d.question ?? r.summary).slice(0, 120) : r.summary,
      question: d.question ?? r.summary, need: d.need ?? null, why: d.why ?? null, infoType: d.infoType ?? "QUESTION", batch: d.batch ?? null,
      finding: r.findingId ? findingTitles.get(r.findingId) ?? "a finding" : null,
      to: r.assigneeName, askedBy: r.requestedBy, askedByAi: (d as { askedByAi?: string }).askedByAi === "1" && !!(d as { askedByUserId?: string }).askedByUserId, askedAt: r.createdAt, dueBy: r.neededBy, status: r.status,
      daysWaiting: open ? daysWaiting(r.createdAt, now) : null,
      followUp: r.status === "NEEDS_INFO" ? r.question : null,
      answer: r.answer, answeredAt: last("ANSWERED"), readAt: last("READ"), hasFile: !!r.answerFile,
      remindedAt: last("REMINDED"), outcome: r.outcome, closedAt: r.doneAt,
    };
  });
}

// Close / ask a follow-up / decline / nudge / reopen - owner + director access.
export async function decide(id: string, body: Record<string, unknown>, by: { name: string; id: string }) {
  const r = await prisma.siteRequest.findUnique({ where: { id } });
  if (!r || r.kind !== QUERY_TYPE.kind || !r.assigneeUserId) return { error: "Not found.", status: 404 };
  const t = (x: unknown, max = 500) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const open = DECIDABLE.includes(r.status);
  let data: Record<string, unknown> | null = null;
  let event = "";
  let note: string | null = null;
  switch (body.action) {
    case "CLOSE":
      if (!open) return { error: "It's already closed.", status: 400 };
      note = t(body.outcome) || "Thanks - closed.";
      data = { status: "DONE", outcome: note, doneAt: new Date() };
      event = "DONE";
      break;
    case "ASK": {
      if (!open) return { error: "It's closed - reopen it first.", status: 400 };
      const q = t(body.question, 300);
      if (q.length < 2) return { error: "Type the follow-up question.", status: 400 };
      data = { status: "NEEDS_INFO", question: q, answer: null };
      event = "ASK"; note = q;
      break;
    }
    case "DECLINE": {
      if (!open) return { error: "It's already closed.", status: 400 };
      const why = t(body.reason, 300);
      if (why.length < 2) return { error: "Say why.", status: 400 };
      data = { status: "DECLINED", declineReason: why };
      event = "DECLINE"; note = why;
      break;
    }
    case "NUDGE":
      if (!OPEN_STATUSES.includes(r.status)) return { error: "Only a question still waiting on them can be nudged.", status: 400 };
      event = "REMINDED"; note = t(body.note, 200) || null;
      break;
    case "REOPEN":
      if (open) return { error: "It's still open.", status: 400 };
      data = { status: "TODO", doneAt: null, outcome: null };
      event = "REOPEN";
      break;
    default:
      return { error: "Unknown action.", status: 400 };
  }
  if (data) await prisma.siteRequest.update({ where: { id }, data });
  else await prisma.siteRequest.update({ where: { id }, data: { updatedAt: new Date() } });
  await addEvent(id, event, by.name, note);
  const mapped = body.action === "CLOSE" ? "DONE" : String(body.action);
  await recordQueryDecision(r, mapped, note, by); // keeps a finding's history in step (no-op for plain requests)
  return { ok: true as const };
}

// FYI: the person marks it read - that closes it.
export async function markRead(r: SiteRequest, who: { name: string; id: string }) {
  if (readDetails(r.details).infoType !== "FYI") return { error: "This one needs an answer." };
  if (!OPEN_STATUSES.includes(r.status)) return { error: "Already read." };
  await prisma.siteRequest.update({ where: { id: r.id }, data: { status: "DONE", outcome: "Read", doneAt: new Date() } });
  await addEvent(r.id, "READ", who.name, null);
  return { ok: true as const };
}

// The owner picks who a draft is for (when the drafted name didn't match one login).
export async function assignDraft(id: string, toUserId: unknown) {
  const d = await prisma.infoRequestDraft.findUnique({ where: { id } });
  if (!d || d.status !== "DRAFT") return { error: "That draft isn't waiting any more." };
  const u = typeof toUserId === "string" ? await prisma.user.findUnique({ where: { id: toUserId }, select: ASKABLE_SELECT }) : null;
  if (!u || !canBeAsked(u, OWNER_EMAIL)) return { error: "Pick accounts, a director login or someone with director access." };
  await prisma.infoRequestDraft.update({ where: { id }, data: { assigneeUserId: u.id } });
  return { ok: true as const };
}

// ---------- Accounts -> Questions (27 Oct 2026) ----------

// Every question to an accounts login, with its history - all of them, not only the last two weeks.
// MINE: the accounts login's own (it answers through /api/queries/:id). ALL: every accounts login's, read-only
// (owner / an Admin with director access - closing stays on Directors -> Info requests).
// AI: only the questions Operations AI sent to accounts.
export async function accountsQuestions(viewerId: string, scope: "MINE" | "ALL" | "AI") {
  const assignees = scope === "MINE" ? [viewerId] : (await prisma.user.findMany({ where: { role: "ACCOUNTS" }, select: { id: true } })).map((u) => u.id);
  const rows = await prisma.siteRequest.findMany({
    where: { kind: QUERY_TYPE.kind, assigneeUserId: { in: assignees }, ...(scope === "AI" ? { details: { contains: AI_DETAILS_MARKER } } : {}) },
    include: { events: { orderBy: { at: "asc" } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  return rows.filter((r) => scope !== "AI" || askedByAiUser(r.details, viewerId)).map((r) => {
    const v = assigneeView(r, false);
    const mine = r.assigneeUserId === viewerId;
    return {
      ...v,
      canAnswer: mine && v.canAnswer,
      canMarkRead: mine && v.canMarkRead,
      to: mine ? null : r.assigneeName,
      history: r.events.map((e) => ({ action: e.action, by: e.by, at: e.at.toISOString(), note: e.note })),
    };
  });
}
