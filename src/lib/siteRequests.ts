// Site requests (21 Oct 2026) - server side: creating a request from a site
// link, the sites a supervisor can ask for, and what each person gets to see.
// Names, sites, dates and what's asked for only - no rates or costs anywhere.
import type { SiteRequest, SiteRequestEvent } from "@prisma/client";
import { prisma } from "./prisma";
import type { ResolvedLink } from "./siteLinks";
import { PRIORITIES, SYSTEM_TYPES, typeOf, type Priority } from "./requestTypes";
import { todaySydney } from "./today";
import type { ReminderSuggestion } from "./requestReminders";

const parseSuggestion = (json: string | null): ReminderSuggestion | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as ReminderSuggestion;
  } catch {
    return null;
  }
};

type Req = SiteRequest & { events?: SiteRequestEvent[] };

export function addEvent(requestId: string, action: string, by: string, note?: string | null) {
  return prisma.siteRequestEvent.create({ data: { requestId, action, by, note: note ?? null } });
}

// The sites a link can ask for: projects the person is booked on from today
// for the next week (a hand-over link: its one job's project), plus every
// other active project under "other site". `back` also counts bookings from
// that many days ago (the hire check: hire runs over the weekend, before next
// week's board is made).
export async function sitesFor(link: ResolvedLink, back = 0) {
  const today = new Date(todaySydney() + "T00:00:00.000Z");
  const from = new Date(today.getTime() - back * 86_400_000);
  const weekOut = new Date(today.getTime() + 8 * 86_400_000);
  const jobs = link.kind === "HANDOVER" && link.jobId
    ? await prisma.job.findMany({ where: { id: link.jobId }, select: { project: { select: { id: true, name: true } } } })
    : link.person.id
      ? await prisma.job.findMany({
          where: { date: { gte: from, lt: weekOut }, status: { not: "COMPLETED" }, assignments: { some: { resourceId: link.person.id } } },
          orderBy: { date: "asc" },
          select: { project: { select: { id: true, name: true } } },
        })
      : [];
  const mine = new Map<string, string>();
  for (const j of jobs) if (j.project) mine.set(j.project.id, j.project.name);
  const others = await prisma.project.findMany({ where: { status: "ACTIVE", id: { notIn: [...mine.keys()] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { mine: [...mine].map(([id, name]) => ({ id, name })), others };
}

const clean = (x: unknown, max = 300) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function createRequest(link: ResolvedLink, body: Record<string, unknown>, photoFile: string | null) {
  const type = typeOf(String(body.kind));
  if (!type || SYSTEM_TYPES.includes(type)) return { error: "Pick what you need." };
  const priority = String(body.priority) as Priority;
  if (!PRIORITIES.includes(priority)) return { error: "Pick how urgent it is." };
  const neededBy = new Date(String(body.neededBy));
  if (Number.isNaN(neededBy.getTime())) return { error: "Pick when it's needed by." };
  if (neededBy.getTime() < Date.now() - 6 * 3_600_000) return { error: "That time has already passed - pick when it's needed by." };
  const raw = (body.details ?? {}) as Record<string, unknown>;
  const details: Record<string, string> = {};
  for (const f of type.fields) {
    const val = clean(raw[f.key], 200);
    if (f.required && !val) return { error: `Fill in "${f.label}".` };
    if (val) details[f.key] = val;
  }
  const project = typeof body.projectId === "string" ? await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } }) : null;
  if (!project) return { error: "Pick the site." };
  const by = link.shared && clean(body.who, 40) ? `${link.person.name} - ${clean(body.who, 40)}` : link.person.name;

  return insertRequest({
    kind: type.kind, priority, neededBy, project, summary: type.summary(details).slice(0, 200) || type.label,
    details, note: clean(body.note, 500) || null, photoFile, by, byId: link.person.id, siteLinkId: link.id,
  });
}

// Saves a request with the next number (retried if two arrive at the same
// moment). Used by the request form and by the hire check.
export async function insertRequest(r: {
  kind: string; priority: Priority; neededBy: Date; project: { id: string; name: string }; summary: string;
  details: Record<string, string>; note: string | null; photoFile: string | null; by: string; byId: string | null; siteLinkId: string;
}): Promise<{ request: SiteRequest } | { error: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.siteRequest.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
    try {
      const req = await prisma.siteRequest.create({
        data: {
          number: (last?.number ?? 0) + 1,
          kind: r.kind,
          priority: r.priority,
          neededBy: r.neededBy,
          projectId: r.project.id,
          siteLabel: r.project.name,
          summary: r.summary,
          details: JSON.stringify(r.details),
          note: r.note,
          photoFile: r.photoFile,
          requestedBy: r.by,
          requestedById: r.byId,
          siteLinkId: r.siteLinkId,
          events: { create: { action: "SENT", by: r.by } },
        },
      });
      return { request: req };
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  return { error: "Couldn't send it - try again." };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;
const firstName = (n: string | null) => (n ? n.split(" ")[0] : null);
const last = (r: Req, action: string) => [...(r.events ?? [])].reverse().find((e) => e.action === action) ?? null;
// Who asked the open question - Ilies, or the person actioning it (Alex).
// Answers go back to whoever asked.
export const askedByAssignee = (r: Req) => !!r.assigneeName && last(r, "ASK")?.by === r.assigneeName;
// The latest progress note from whoever is actioning it.
const latestUpdate = (r: Req) => {
  const e = last(r, "UPDATE");
  return e ? { note: e.note ?? "", at: e.at.toISOString(), by: firstName(e.by) } : null;
};
const base = (r: Req) => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  label: typeOf(r.kind)?.label ?? r.kind,
  priority: r.priority as Priority,
  neededBy: r.neededBy.toISOString(),
  site: r.siteLabel,
  summary: r.summary,
  details: JSON.parse(r.details || "{}") as Record<string, string>,
  note: r.note,
  hasPhoto: !!r.photoFile,
  requestedBy: r.requestedBy,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});

// The supervisor who asked: where it's up to, any question, the outcome.
export const siteView = (r: Req) => ({
  ...base(r),
  seenAt: iso(r.seenAt),
  // First name of whoever is actioning it (no other office detail).
  handler: ["TODO", "ACTIONING", "NEEDS_INFO"].includes(r.status) ? firstName(r.assigneeName) : null,
  askedBy: r.status === "NEEDS_INFO" ? (askedByAssignee(r) ? firstName(r.assigneeName) : "Office") : null,
  update: ["TODO", "ACTIONING", "NEEDS_INFO", "DONE"].includes(r.status) ? latestUpdate(r) : null,
  question: r.status === "NEEDS_INFO" ? r.question : null,
  answer: r.answer,
  declineReason: r.status === "DECLINED" ? r.declineReason : null,
  outcome: r.status === "DONE" ? r.outcome : null,
  doneAt: iso(r.doneAt),
});

// Whoever it's assigned to (Alex): the task, with Ilies's note.
export const todoView = (r: Req) => ({
  ...base(r),
  officeNote: r.officeNote,
  question: r.status === "NEEDS_INFO" ? r.question : null,
  askedByMe: r.status === "NEEDS_INFO" && askedByAssignee(r),
  answer: r.answer,
  update: latestUpdate(r),
  outcome: r.outcome,
  doneAt: iso(r.doneAt),
});

// Ilies: everything, including the history.
export const officeView = (r: Req) => ({
  ...base(r),
  seenAt: iso(r.seenAt),
  officeNote: r.officeNote,
  question: r.question,
  answer: r.answer,
  declineReason: r.declineReason,
  assigneeId: r.assigneeId,
  assigneeName: r.assigneeName,
  outcome: r.outcome,
  doneAt: iso(r.doneAt),
  update: latestUpdate(r),
  askedBy: r.status === "NEEDS_INFO" ? (askedByAssignee(r) ? r.assigneeName : "You") : null,
  remindAt: iso(r.remindAt),
  remindNote: r.remindNote,
  remindedAt: iso(r.remindedAt),
  aiSuggestion: parseSuggestion(r.aiSuggestion),
  aiSuggestedAt: iso(r.aiSuggestedAt),
  events: (r.events ?? []).map((e) => ({ action: e.action, by: e.by, note: e.note, at: e.at.toISOString() })),
});
export type SiteRequestView = ReturnType<typeof siteView>;
export type TodoView = ReturnType<typeof todoView>;
export type OfficeRequestView = ReturnType<typeof officeView>;
