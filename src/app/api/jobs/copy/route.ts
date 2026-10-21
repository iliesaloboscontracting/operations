import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { assertDateOpen } from "@/lib/dayLock";
import { isISODate } from "@/lib/dateRules";
import { QUICK_LABOUR_HIRE_NAME, nextQuickLabourHireNumber } from "@/lib/resource";

// POST /api/jobs/copy { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// Copies every running job from one day to another so the target day ends up
// exactly as the source day was. A project+shift that already has a job on
// the target day is not duplicated - instead yesterday's crew/plant/vehicle
// assignments are merged into that existing job (skipping any resource
// that's already on it), so a job someone pre-created today still gets
// staffed the same way it was yesterday.
//
// Never double-books (21 Oct 2026): anyone / anything already booked on
// another job that day and shift - planned ahead, or placed earlier in this
// same copy - is skipped and reported back, instead of landing on two jobs.
//
// Labour hire tiles are numbered per day (21 Oct 2026): copied tiles take the
// lowest numbers free on the target day (1, 2, 3...), so the count restarts
// each day. A tile already carrying that number moves across as it is;
// otherwise a spare tile with that number (one not on the target day) is
// reused, or a new one made.
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
    include: { assignments: { include: { resource: { select: { name: true, type: true, category: true } } } } },
    orderBy: { sortOrder: "asc" },
  });
  const existing = await prisma.job.findMany({
    where: { date: { gte: toStart, lt: toEnd } },
    include: { assignments: { include: { resource: { select: { name: true, type: true, category: true } } } }, project: { select: { name: true } } },
  });
  type Res = { name: string; type: string; category: string | null };
  const tileNo = (r: Res) => (r.type === "HIRE" && r.category === "LABOUR" ? Number(QUICK_LABOUR_HIRE_NAME.exec(r.name)?.[1] ?? NaN) : NaN);
  // Labour hire numbers already on the target day -> which tile has it.
  const tileOnDay = new Map<number, string>();
  for (const e of existing) for (const a of e.assignments) if (!Number.isNaN(tileNo(a.resource))) tileOnDay.set(tileNo(a.resource), a.resourceId);
  const renumber = async <A extends { resourceId: string; role: string | null; resource: Res }>(list: A[]) => {
    const out: { resourceId: string; role: string | null }[] = [];
    for (const a of list) {
      const n = tileNo(a.resource);
      if (Number.isNaN(n)) {
        out.push({ resourceId: a.resourceId, role: a.role });
        continue;
      }
      const k = nextQuickLabourHireNumber(tileOnDay.keys());
      const tileId =
        n === k
          ? a.resourceId
          : ((await prisma.resource.findFirst({
              where: {
                type: "HIRE", category: "LABOUR", active: true, name: `Labour hire ${k}`,
                assignments: { none: { job: { date: { gte: toStart, lt: toEnd } } } },
              },
              select: { id: true },
            })) ?? (await prisma.resource.create({ data: { name: `Labour hire ${k}`, type: "HIRE", category: "LABOUR", ownership: "HIRED" } }))).id;
      tileOnDay.set(k, tileId);
      out.push({ resourceId: tileId, role: a.role });
    }
    return out;
  };
  // Who's already booked on the target day, per shift -> which job.
  const booked = new Map<string, string>();
  for (const e of existing) {
    for (const a of e.assignments) booked.set(`${a.resourceId}|${e.shift}`, e.project?.name ?? e.title);
  }
  const skipped: { name: string; on: string }[] = [];
  // Keep only what isn't already booked elsewhere that shift; book what's kept.
  const free = <A extends { resourceId: string; resource: { name: string } }>(list: A[], shift: string, jobName: string) =>
    list.filter((a) => {
      const key = `${a.resourceId}|${shift}`;
      const on = booked.get(key);
      if (on && on !== jobName) {
        skipped.push({ name: a.resource.name, on });
        return false;
      }
      booked.set(key, jobName);
      return true;
    });
  const existingByKey = new Map(existing.map((j) => [`${j.projectId ?? j.title}|${j.shift}`, j]));

  let copied = 0;
  let merged = 0;
  for (const j of source) {
    const key = `${j.projectId ?? j.title}|${j.shift}`;
    const match = existingByKey.get(key);
    if (match) {
      const already = new Set(match.assignments.map((a) => a.resourceId));
      const matchName = match.project?.name ?? match.title;
      const toAdd = free(j.assignments.filter((a) => !already.has(a.resourceId)), j.shift, matchName);
      if (toAdd.length > 0) {
        await prisma.assignment.createMany({
          data: (await renumber(toAdd)).map((a) => ({ jobId: match.id, resourceId: a.resourceId, role: a.role })),
        });
        merged++;
      }
      continue;
    }
    const keep = await renumber(free(j.assignments, j.shift, j.title));
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
          create: keep.map((a) => ({ resourceId: a.resourceId, role: a.role })),
        },
      },
    });
    copied++;
  }
  return NextResponse.json({ copied, merged, skipped });
});
