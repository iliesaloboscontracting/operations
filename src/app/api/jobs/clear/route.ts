import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/jobs/clear { date: "YYYY-MM-DD" }
// Resets every job on that date (running or not) back to a blank slate: unassigns
// every crew/plant/hire allocation and wipes each job's day brief. The jobs
// themselves - and everything else about them (times, site, shift) - are untouched.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;

  const { date } = await req.json().catch(() => ({}));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD is required" }, { status: 400 });
  }
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const dateFilter = { date: { gte: start, lt: end } };

  const [{ count: cleared }, { count: briefsCleared }] = await Promise.all([
    prisma.assignment.deleteMany({ where: { job: dateFilter } }),
    prisma.job.updateMany({ where: { ...dateFilter, dayBrief: { not: null } }, data: { dayBrief: null } }),
  ]);

  return NextResponse.json({ cleared, briefsCleared });
});
