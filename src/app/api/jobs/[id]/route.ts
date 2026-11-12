import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";
import { sanitizeJobs } from "@/lib/serializeResource";
import { assertDateOpen } from "@/lib/dayLock";
import { checkJobDate } from "@/lib/dateRulesServer";
import { isoDay, logBoardEdit, siteName } from "@/lib/boardGuard/store";
import { updateTracked } from "@/lib/history/store";
import { cancelJob } from "@/lib/jobCancel";
import { checkBoardDay, recordOverride } from "@/lib/dayLimit/store";

const JOB_INCLUDE = {
  project: { select: { name: true, client: true, jobNo: true, address: true } },
  assignments: { include: { resource: true } },
} as const;
const loadJob = (id: string) => prisma.job.findUniqueOrThrow({ where: { id }, include: JOB_INCLUDE });

// PATCH /api/jobs/:id -> update job fields
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  const current = await prisma.job.findUnique({
    where: { id: params.id },
    select: { date: true, projectId: true, shift: true, cancelledAt: true },
  });
  if (!current || current.cancelledAt) return NextResponse.json({ error: "not found" }, { status: 404 });
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
      select: { status: true, cancelledAt: true },
    });
    if (conflict) {
      return NextResponse.json(
        {
          error:
            conflict.cancelledAt
              ? "A cancelled job for this project is kept on that date and shift - add a job there from the board to bring it back, or pick another day."
              : conflict.status === "COMPLETED"
              ? "This project already has a completed job for that date and shift - reopen it from the Completed page instead."
              : "This project already has a job for that date and shift - edit that one instead, or change this job's project first.",
        },
        { status: 409 }
      );
    }
  }

  // Days-a-week limit (12 Nov 2026, lib/dayLimit): moving a job to another day moves its crew - anyone it would take over
  // their limit that week is refused (409) unless an Admin goes over it with { overrideReason } (kept in the history).
  let limitOverride: string | null = null;
  if ("date" in body && body.date !== isoDay(current.date)) {
    const crew = await prisma.assignment.findMany({ where: { jobId: params.id, resource: { type: "PERSONNEL", maxDaysPerWeek: { not: null } } }, select: { resource: { select: { id: true, name: true, type: true, maxDaysPerWeek: true } } } });
    const limit = await checkBoardDay(crew.map((c) => c.resource), body.date, user?.role, body, { jobId: params.id });
    if (!limit.ok) return NextResponse.json(limit.body, { status: limit.status });
    limitOverride = limit.override;
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
  // Cancelling is its own action (DELETE, with a reason) - never through an edit.
  if (data.status === "CANCELLED") return NextResponse.json({ error: "Use Cancel job to cancel it." }, { status: 400 });
  if ("date" in body) data.date = new Date(body.date);
  if (typeof body.dateCheckNote === "string" && body.dateCheckNote.trim()) data.dateCheckNote = body.dateCheckNote.trim();

  // Every field that changed is kept in the job's history (keep forever, 10 Nov 2026), in the same transaction.
  const job = await updateTracked<Awaited<ReturnType<typeof loadJob>> & object>("Job", params.id, data, { by: user, source: "Job edit (board)" }, {
    include: JOB_INCLUDE,
  });
  // Field names only (a day brief's words stay out of the history); a job moved to another day is noted on both days.
  const fields = Object.keys(data).filter((k) => k !== "dateCheckNote");
  const note = `${siteName(job)}: ${fields.join(", ") || "saved"}`;
  for (const d of new Set([isoDay(current.date), isoDay(job.date)])) await logBoardEdit(user, d, "JOB_EDIT", note);
  if (limitOverride && user) await recordOverride(prisma, user, isoDay(job.date), limitOverride);
  const { project, ...rest } = job;
  sanitizeJobs([rest], user?.role ?? null);

  return NextResponse.json({
    ...rest,
    ...liveJobFields({ title: job.title, client: job.client, siteCode: job.siteCode, siteAddress: job.siteAddress, project }),
  });
});

// DELETE /api/jobs/:id { reason } -> CANCEL the job (keep forever, Ilies 10 Nov 2026): it is kept, hidden from the
// board and every list and total, its allocations taken off with a full snapshot (lib/jobCancel.ts). A reason is needed.
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const current = await prisma.job.findUnique({ where: { id: params.id }, select: { date: true, cancelledAt: true } });
  if (!current || current.cancelledAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locked = await assertDateOpen(current.date.toISOString().slice(0, 10));
  if (locked) return locked;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const out = await cancelJob(params.id, { id: user.id, name: user.name }, reason);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, cancelled: true });
});
