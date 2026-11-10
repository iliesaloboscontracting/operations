// Site requests (21 Oct 2026) - server side: creating a request from a site
// link, the sites a supervisor can ask for, and what each person gets to see.
// Names, sites, dates and what's asked for only - no rates or costs anywhere.
import type { Prisma, SiteRequest, SiteRequestEvent } from "@prisma/client";
import { prisma } from "./prisma";
import type { ResolvedLink } from "./siteLinks";
import { OFFICE_KINDS, PRIORITIES, SYSTEM_TYPES, typeOf, type Priority } from "./requestTypes";
import { todaySydney } from "./today";
import { assertNoMoney } from "./moneyGuard";
import type { ReminderSuggestion } from "./requestReminders";
import { COLLECTED, isWithYard, sendsToYard } from "./yard/rules";

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
    ? await prisma.job.findMany({ where: { id: link.jobId, cancelledAt: null }, select: { project: { select: { id: true, name: true } } } })
    : link.person.id
      ? await prisma.job.findMany({
          where: { date: { gte: from, lt: weekOut }, status: { not: "COMPLETED" }, cancelledAt: null, assignments: { some: { resourceId: link.person.id } } },
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
  // Yard jobs (Ilies, 4 Nov 2026): tools, materials and deliveries the supervisor sends
  // "to the yard" go straight on the yard's list - no Admin decision needed (Admins are
  // still alerted as for any new request).
  const toYard = sendsToYard(type.kind, body.sendTo);

  const out = await insertRequest({
    kind: type.kind, priority, neededBy, project, summary: type.summary(details).slice(0, 200) || type.label,
    details, note: clean(body.note, 500) || null, photoFile, by, byId: link.person.id, siteLinkId: link.id,
    ...(toYard ? { extra: { status: "YARD", yardAt: new Date(), yardBy: by } } : {}),
  });
  if (toYard && "request" in out) await addEvent(out.request.id, "SENT_TO_YARD", by, "Sent straight to the yard");
  return out;
}

// Saves a request with the next number (retried if two arrive at the same
// moment). Used by the request form, the hire check and queries (Phase 2:
// no site link, maybe no project, plus origin / finding / audience / assignee in extra).
export async function insertRequest(r: {
  kind: string; priority: Priority; neededBy: Date; project: { id: string | null; name: string }; summary: string;
  details: Record<string, string>; note: string | null; photoFile: string | null; by: string; byId: string | null; siteLinkId: string | null;
  extra?: Partial<Pick<Prisma.SiteRequestUncheckedCreateInput, "origin" | "findingId" | "audience" | "status" | "seenAt" | "assigneeId" | "assigneeName" | "assigneeUserId" | "hireResourceId" | "yardAt" | "yardBy" | "remindAt" | "remindNote">>;
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
          ...r.extra,
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

// Site and office links ride the public photos tunnel - only the link's
// secret protects them, not Cloudflare Access (Phase 2, 24 Oct 2026). So a
// link only ever sees OPERATIONAL requests (LINK_WHERE in every link query,
// linkVisible() on every row), and never a dollar figure the office or a
// finding wrote: an action or query carrying one is left off the link; on a
// supervisor's own request, an office note / question / outcome / decline
// reason / progress note carrying one is swapped for a pointer to the office.
// The supervisor's own words are theirs and shown exactly as before.
export const LINK_WHERE = { audience: "OPERATIONAL" } as const;
const WITH_THE_OFFICE = "Details are with the office";
const linkText = (t: string | null) => (t != null && !assertNoMoney(t) ? WITH_THE_OFFICE : t);
type LinkCheckable = Pick<SiteRequest, "audience" | "origin" | "summary" | "details" | "note" | "officeNote" | "question" | "answer" | "outcome" | "declineReason">;
export function linkVisible(r: LinkCheckable): boolean {
  if (r.audience !== "OPERATIONAL") return false;
  if (r.origin === "SITE") return true;
  return [r.summary, r.details, r.note, r.officeNote, r.question, r.answer, r.outcome, r.declineReason].every((t) => !t || assertNoMoney(t));
}
// YD-007 (Ilies approved 4 Nov 2026): a request only goes to the yard if the yard's link could show it
// with the note it's sent down with - an office / system request carrying an amount would otherwise
// vanish from the yard's list (linkVisible) while sitting in YARD. A note for the yard with an amount
// in it is refused too: the yard never sees prices, so it would only read "Details are with the office".
export const YARD_MONEY_REFUSAL = "This one has amounts in it - it can't go to the yard.";
export function yardSendMoneyError(r: LinkCheckable, note: string | null): string | null {
  if (note && !assertNoMoney(note)) return YARD_MONEY_REFUSAL;
  return linkVisible({ ...r, officeNote: note ?? r.officeNote }) ? null : YARD_MONEY_REFUSAL;
}
const linkUpdate = (r: Req) => {
  const u = latestUpdate(r);
  return u ? { ...u, note: linkText(u.note) ?? "" } : null;
};

// The supervisor who asked: where it's up to, any question, the outcome.
export const siteView = (r: Req) => ({
  ...base(r),
  seenAt: iso(r.seenAt),
  // First name of whoever is actioning it (no other office detail).
  handler: ["TODO", "ACTIONING", "NEEDS_INFO"].includes(r.status) ? firstName(r.assigneeName) : null,
  askedBy: r.status === "NEEDS_INFO" ? (askedByAssignee(r) ? firstName(r.assigneeName) : "Office") : null,
  update: ["TODO", "ACTIONING", "NEEDS_INFO", "DONE"].includes(r.status) ? linkUpdate(r) : null,
  question: r.status === "NEEDS_INFO" ? linkText(r.question) : null,
  answer: r.answer,
  declineReason: r.status === "DECLINED" ? linkText(r.declineReason) : null,
  outcome: r.status === "DONE" ? linkText(r.outcome) : null,
  doneAt: iso(r.doneAt),
  // Yard jobs (4 Nov 2026): with the yard / ready for collection, the yard's photo and its
  // "missing" note (through the link money rule), and a "Collected" button while READY.
  yard: yardProgress(r),
});

// What the yard has done on a request, as a link may see it (no dollar figure).
function yardProgress(r: Req) {
  const shown = isWithYard(r.status) || (r.status === "DONE" && r.outcome === COLLECTED && !!r.readyAt);
  if (!r.yardAt || !shown) return null;
  const ready = r.status !== "YARD" && !!r.readyAt;
  const collected = r.status === "DONE" ? last(r, "COLLECTED") : null;
  // YD-004 (Ilies approved 4 Nov 2026): names typed on a phone go through the money rule too
  // (sharedWho already refuses one with a dollar figure - this covers anything stored before).
  return {
    readyAt: ready ? iso(r.readyAt) : null,
    readyBy: ready ? linkText(r.readyBy) : null,
    readyNote: ready ? linkText(r.readyNote) : null,
    hasReadyPhoto: ready && !!r.readyPhotoFile,
    onItBy: r.status === "YARD" ? linkText(last(r, "YARD_ON_IT")?.by ?? null) : null,
    collectedAt: collected ? collected.at.toISOString() : null,
    collectedBy: linkText(collected?.by ?? null),
  };
}

// The yard's list (Ilies, 4 Nov 2026) - on the yard's shared phone link, which rides the
// public photos tunnel, and on /yard. Narrow: what to get ready, for whom, by when. Every
// piece of text goes through the link money rule - the supervisor's own words included,
// since this is someone else's screen - so a dollar figure never reaches the yard.
export const yardView = (r: Req) => {
  const b = base(r);
  return {
    id: r.id,
    number: r.number,
    kind: r.kind,
    label: b.label,
    priority: b.priority,
    neededBy: b.neededBy,
    site: r.siteLabel,
    summary: linkText(r.summary) ?? "",
    details: Object.fromEntries(Object.entries(b.details).map(([k, v]) => [k, linkText(String(v)) ?? ""])),
    note: linkText(r.note),
    officeNote: linkText(r.officeNote), // the Admin's note when they sent it down
    hasPhoto: !!r.photoFile,
    requestedBy: linkText(r.requestedBy) ?? "",
    status: r.status,
    createdAt: b.createdAt,
    yardAt: iso(r.yardAt),
    yardBy: linkText(r.yardBy),
    ...(yardProgress(r) ?? { readyAt: null, readyBy: null, readyNote: null, hasReadyPhoto: false, onItBy: null, collectedAt: null, collectedBy: null }),
  };
};
export type YardJobView = ReturnType<typeof yardView>;

// Whoever it's assigned to (Alex): the task, with Ilies's note.
export const todoView = (r: Req) => ({
  ...base(r),
  officeNote: linkText(r.officeNote),
  question: r.status === "NEEDS_INFO" ? linkText(r.question) : null,
  askedByMe: r.status === "NEEDS_INFO" && askedByAssignee(r),
  answer: r.answer,
  update: linkUpdate(r),
  outcome: linkText(r.outcome),
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
  // Yard jobs (4 Nov 2026) - who sent it down, and what the yard did.
  yardAt: iso(r.yardAt),
  yardBy: r.yardBy,
  readyAt: iso(r.readyAt),
  readyBy: r.readyBy,
  readyNote: r.readyNote,
  hasReadyPhoto: !!r.readyPhotoFile,
  // An off-hire's item, for the board's Off-hired button (5 Nov 2026).
  ...(r.kind === "OFF_HIRE" ? { hireResourceId: r.hireResourceId } : {}),
  // Actions and queries only (Phase 2) - site requests carry exactly the fields they always had.
  ...(OFFICE_KINDS.includes(r.kind)
    ? { office: { origin: r.origin, findingId: r.findingId, audience: r.audience, assigneeUserId: r.assigneeUserId, hasAnswerFile: !!r.answerFile } }
    : {}),
});
export type SiteRequestView = ReturnType<typeof siteView>;
export type TodoView = ReturnType<typeof todoView>;
export type OfficeRequestView = ReturnType<typeof officeView>;
