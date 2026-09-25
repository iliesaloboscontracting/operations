import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { CalendarJobDTO } from "@/lib/types";
import { withErrorHandling } from "@/lib/apiHandler";

// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD -> every job in the range, with staffing summary
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const ok = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(from) || !ok(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }

  const jobs = await prisma.job.findMany({
    // Completed jobs live on the Completed page only - the calendar is for what's
    // coming up and currently running (active or inactive), never finished work.
    where: {
      date: { gte: new Date(from!), lt: new Date(addDays(to!, 1)) },
      status: { not: "COMPLETED" },
    },
    orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
    include: { assignments: { include: { resource: true } } },
  });

  const out: CalendarJobDTO[] = jobs.map((j) => {
    const people: string[] = [];
    const plantNames: string[] = [];
    const hireNames: string[] = [];
    const crewList: CalendarJobDTO["crewList"] = [];
    const plantList: CalendarJobDTO["plantList"] = [];
    const hireList: CalendarJobDTO["hireList"] = [];
    let hasSupervisor = false;
    for (const a of j.assignments) {
      const r = a.resource;
      if (r.type === "PERSONNEL" || (r.type === "HIRE" && r.category === "LABOUR")) {
        people.push(r.name);
        crewList.push({ name: r.name, role: a.role });
        if (a.role === "Supervisor" || a.role === "Lead") hasSupervisor = true;
      } else if (r.type === "HIRE") {
        hireNames.push(r.name);
        hireList.push({ name: r.name, agency: r.agency });
      } else {
        plantNames.push(r.name);
        plantList.push({ name: r.name, type: r.type });
      }
    }
    return {
      id: j.id,
      projectId: j.projectId,
      title: j.title,
      siteCode: j.siteCode,
      date: j.date.toISOString().slice(0, 10),
      shift: j.shift as "DAY" | "NIGHT",
      startTime: j.startTime,
      endTime: j.endTime,
      dayBrief: j.dayBrief,
      notRunning: j.notRunning,
      crew: people.length,
      plant: plantNames.length,
      hire: hireNames.length,
      hasSupervisor,
      people,
      plantNames,
      hireNames,
      crewList,
      plantList,
      hireList,
    };
  });

  return NextResponse.json(out);
});
