// Lessons (LCI phase 5a), server side: the findings that can become a lesson,
// the draft, saving / publishing (owner only), retiring, reading them back,
// and the "last time" hint on a new finding with the same rule and subject.
// History goes in FindingEvent. Rules: ./rules.ts. Design: PHASE4-5-DESIGN.md §2.
import { prisma } from "../prisma";
import type { Actor } from "../findings/actions";
import { canPublishLessons, canReadLesson, draftFrom, outcomeOf, parseLesson, type LessonResult } from "./rules";

type Problem = { error: string; status: number };
const tagsOf = (s: string): string[] => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const OPEN = ["DRAFT", "PUBLISHED"];

export type LessonDTO = {
  id: string; findingId: string; ruleCode: string; title: string; situation: string; action: string; result: string; lesson: string;
  tags: string[]; status: string; draftedBy: string; reviewedBy: string | null; publishedAt: string | null;
  retiredAt: string | null; retiredBy: string | null; retiredReason: string | null; supersedesId: string | null; createdAt: string;
};
type LessonRow = NonNullable<Awaited<ReturnType<typeof prisma.lesson.findUnique>>>;
const toDTO = (l: LessonRow): LessonDTO => ({
  id: l.id, findingId: l.findingId, ruleCode: l.ruleCode, title: l.title, situation: l.situation, action: l.action, result: l.result, lesson: l.lesson,
  tags: tagsOf(l.tags), status: l.status, draftedBy: l.draftedBy, reviewedBy: l.reviewedBy, publishedAt: l.publishedAt?.toISOString() ?? null,
  retiredAt: l.retiredAt?.toISOString() ?? null, retiredBy: l.retiredBy, retiredReason: l.retiredReason, supersedesId: l.supersedesId, createdAt: l.createdAt.toISOString(),
});

// ---------- reading ----------

// Published lessons the person may see; the publisher also sees drafts and retired ones.
export async function listLessons(u: Actor): Promise<LessonDTO[]> {
  const publisher = canPublishLessons(u);
  const rows = await prisma.lesson.findMany({ where: publisher ? {} : { status: "PUBLISHED" }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 500 });
  return rows.filter((l) => canReadLesson(u, l)).map(toDTO);
}

export type CandidateDTO = { id: string; title: string; ruleCode: string; subjectName: string; result: LessonResult; when: string; resolvedBy: string | null };

// Findings with an outcome (verified / not effective / came back) and no
// lesson yet - for the publisher only. The last 180 days.
export async function lessonCandidates(u: Actor): Promise<CandidateDTO[]> {
  if (!canPublishLessons(u)) return [];
  const since = new Date(Date.now() - 180 * 86_400_000);
  const [rows, taken] = await Promise.all([
    prisma.finding.findMany({
      where: { updatedAt: { gte: since }, OR: [{ status: "VERIFIED" }, { outcomeResult: { in: ["NOT_EFFECTIVE", "RECURRED"] } }] },
      orderBy: { updatedAt: "desc" }, take: 200,
    }),
    prisma.lesson.findMany({ where: { status: { in: OPEN } }, select: { findingId: true } }),
  ]);
  const has = new Set(taken.map((t) => t.findingId));
  return rows.filter((f) => !has.has(f.id) && canReadLesson(u, f) && outcomeOf(f)).map((f) => ({
    id: f.id, title: f.title, ruleCode: f.ruleCode, subjectName: f.subjectName, result: outcomeOf(f)!,
    when: (f.verifiedAt ?? f.resolvedAt ?? f.updatedAt).toISOString(), resolvedBy: f.resolvedBy,
  }));
}

export async function draftFor(u: Actor, findingId: string) {
  if (!canPublishLessons(u)) return { error: "Only Ilies publishes lessons.", status: 403 } as Problem;
  const f = await prisma.finding.findUnique({ where: { id: findingId }, include: { events: { orderBy: { at: "asc" } } } });
  if (!f || !canReadLesson(u, f)) return { error: "Not found", status: 404 } as Problem;
  if (!outcomeOf(f)) return { error: "Only a verified finding (or one verified as not working, or one that came back) can become a lesson.", status: 409 } as Problem;
  return { draft: draftFrom(f) };
}

// ---------- writing (the owner) ----------

const event = (findingId: string, action: string, u: Actor, note: string) =>
  prisma.findingEvent.create({ data: { findingId, action, by: u.name, byUserId: u.id, note: note.slice(0, 500) } });

export async function createLesson(u: Actor, body: Record<string, unknown>): Promise<{ lesson: LessonDTO } | Problem> {
  if (!canPublishLessons(u)) return { error: "Only Ilies publishes lessons.", status: 403 };
  const findingId = typeof body.findingId === "string" ? body.findingId : "";
  const f = await prisma.finding.findUnique({ where: { id: findingId } });
  if (!f || !canReadLesson(u, f)) return { error: "Not found", status: 404 };
  const result = outcomeOf(f);
  if (!result) return { error: "Only a verified finding (or one verified as not working, or one that came back) can become a lesson.", status: 409 };
  const input = parseLesson(body);
  if ("error" in input) return { error: input.error, status: 400 };
  const supersedesId = typeof body.supersedesId === "string" && body.supersedesId ? body.supersedesId : null;
  const old = supersedesId ? await prisma.lesson.findUnique({ where: { id: supersedesId } }) : null;
  if (supersedesId && (!old || old.status === "DRAFT")) return { error: "The lesson it replaces isn't there.", status: 404 };
  // One lesson per finding at a time (a replacement retires the one it replaces).
  const active = await prisma.lesson.findFirst({ where: { findingId, status: { in: OPEN }, ...(old ? { id: { not: old.id } } : {}) } });
  if (active) return { error: `This finding already has a lesson (${active.status.toLowerCase()}): "${active.title}".`, status: 409 };
  const publish = body.publish === true;
  const now = new Date();
  const l = await prisma.lesson.create({
    data: {
      findingId, ruleCode: f.ruleCode, projectId: f.projectId, ...input, tags: JSON.stringify(input.tags), result, audience: f.audience,
      status: publish ? "PUBLISHED" : "DRAFT", draftedBy: u.name, supersedesId,
      ...(publish ? { reviewedBy: u.name, reviewedById: u.id, publishedAt: now } : {}),
    },
  });
  await event(findingId, "LESSON_DRAFTED", u, input.title);
  if (publish) await afterPublish(u, l, old);
  return { lesson: toDTO((await prisma.lesson.findUnique({ where: { id: l.id } }))!) };
}

async function afterPublish(u: Actor, l: LessonRow, old: LessonRow | null) {
  await event(l.findingId, "LESSON_PUBLISHED", u, l.title);
  if (old && old.status === "PUBLISHED") {
    await prisma.lesson.update({ where: { id: old.id }, data: { status: "RETIRED", retiredAt: new Date(), retiredBy: u.name, retiredReason: `Replaced by "${l.title}"` } });
    await event(old.findingId, "LESSON_RETIRED", u, `${old.title} - replaced by a corrected lesson`);
  }
}

// op: EDIT a draft, PUBLISH a draft, RETIRE a published lesson (with a reason).
// ("op", not "action": a lesson has its own "action" field - what was done.)
export async function lessonAction(u: Actor, id: string, body: Record<string, unknown>): Promise<{ lesson: LessonDTO } | Problem> {
  if (!canPublishLessons(u)) return { error: "Only Ilies publishes lessons.", status: 403 };
  const l = await prisma.lesson.findUnique({ where: { id } });
  if (!l || !canReadLesson(u, l)) return { error: "Not found", status: 404 };
  const action = String(body.op ?? "").toUpperCase();
  if (action === "EDIT" || action === "PUBLISH") {
    if (l.status !== "DRAFT") return { error: "A published lesson isn't edited - retire it and write a corrected one.", status: 409 };
    const { op: _op, ...fields } = body;
    const input = action === "EDIT" || fields.title !== undefined ? parseLesson({ ...l, tags: tagsOf(l.tags), ...fields }) : null;
    if (input && "error" in input) return { error: input.error, status: 400 };
    const publish = action === "PUBLISH";
    await prisma.lesson.update({
      where: { id },
      data: { ...(input ? { ...input, tags: JSON.stringify(input.tags) } : {}), ...(publish ? { status: "PUBLISHED", reviewedBy: u.name, reviewedById: u.id, publishedAt: new Date() } : {}) },
    });
    const now = (await prisma.lesson.findUnique({ where: { id } }))!;
    if (publish) await afterPublish(u, now, l.supersedesId ? await prisma.lesson.findUnique({ where: { id: l.supersedesId } }) : null);
    return { lesson: toDTO(now) };
  }
  if (action === "RETIRE") {
    if (l.status !== "PUBLISHED") return { error: "Only a published lesson can be retired.", status: 409 };
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    if (reason.length < 3) return { error: "Say why it's being retired.", status: 400 };
    await prisma.lesson.update({ where: { id }, data: { status: "RETIRED", retiredAt: new Date(), retiredBy: u.name, retiredReason: reason } });
    await event(l.findingId, "LESSON_RETIRED", u, `${l.title} - ${reason}`);
    return { lesson: toDTO((await prisma.lesson.findUnique({ where: { id } }))!) };
  }
  return { error: "Edit, publish or retire.", status: 400 };
}

// ---------- the "last time" hint ----------

// For open findings: the latest published lesson from an earlier finding with
// the same rule and the same subject. Empty when there are none (so screens
// without lessons are unchanged).
export async function lessonHints(findings: { id: string; ruleCode: string; subjectId: string }[]): Promise<Map<string, { id: string; title: string; lesson: string }>> {
  const out = new Map<string, { id: string; title: string; lesson: string }>();
  if (!findings.length) return out;
  const lessons = await prisma.lesson.findMany({ where: { status: "PUBLISHED", ruleCode: { in: [...new Set(findings.map((f) => f.ruleCode))] } }, orderBy: { publishedAt: "desc" } });
  if (!lessons.length) return out;
  const from = await prisma.finding.findMany({ where: { id: { in: lessons.map((l) => l.findingId) } }, select: { id: true, subjectId: true } });
  const subjectOf = new Map(from.map((f) => [f.id, f.subjectId]));
  for (const f of findings) {
    const l = lessons.find((x) => x.ruleCode === f.ruleCode && subjectOf.get(x.findingId) === f.subjectId && x.findingId !== f.id);
    if (l) out.set(f.id, { id: l.id, title: l.title, lesson: l.lesson });
  }
  return out;
}
