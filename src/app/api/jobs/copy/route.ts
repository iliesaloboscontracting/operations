import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { assertDateOpen } from "@/lib/dayLock";
import { isISODate } from "@/lib/dateRules";

// POST /api/jobs/copy { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// Copies every running job from one day to another so the target day ends up
// exactly as the source day was. A project+shift that already has a job on
// the target day is not duplicated - instead yesterday's crew/plant/vehicle
// assignments are merged into that existing job (skipping any resource
// that's already on it), so a job someone pre-created today still gets
// staffed the same way it was yesterday.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const { from, to } = await req.json();
  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }
  if (!isISODate(from) || !isISODate(to)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }
  // A closed day's allocations are frozen for costing - never copy into one.
  const locked = await assertDateOpen(to);
  if (locked) return locked;
  const fromStart = new Date(from);
  const fromEnd = new Date(fromStart);
  fromEnd.setUTCDate(fromEnd.getUTCDate() + 1);
  const toStart = new Date(to);
  const toEnd = new Date(toStart);
  toEnd.setUTCDate(toEnd.getUTCDate() + 1);

  const source = await prisma.job.findMany({
    // Only jobs for projects that are still running carry over - an INACTIVE
    // or COMPLETED project's job shouldn't reappear on the next day. Jobs
    // with no project (one-offs) still copy.
    where: {
      date: { gte: fromStart, lt: fromEnd },
      notRunning: false,
      OR: [{ projectId: null }, { project: { status: "ACTIVE" } }],
    },
    include: { assignments: true },
    orderBy: { sortOrder: "asc" },
  });
  const existing = await prisma.job.findMany({
    where: { date: { gte: toStart, lt: toEnd } },
    include: { assignments: true },
  });
  const existingByKey = new Map(existing.map((j) => [`${j.projectId ?? j.title}|${j.shift}`, j]));

  let copied = 0;
  let merged = 0;
  for (const j of source) {
    const key = `${j.projectId ?? j.title}|${j.shift}`;
    const match = existingByKey.get(key);
    if (match) {
      const already = new Set(match.assignments.map((a) => a.resourceId));
      const toAdd = j.assignments.filter((a) => !already.has(a.resourceId));
      if (toAdd.length > 0) {
        await prisma.assignment.createMany({
          data: toAdd.map((a) => ({ jobId: match.id, resourceId: a.resourceId, role: a.role })),
        });
        merged++;
      }
      continue;
    }
    await prisma.job.create({
      data: {
        projectId: j.projectId,
        title: j.title,
        client: j.client,
        siteCode: j.siteCode,
        siteAddress: j.siteAddress,
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
  return NextResponse.json({ copied, merged });
});
