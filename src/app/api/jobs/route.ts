import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";
import { sanitizeJobs } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";
import { todaySydney } from "@/lib/today";
import { checkJobDate } from "@/lib/dateRulesServer";
import { matchHireSignIns } from "@/lib/labourHireMatch";
import { logBoardEdit, siteName } from "@/lib/boardGuard/store";
import { jobsWithNoSignInWay } from "@/lib/signinAlerts";
import { reviveJob } from "@/lib/jobCancel";

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
    where: { date: { gte: date, lt: nextDay }, status: { not: "COMPLETED" }, cancelledAt: null }, // never a cancelled job (10 Nov 2026)
    orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      project: { select: { name: true, client: true, jobNo: true, address: true, regional: true } },
      assignments: {
        include: { resource: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  sanitizeJobs(jobs, user?.role ?? null);

  // Who signed in to fill each labour hire tile (lib/labourHireMatch.ts) -
  // names only, shown on the tile.
  const hireSignIns = await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, resourceId: null, status: { not: "REJECTED" } },
    select: { id: true, jobId: true, workerName: true, company: true, signInAt: true, status: true },
  });
  const filledBy = new Map<string, string>(); // assignment id -> "Name (Company)"
  for (const j of jobs) {
    const tiles = j.assignments.filter((a) => a.resource.type === "HIRE" && a.resource.category === "LABOUR");
    if (!tiles.length) continue;
    const mine = hireSignIns.filter((s) => s.jobId === j.id);
    matchHireSignIns(tiles.map((a) => ({ id: a.resource.id, name: a.resource.name })), mine).forEach((tile, attendanceId) => {
      const s = mine.find((x) => x.id === attendanceId)!;
      const a = tiles.find((x) => x.resource.id === tile.id)!;
      if (!filledBy.has(a.id)) filledBy.set(a.id, s.company ? `${s.workerName} (${s.company})` : s.workerName);
    });
  }

  // Fix 3 (2 Nov 2026): today's and later jobs with crew but no way to sign in (no supervisor link held by anyone
  // on it, no hand-over, no site poster) - the board shows a warning on the row.
  const dayStr = date.toISOString().slice(0, 10);
  const noWay = dayStr >= todaySydney() ? new Set((await jobsWithNoSignInWay(dayStr)).map((x) => x.jobId)) : new Set<string>();

  // JobDTO.date is documented (and used, e.g. in a <input type="date">) as YYYY-MM-DD.
  const out = jobs.map(({ project, ...j }) => ({
    ...j,
    assignments: j.assignments.map((a) => ({ ...a, signedInAs: filledBy.get(a.id) ?? null })),
    ...liveJobFields({ title: j.title, client: j.client, siteCode: j.siteCode, siteAddress: j.siteAddress, project }),
    regional: !!project?.regional, // the Regional badge on the board (2 Nov 2026)
    ...(noWay.has(j.id) ? { noSignInWay: true } : {}),
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
      select: { id: true, status: true, cancelledAt: true },
    });
    // Keep forever (10 Nov 2026): a cancelled job for the same project / day / shift is brought back with these
    // fields (the change kept in its history) - the one-job-per-slot rule still holds.
    if (existing?.cancelledAt) {
      const job = await reviveJob(existing.id, jobData(body), user, "Job added again (board)");
      const full = await prisma.job.findUniqueOrThrow({ where: { id: (job as { id: string }).id }, include: { assignments: { include: { resource: true } } } });
      await logBoardEdit(user, body.date, "JOB_ADD", `${siteName(full)} (brought back - it had been cancelled)`);
      sanitizeJobs([full], user?.role ?? null);
      return NextResponse.json(full, { status: 201 });
    }
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
    data: { projectId: body.projectId ?? null, ...jobData(body) },
    include: { assignments: { include: { resource: true } } },
  });

  await logBoardEdit(user, body.date, "JOB_ADD", siteName(job));
  sanitizeJobs([job], user?.role ?? null);
  return NextResponse.json(job, { status: 201 });
});

// The fields a new job is made with (and a cancelled one brought back with). CANCELLED is never a status to create with.
function jobData(body: Record<string, any>) {
  return {
    title: body.title,
    client: body.client ?? null,
    siteCode: body.siteCode ?? null,
    siteAddress: body.siteAddress ?? null,
    date: new Date(body.date),
    shift: body.shift ?? "DAY",
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    status: body.status && body.status !== "CANCELLED" ? body.status : "ACTIVE",
    dayBrief: body.dayBrief ?? null,
    dateCheckNote: typeof body.dateCheckNote === "string" && body.dateCheckNote.trim() ? body.dateCheckNote.trim() : null,
    colorTag: body.colorTag ?? (body.shift === "NIGHT" ? "purple" : "orange"),
    notRunning: body.notRunning ?? false,
    sortOrder: body.sortOrder ?? 50,
  };
}
