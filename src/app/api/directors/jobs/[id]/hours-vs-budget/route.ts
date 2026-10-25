import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { hoursVsBudgetFor } from "@/lib/dailyLog/store";

// GET /api/directors/jobs/:id/hours-vs-budget -> the same table as Tracking's
// job page (Task K), for the Directors job page. Director access only.
export const GET = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const project = await prisma.project.findUnique({ where: { id: (await paramsP).id }, select: { id: true, jobNo: true, quoteNo: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await hoursVsBudgetFor(project));
});
