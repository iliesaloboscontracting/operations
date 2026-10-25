// Lessons (LCI phase 5a, 25 Oct 2026) - the plain rules: who publishes (the
// owner only - Ilies: "thats me"; LESSON_PUBLISHERS in lib/changes/config.ts),
// who reads, which findings can become a lesson, what a lesson needs, and the
// draft prefilled from the finding's own record. No server imports; `npm test`
// (lessons.test.ts). Design: docs/lci/PHASE4-5-DESIGN.md §2.
//
// The draft is built from the finding's recorded fields and events only - no
// AI and no outside call - so it can't add a figure that isn't on the record.
// Ilies edits it before publishing; nothing is published automatically.
import { isOwner } from "../owner";
import { LESSON_PUBLISHERS } from "../changes/config";
import { canSeeThisFinding, type Actor } from "../findings/actions";

export type LessonResult = "EFFECTIVE" | "NOT_EFFECTIVE" | "RECURRED";

// ---------- people ----------

export const canPublishLessons = (u: Pick<Actor, "email" | "role">) =>
  (LESSON_PUBLISHERS.owner && isOwner(u.email)) || LESSON_PUBLISHERS.roles.includes(u.role);

// A lesson is read by whoever may see the finding it came from (directors see
// the Directors-screen ones; the owner sees all).
export const canReadLesson = (u: Pick<Actor, "email" | "role" | "directorAccess">, l: { ruleCode: string; audience: string }) => canSeeThisFinding(u, l);

// ---------- which findings ----------

// A finding has an outcome worth learning from once it's verified - fixed and
// stayed fixed (EFFECTIVE), or verified as not effective, or it came back
// (RECURRED). Nothing else.
export function outcomeOf(f: { status: string; outcomeResult: string | null }): LessonResult | null {
  if (f.outcomeResult === "NOT_EFFECTIVE" || f.outcomeResult === "RECURRED") return f.outcomeResult;
  if (f.status === "VERIFIED") return "EFFECTIVE";
  return null;
}

export const RESULT_WORDS: Record<LessonResult, string> = {
  EFFECTIVE: "Fixed, and it stayed fixed", NOT_EFFECTIVE: "What was done didn't work", RECURRED: "It came back",
};

// ---------- a lesson ----------

export type LessonInput = { title: string; situation: string; action: string; lesson: string; tags: string[] };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

export function parseLesson(b: Record<string, unknown>): LessonInput | { error: string } {
  const title = text(b.title, 120);
  const situation = text(b.situation, 1500);
  const action = text(b.action, 1500);
  const lesson = text(b.lesson, 600);
  if (title.length < 5) return { error: "Give it a short title." };
  if (situation.length < 10) return { error: "Say what the situation was." };
  if (action.length < 5) return { error: "Say what was done." };
  if (lesson.length < 10) return { error: "Write the lesson - one or two sentences." };
  const tags = (Array.isArray(b.tags) ? b.tags : typeof b.tags === "string" ? b.tags.split(",") : [])
    .map((t) => text(t, 40).toLowerCase()).filter(Boolean);
  return { title, situation, action, lesson, tags: [...new Set(tags)].slice(0, 10) };
}

// ---------- the draft ----------

export type FindingForDraft = {
  title: string; ruleCode: string; subjectName: string; firstSeenAt: Date; seenCount: number;
  resolution: string | null; resolvedBy: string | null; outcome: string | null; status: string; outcomeResult: string | null;
  events: { action: string; by: string; note: string | null }[];
};

const day = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" });

// Prefilled from the record: the finding's title and dates, what people wrote
// when they actioned / resolved / verified it, and its outcome. The lesson
// line itself is left for Ilies to write.
export function draftFrom(f: FindingForDraft): LessonInput & { result: LessonResult | null } {
  const notes = f.events.filter((e) => ["ACTIONED", "RESOLVED", "COMMENT", "ANSWERED"].includes(e.action) && e.note).map((e) => `${e.note} (${e.by})`);
  const result = outcomeOf(f);
  return {
    title: f.title.slice(0, 120),
    situation: `${f.title}. First seen ${day(f.firstSeenAt)}, seen ${f.seenCount} time${f.seenCount === 1 ? "" : "s"}.`,
    action: [f.resolution ? `${f.resolution}${f.resolvedBy ? ` (${f.resolvedBy})` : ""}` : null, ...notes.filter((n) => !f.resolution || !n.startsWith(f.resolution))]
      .filter(Boolean).join("\n").slice(0, 1500) || "",
    lesson: "",
    tags: [f.ruleCode.toLowerCase().replace(/_/g, "-"), f.subjectName.toLowerCase()].slice(0, 10),
    result,
  };
}
