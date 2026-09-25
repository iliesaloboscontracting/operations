import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/jobs/copy { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// Copies every running job (and its assignments) from one day to another.
// Skips a project+shift that already has a job on the target day.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const { from, to } = await req.json();
  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }
  const fromStart = new Date(from);
  const fromEnd = new Date(fromStart);
  fromEnd.setUTCDate(fromEnd.getUTCDate() + 1);
  const toStart = new Date(to);
  const toEnd = new Date(toStart);
  toEnd.setUTCDate(toEnd.getUTCDate() + 1);

  const source = await prisma.job.findMany({
    where: { date: { gte: fromStart, lt: fromEnd }, notRunning: false },
    include: { assignments: true },
    orderBy: { sortOrder: "asc" },
  });
  const existing = await prisma.job.findMany({
    where: { date: { gte: toStart, lt: toEnd } },
  });
  const taken = new Set(existing.map((j) => `${j.projectId ?? j.title}|${j.shift}`));

  let copied = 0;
  for (const j of source) {
    if (taken.has(`${j.projectId ?? j.title}|${j.shift}`)) continue;
    await prisma.job.create({
      data: {
        projectId: j.projectId,
        title: j.title,
        siteCode: j.siteCode,
        date: toStart,
        shift: j.shift,
        startTime: j.startTime,
        endTime: j.endTime,
        dayBrief: j.dayBrief,
        colorTag: j.colorTag,
        sortOrder: j.sortOrder,
        assignments: {
          create: j.assignments.map((a) => ({ resourceId: a.resourceId, role: a.role })),
        },
      },
    });
    copied++;
  }
  return NextResponse.json({ copied });
});
