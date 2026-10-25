import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { lessonAction } from "@/lib/lessons/store";

// POST /api/lessons/:id { op: EDIT (a draft, + fields) | PUBLISH (a draft) | RETIRE (published, + reason) }
// The owner only. Published text is never edited - retire it and write a corrected one.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await lessonAction(user, (await paramsP).id, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
