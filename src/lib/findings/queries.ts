// Queries (Phase 2 step 5, 25 Oct 2026, Ilies's "queries"): from any finding,
// the owner or a director asks ONE person ONE question to fill an
// information gap - the accounts login (Invoices -> Queries), Nick or Yoel
// (Directors -> My queries), or a register person on their site link
// (operational and money-free only). They answer (text + an optional file),
// the answer lands on the finding as evidence, and Ilies closes it: done,
// ask a follow-up, or decline. A query NEVER changes any record - if the
// answer means a record should change, that's proposed and applied the
// usual way. It's a SiteRequest of kind QUERY, so it rides the existing
// requests flow: history, reminders, alerts by kind (requestTypes.ts).
import type { SiteRequest, SiteRequestEvent } from "@prisma/client";
import { prisma } from "../prisma";
import { isOwner } from "../owner";
import { assertNoMoney } from "../moneyGuard";
import { insertRequest, addEvent } from "../siteRequests";
import { notifyNewRequest, notifyRequestUpdate } from "../requestAlerts";
import { ANSWER_EXTS, saveInvoiceFile } from "../invoiceFiles";
import { QUERY_TYPE, requestNo, type Priority } from "../requestTypes";
import type { Actor } from "./actions";
import { OPERATIONS_AI_NAME, isOperationsAi } from "../infoRequests/rules";

// While these, the assignee can answer; ANSWERED waits on Ilies.
export const ANSWERABLE = ["TODO", "SEEN", "NEEDS_INFO"];
const OPEN_QUERY = ["SENT", "SEEN", "TODO", "NEEDS_INFO", "ANSWERED"];
const SEVERITY_PRIORITY: Record<string, Priority> = { CRITICAL: "URGENT", HIGH: "HIGH", MEDIUM: "HIGH", INFO: "LOW" };

// ---------- who can be asked (plain rules, tested) ----------

export type QueryTarget =
  | { type: "USER"; user: { id: string; name: string; email: string; role: string; directorAccess: boolean; active: boolean } }
  | { type: "LINK"; resource: { id: string; name: string; type: string; active: boolean; links: number } };

export function queryTargetError(target: QueryTarget | null, actor: Pick<Actor, "id">, question: string): string | null {
  if (!target) return "Pick who to ask.";
  if (question.length < 5) return "Type the question.";
  if (target.type === "USER") {
    const u = target.user;
    if (!u.active) return "That login is switched off.";
    if (u.id === actor.id) return "You can't ask yourself.";
    if (isOwner(u.email)) return "Queries go to accounts or a director - Ilies closes them.";
    if (!(u.role === "ACCOUNTS" || u.role === "DIRECTOR" || u.directorAccess)) return "Queries go to the accounts login, a director, or someone with a site link.";
    return null;
  }
  const r = target.resource;
  if (r.type !== "PERSONNEL" || !r.active) return "That person isn't active in the Labour register.";
  if (r.links === 0) return "That person has no active site link to answer on.";
  // Links ride the public photos tunnel: the question must carry no money.
  if (!assertNoMoney(question)) return "A question going to a site link can't include a dollar figure.";
  return null;
}

// A link only ever sees the question itself - never the finding behind it.
export const queryAudience = (target: QueryTarget, findingAudience: string) => (target.type === "LINK" ? "OPERATIONAL" : findingAudience);

// ---------- raise ----------

type FindingForQuery = { id: string; title: string; audience: string; severity: string; status: string; projectId: string | null; subjectName: string };

export async function raiseQuery(f: FindingForQuery, body: Record<string, unknown>, actor: Actor): Promise<{ request: SiteRequest } | { error: string }> {
  const question = typeof body.question === "string" ? body.question.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  const target: QueryTarget | null = typeof body.userId === "string"
    ? await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true, email: true, role: true, directorAccess: true, active: true } }).then((u) => (u ? { type: "USER" as const, user: u } : null))
    : typeof body.resourceId === "string"
      ? await prisma.resource.findUnique({ where: { id: body.resourceId }, select: { id: true, name: true, type: true, active: true, siteLinks: { where: { revokedAt: null, kind: { in: ["SUPERVISOR", "OFFICE"] } }, select: { id: true } } } })
          .then((r) => (r ? { type: "LINK" as const, resource: { id: r.id, name: r.name, type: r.type, active: r.active, links: r.siteLinks.length } } : null))
      : null;
  const bad = queryTargetError(target, actor, question);
  if (bad || !target) return { error: bad ?? "Pick who to ask." };

  // One open question per finding per person.
  const who = target.type === "USER" ? { assigneeUserId: target.user.id } : { assigneeId: target.resource.id };
  const dup = await prisma.siteRequest.findFirst({ where: { kind: QUERY_TYPE.kind, findingId: f.id, status: { in: OPEN_QUERY }, ...who }, select: { number: true } });
  if (dup) return { error: `There's already an open question (${requestNo(dup.number)}) to them about this.` };

  const neededBy = typeof body.neededBy === "string" && !Number.isNaN(new Date(body.neededBy).getTime())
    ? new Date(body.neededBy)
    : new Date(Date.now() + 2 * 86_400_000);
  const project = f.projectId ? await prisma.project.findUnique({ where: { id: f.projectId }, select: { id: true, name: true } }) : null;
  const assigneeName = target.type === "USER" ? target.user.name : target.resource.name;
  const audience = queryAudience(target, f.audience);
  const made = await insertRequest({
    kind: QUERY_TYPE.kind,
    priority: SEVERITY_PRIORITY[f.severity] ?? "LOW",
    neededBy,
    project: project ?? { id: null, name: f.subjectName },
    summary: question.slice(0, 200),
    // The link never sees the finding's own words (they can carry money).
    details: { question, ...(target.type === "USER" ? { finding: f.title } : {}) },
    note: null, photoFile: null, by: actor.name, byId: null, siteLinkId: null,
    extra: { origin: "FINDING", findingId: f.id, audience, status: "TODO", seenAt: new Date(), assigneeName, ...who },
  });
  if ("error" in made) return made;
  await addEvent(made.request.id, "ASKED_QUERY", actor.name, `To ${assigneeName}`);
  await prisma.$transaction([
    prisma.findingEvent.create({ data: { findingId: f.id, action: "QUERY_CREATED", by: actor.name, byUserId: actor.id, toValue: assigneeName, note: `${requestNo(made.request.number)}: ${question}` } }),
    ...(["OPEN", "ACKNOWLEDGED"].includes(f.status) ? [prisma.finding.update({ where: { id: f.id }, data: { status: "ACTIONED" } })] : []),
  ]);
  await notifyNewRequest(made.request).catch(() => undefined);
  return made;
}

// ---------- what the person asked sees ----------

type Q = SiteRequest & { events?: SiteRequestEvent[] };
const lastAt = (r: Q, action: string) => [...(r.events ?? [])].reverse().find((e) => e.action === action)?.at.toISOString() ?? null;

export const assigneeView = (r: Q, forLink: boolean) => {
  const d = JSON.parse(r.details || "{}") as { question?: string; finding?: string; need?: string; infoType?: string };
  // Information requests (Task I) carry a title, "what we need" and a type; FYI is only marked read.
  const fyi = d.infoType === "FYI";
  return {
    id: r.id,
    ref: requestNo(r.number),
    site: r.siteLabel,
    question: d.question ?? r.summary,
    finding: forLink ? null : d.finding ?? null,
    askedBy: r.requestedBy,
    askedAt: r.createdAt.toISOString(),
    neededBy: r.neededBy.toISOString(),
    status: r.status,
    followUp: r.status === "NEEDS_INFO" ? r.question : null,
    answer: r.answer,
    answeredAt: lastAt(r, "ANSWERED"),
    hasFile: !!r.answerFile,
    outcome: r.status === "DONE" && !forLink ? r.outcome : null,
    canAnswer: ANSWERABLE.includes(r.status) && !fyi,
    title: !r.findingId && r.origin !== "FINDING" ? r.summary : null,
    need: d.need ?? null,
    infoType: fyi ? ("FYI" as const) : ("QUESTION" as const),
    canMarkRead: fyi && ANSWERABLE.includes(r.status),
    remindedAt: lastAt(r, "REMINDED"),
  };
};
export type AssigneeQueryView = ReturnType<typeof assigneeView>;

export async function queriesForUser(userId: string) {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const rows = await prisma.siteRequest.findMany({
    where: { kind: QUERY_TYPE.kind, assigneeUserId: userId, OR: [{ status: { in: OPEN_QUERY } }, { updatedAt: { gte: since } }] },
    orderBy: [{ neededBy: "asc" }],
    include: { events: { orderBy: { at: "asc" } } },
    take: 100,
  });
  return rows.map((r) => assigneeView(r, false));
}

// ---------- answer ----------

export async function answerQuery(
  r: SiteRequest,
  body: Record<string, unknown>,
  who: { name: string; userId?: string | null },
): Promise<{ request: SiteRequest } | { error: string }> {
  if (r.kind !== QUERY_TYPE.kind) return { error: "Not found." };
  if (!ANSWERABLE.includes(r.status)) return { error: r.status === "ANSWERED" ? "Already answered - the office will close it." : "This question is closed." };
  if ((JSON.parse(r.details || "{}") as { infoType?: string }).infoType === "FYI") return { error: "This is for your information - just mark it read." };
  const answer = typeof body.answer === "string" ? body.answer.replace(/\s+/g, " ").trim().slice(0, 1000) : "";
  if (answer.length < 2) return { error: "Type your answer." };
  let answerFile: string | null = r.answerFile;
  if (body.file) {
    // The usual office files (Task I), checked to be what they say they are.
    const saved = await saveInvoiceFile(body.file, body.fileName ?? "answer", { allow: ANSWER_EXTS, checkContent: true });
    if ("error" in saved) return { error: saved.error };
    answerFile = saved.fileName;
  }
  const updated = await prisma.siteRequest.update({ where: { id: r.id }, data: { status: "ANSWERED", answer, answerFile } });
  await addEvent(r.id, "ANSWERED", who.name, answer);
  if (r.findingId) {
    await prisma.$transaction([
      prisma.findingEvidence.create({ data: { findingId: r.findingId, kind: "NOTE", recordType: "SiteRequest", recordId: r.id, label: `Answer from ${who.name} (${requestNo(r.number)})`, value: JSON.stringify({ answer, file: !!answerFile }), capturedBy: who.name } }),
      prisma.findingEvent.create({ data: { findingId: r.findingId, action: "ANSWERED", by: who.name, byUserId: who.userId ?? null, note: `${requestNo(r.number)}: ${answer}` } }),
    ]);
  }
  await notifyRequestUpdate(updated, `Query answered by ${who.name}`).catch(() => undefined);
  return { request: updated };
}

// ---------- Ilies closing it (from the requests decide route) ----------

export async function recordQueryDecision(r: SiteRequest, action: string, note: string | null, by: { name: string; id: string }) {
  if (r.kind !== QUERY_TYPE.kind || !r.findingId) return;
  const what = action === "DONE" ? "closed" : action === "ASK" ? "follow-up asked" : action === "DECLINE" ? "declined" : action === "REOPEN" ? "reopened" : null;
  if (!what) return;
  await prisma.findingEvent.create({
    data: { findingId: r.findingId, action: action === "DONE" ? "QUERY_CLOSED" : "COMMENT", by: by.name, byUserId: by.id, note: `${requestNo(r.number)} ${what}${note ? `: ${note}` : ""}` },
  });
}

// Directors-only questions (information requests) never open for an Admin without director access.
// Operations AI opens the files answered to the questions it sent (27 Oct 2026).
export const canSeeAnswerFile = (r: Pick<SiteRequest, "assigneeUserId" | "audience"> & { requestedBy?: string }, u: Actor) =>
  r.assigneeUserId === u.id || isOwner(u.email) || u.directorAccess || u.role === "DIRECTOR" || (u.role === "ADMIN" && r.audience !== "DIRECTOR")
  || (isOperationsAi(u.email) && r.requestedBy === OPERATIONS_AI_NAME);
