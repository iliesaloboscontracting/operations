import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { canPublishLessons } from "@/lib/lessons/rules";
import { createLesson, draftFor, lessonCandidates, listLessons } from "@/lib/lessons/store";

// Lessons (LCI phase 5a, 25 Oct 2026). Director access (the owner and the directors) reads them;
// only the owner publishes (Ilies: "thats me").
// GET               -> { lessons (published; the owner also sees drafts and retired), candidates (owner), canPublish }
// GET ?draftFor=<findingId> -> a draft prefilled from the finding's own record (owner)
// POST { findingId, title, situation, action, lesson, tags, publish?, supersedesId? } -> a draft, or published (owner)
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const draftId = req.nextUrl.searchParams.get("draftFor");
  if (draftId) {
    const d = await draftFor(user, draftId);
    return "error" in d ? NextResponse.json({ error: d.error }, { status: d.status }) : NextResponse.json(d);
  }
  const [lessons, candidates] = await Promise.all([listLessons(user), lessonCandidates(user)]);
  return NextResponse.json({ lessons, candidates, canPublish: canPublishLessons(user) });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await createLesson(user, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
