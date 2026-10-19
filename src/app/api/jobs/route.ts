import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";
import { sanitizeJobs } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";
import { todaySydney } from "@/lib/today";
import { checkJobDate } from "@/lib/dateRulesServer";

// GET /api/jobs?date=YYYY-MM-DD  -> jobs for that date, with assignments+resource included
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const dateParam = req.nextUrl.searchParams.get("date");
  // Dates are calendar days stored as UTC midnight (YYYY-MM-DD).
  // No date given = Sydney's today, not the server's UTC day.
  const date = new Date(dateParam ?? todaySydney());
  date.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const jobs = await prisma.job.findMany({
    // Completed jobs come off the board entirely - see /completed.
    where: { date: { gte: date, lt: nextDay }, status: { not: "COMPLETED" } },
    orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      project: { select: { name: true, client: true, jobNo: true, address: true } },
      assignments: {
        include: { resource: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  sanitizeJobs(jobs, user?.role ?? null);

  // JobDTO.date is documented (and used, e.g. in a <input type="date">) as YYYY-MM-DD.
  const out = jobs.map(({ project, ...j }) => ({
    ...j,
    ...liveJobFields({ title: j.title, client: j.client, siteCode: j.siteCode, siteAddress: j.siteAddress, project }),
    date: j.date.toISOString().slice(0, 10),
  }));
  return NextResponse.json(out);
});

// POST /api/jobs -> create a new job (optionally from a project)
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  if (!body.title || !body.date) {
    return NextResponse.json(
      { error: "title and date are required" },
      { status: 400 }
    );
  }

  const dateLocked = await assertDateOpen(body.date);
  if (dateLocked) return dateLocked;

  // A stood-down placeholder isn't a working day, so only running jobs get
  // the soft date warnings - the format check still applies to both.
  const dateProblem = await checkJobDate(
    body.date,
    body.projectId,
    body.notRunning ? "stood down" : body.dateCheckNote
  );
  if (dateProblem) return dateProblem;

  // One job per project per date+shift (see the @@unique on Job in
  // schema.prisma for why) - checked explicitly here so the error actually
  // explains what happened, rather than falling through to the constraint
  // itself and a generic "That already exists".
  if (body.projectId) {
    const existing = await prisma.job.findFirst({
      where: { projectId: body.projectId, date: new Date(body.date), shift: body.shift ?? "DAY" },
      select: { id: true, status: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          error:
            existing.status === "COMPLETED"
              ? "This project already has a completed job for that date and shift - reopen it from the Completed page instead of creating a new one."
              : "This project already has a job for that date and shift.",
        },
        { status: 409 }
      );
    }
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
      dateCheckNote: typeof body.dateCheckNote === "string" && body.dateCheckNote.trim() ? body.dateCheckNote.trim() : null,
      colorTag: body.colorTag ?? (body.shift === "NIGHT" ? "purple" : "orange"),
      notRunning: body.notRunning ?? false,
      sortOrder: body.sortOrder ?? 50,
    },
    include: { assignments: { include: { resource: true } } },
  });

  sanitizeJobs([job], user?.role ?? null);
  return NextResponse.json(job, { status: 201 });
});
