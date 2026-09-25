import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";

// GET /api/jobs?date=YYYY-MM-DD  -> jobs for that date, with assignments+resource included
export async function GET(req: NextRequest) {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const dateParam = req.nextUrl.searchParams.get("date");
  // Dates are calendar days stored as UTC midnight (YYYY-MM-DD).
  const date = dateParam ? new Date(dateParam) : new Date();
  date.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const jobs = await prisma.job.findMany({
    // Completed jobs come off the board entirely - see /completed.
    where: { date: { gte: date, lt: nextDay }, status: { not: "COMPLETED" } },
    orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      assignments: {
        include: { resource: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  // JobDTO.date is documented (and used, e.g. in a <input type="date">) as YYYY-MM-DD.
  const out = jobs.map((j) => ({ ...j, date: j.date.toISOString().slice(0, 10) }));
  return NextResponse.json(out);
}

// POST /api/jobs -> create a new job (optionally from a project)
export async function POST(req: NextRequest) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();

  if (!body.title || !body.date) {
    return NextResponse.json(
      { error: "title and date are required" },
      { status: 400 }
    );
  }

  const job = await prisma.job.create({
    data: {
      projectId: body.projectId ?? null,
      title: body.title,
      client: body.client ?? null,
      siteCode: body.siteCode ?? null,
      siteAddress: body.siteAddress ?? null,
      date: new Date(body.date),
      shift: body.shift ?? "DAY",
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      status: body.status ?? "ACTIVE",
      dayBrief: body.dayBrief ?? null,
      colorTag: body.colorTag ?? (body.shift === "NIGHT" ? "purple" : "orange"),
      notRunning: body.notRunning ?? false,
      sortOrder: body.sortOrder ?? 50,
    },
    include: { assignments: { include: { resource: true } } },
  });

  return NextResponse.json(job, { status: 201 });
}
