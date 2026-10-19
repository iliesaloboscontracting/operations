import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { pickProject } from "@/lib/pickProject";
import { withErrorHandling } from "@/lib/apiHandler";
import { addDays } from "@/lib/dates";
import { todaySydney } from "@/lib/today";
import { completeness } from "@/lib/projectFile";
import { validateProjectFile } from "@/lib/projectFileServer";
import { boardDatesByProject, dateExceptions } from "@/lib/dateExceptions";

// GET /api/projects?date=YYYY-MM-DD&archived=1
// Each project comes with today's assigned counts (crew / plant / attachments / trucks / hire),
// and how much of its Project File is filled in (lib/projectFile.ts).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  // Cost-to-date and the contract value are financial figures - Phase 2b:
  // this route was Viewer-accessible and returning both unfiltered, the
  // same class of leak Phase 1 closed on every other route.
  const user = await getCurrentUser();
  const canSeeMoney = user?.role === "ADMIN" || user?.role === "MANAGER";
  const dateParam = req.nextUrl.searchParams.get("date");
  const archived = req.nextUrl.searchParams.get("archived") === "1";
  // No date given = Sydney's today, not the server's UTC day.
  const start = new Date(dateParam ?? todaySydney());
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  // "Cost to date" is a running total, so it's worked out against the real
  // calendar day (Sydney's, not the server's UTC day), independent of
  // whichever date the caller is browsing.
  const todaySyd = todaySydney();
  const todayEnd = new Date(addDays(todaySyd, 1) + "T00:00:00.000Z");

  const boardDates = await boardDatesByProject(todaySyd);
  const projects = await prisma.project.findMany({
    where: { archived },
    orderBy: { name: "asc" },
    include: {
      jobs: {
        where: { date: { gte: start, lt: end }, notRunning: false },
        include: { assignments: { include: { resource: { select: { type: true, category: true } } } } },
      },
      _count: { select: { jobs: true, contacts: { where: { visibleTo: "CREW" } } } },
    },
  });

  const out = await Promise.all(
    projects.map(async ({ jobs, _count, ...p }) => {
      const counts = { crew: 0, plant: 0, attach: 0, trucks: 0, hire: 0 };
      for (const j of jobs)
        for (const a of j.assignments) {
          const r = a.resource;
          if (r.type === "PERSONNEL" || (r.type === "HIRE" && r.category === "LABOUR")) counts.crew++;
          else if (r.type === "EQUIPMENT") counts.plant++;
          else if (r.type === "ATTACHMENT") counts.attach++;
          else if (r.type === "VEHICLE") counts.trucks++;
          else counts.hire++;
        }

      let costToDate: number | undefined;
      if (canSeeMoney && _count.jobs > 0) {
        const elapsed = await prisma.job.findMany({
          where: { projectId: p.id, notRunning: false, date: { lt: todayEnd } },
          include: { assignments: { include: { resource: { select: { dailyRateExGst: true } } } } },
        });
        const spend = elapsed.reduce(
          (n, j) => n + j.assignments.reduce((m, a) => m + (a.resource.dailyRateExGst ?? 0), 0),
          0
        );
        if (spend > 0) costToDate = spend;
      }

      const out: Record<string, unknown> = {
        ...p,
        counts,
        costToDate,
        completeness: completeness(p, _count.contacts),
        firstJobDate: boardDates.get(p.id)?.firstJobDate ?? null,
        lastJobDate: boardDates.get(p.id)?.lastJobDate ?? null,
        predatesBoard: boardDates.get(p.id)?.predatesBoard ?? false,
        dateExceptions: dateExceptions(p, boardDates.get(p.id), todaySyd),
      };
      if (!canSeeMoney) {
        delete out.contractValue;
        delete out.contractValueNotes;
      }
      return out;
    })
  );
  return NextResponse.json(out);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const data = pickProject(body);
  const invalid = await validateProjectFile(data);
  if (invalid) return invalid;
  const project = await prisma.project.create({ data: data as any });
  return NextResponse.json(project, { status: 201 });
});
