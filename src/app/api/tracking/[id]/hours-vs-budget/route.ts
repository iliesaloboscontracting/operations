import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { hoursVsBudgetFor } from "@/lib/dailyLog/store";

// GET /api/tracking/:id/hours-vs-budget -> labour hours logged by code
// against the job's approved budget and its weekly % complete (Task K).
// Manager+ like Tracking. Hours only - no dollars.
export const GET = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const project = await prisma.project.findUnique({ where: { id: (await paramsP).id }, select: { id: true, jobNo: true, quoteNo: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await hoursVsBudgetFor(project));
});
