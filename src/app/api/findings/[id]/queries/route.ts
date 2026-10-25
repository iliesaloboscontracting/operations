import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { canActOnThisFinding, canSeeThisFinding } from "@/lib/findings/actions";
import { raiseQuery } from "@/lib/findings/queries";
import { requestNo } from "@/lib/requestTypes";

// POST /api/findings/:id/queries { question, userId | resourceId, neededBy? }
// -> asks one person one question about this finding (lib/findings/queries.ts).
// The owner and director-access users only. Never changes any record.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const f = await prisma.finding.findUnique({ where: { id: params.id }, select: { id: true, ruleCode: true, title: true, audience: true, severity: true, status: true, projectId: true, subjectName: true } });
  if (!f || !canSeeThisFinding(user, f)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Task J: who may ask depends on the screen the finding is on.
  if (!canActOnThisFinding(user, f)) return NextResponse.json({ error: "You can't raise a query on this one." }, { status: 403 });
  const out = await raiseQuery(f, await req.json().catch(() => ({})), user);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  return NextResponse.json({ id: out.request.id, ref: requestNo(out.request.number) }, { status: 201 });
});
