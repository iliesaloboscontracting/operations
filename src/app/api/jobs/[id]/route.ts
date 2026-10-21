import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";
import { sanitizeJobs } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";
import { checkJobDate } from "@/lib/dateRulesServer";

// PATCH /api/jobs/:id -> update job fields
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  const current = await prisma.job.findUnique({
    where: { id: params.id },
    select: { date: true, projectId: true, shift: true },
  });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const currentLocked = await assertDateOpen(current.date.toISOString().slice(0, 10));
  if (currentLocked) return currentLocked;
  if ("date" in body) {
    const targetLocked = await assertDateOpen(body.date);
    if (targetLocked) return targetLocked;
    // Moving a job to a new day gets the same date checks as creating one.
    if (body.date !== current.date.toISOString().slice(0, 10)) {
      const dateProblem = await checkJobDate(body.date, current.projectId, body.dateCheckNote);
      if (dateProblem) return dateProblem;
    }
  }

  // Moving a job's date/shift can collide with an existing job for the same
  // project the same way creating a brand new one can (see POST /api/jobs
  // and the @@unique on Job in schema.prisma) - checked explicitly here too,
  // so the error explains what happened instead of falling through to a
  // generic "That already exists".
  if (current.projectId && ("date" in body || "shift" in body)) {
    const targetDate = "date" in body ? new Date(body.date) : current.date;
    const targetShift = "shift" in body ? body.shift : current.shift;
    const conflict = await prisma.job.findFirst({
      where: { projectId: current.projectId, date: targetDate, shift: targetShift, id: { not: params.id } },
      select: { status: true },
    });
    if (conflict) {
      return NextResponse.json(
        {
          error:
            conflict.status === "COMPLETED"
              ? "This project already has a completed job for that date and shift - reopen it from the Completed page instead."
              : "This project already has a job for that date and shift - edit that one instead, or change this job's project first.",
        },
        { status: 409 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  for (const key of [
    "title",
    "client",
    "siteCode",
    "siteAddress",
    "shift",
    "startTime",
    "endTime",
    "status",
    "dayBrief",
    "colorTag",
    "notRunning",
    "sortOrder",
  ]) {
    if (key in body) data[key] = body[key];
  }
  if ("date" in body) data.date = new Date(body.date);
  if (typeof body.dateCheckNote === "string" && body.dateCheckNote.trim()) data.dateCheckNote = body.dateCheckNote.trim();

  const job = await prisma.job.update({
    where: { id: params.id },
    data,
    include: {
      project: { select: { name: true, client: true, jobNo: true, address: true } },
      assignments: { include: { resource: true } },
    },
  });
  const { project, ...rest } = job;
  sanitizeJobs([rest], user?.role ?? null);

  return NextResponse.json({
    ...rest,
    ...liveJobFields({ title: job.title, client: job.client, siteCode: job.siteCode, siteAddress: job.siteAddress, project }),
  });
});

// DELETE /api/jobs/:id
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const current = await prisma.job.findUnique({ where: { id: params.id }, select: { date: true } });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(current.date.toISOString().slice(0, 10));
  if (locked) return locked;
  // Sign-ins are the timesheet record (21 Oct 2026) - deleting the job would
  // take them with it, so a job anyone signed in to can only be stood down.
  const signIns = await prisma.siteAttendance.count({ where: { jobId: params.id } });
  if (signIns > 0) {
    return NextResponse.json(
      { error: `${signIns} sign-in${signIns === 1 ? " is" : "s are"} recorded on this job, so it can't be deleted - mark it Stood down instead.` },
      { status: 409 }
    );
  }
  await prisma.job.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
