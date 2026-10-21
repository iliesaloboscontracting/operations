import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { attendanceForDate } from "@/lib/attendanceView";
import { todaySydney } from "@/lib/today";
import { parseTime } from "@/lib/signin";
import { lockedWeekFor } from "@/lib/timesheets";
import { syncSignInActualsQuietly } from "@/lib/signInActuals";

// GET /api/attendance?date=YYYY-MM-DD -> that date's jobs with sign-ins,
// hours, no-shows and flags; plus the active site posters and hand-overs.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("date");
  const date = q && isISODate(q) ? q : todaySydney();
  const [view, posters, handovers] = await Promise.all([
    attendanceForDate(date),
    prisma.siteLink.findMany({
      where: { kind: "POSTER", revokedAt: null },
      select: { id: true, projectId: true, place: true, resourceId: true, createdAt: true, createdBy: true },
    }),
    prisma.siteLink.findMany({
      where: { kind: "HANDOVER", revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, jobId: true, expiresAt: true, createdBy: true, resource: { select: { name: true } } },
    }),
  ]);
  return NextResponse.json({ date, today: todaySydney(), jobs: view.jobs, points: view.points, posters, handovers });
});

// POST /api/attendance - the office adds a sign-in that was missed.
//   { jobId | place: "OFFICE" | "YARD" | "VEHICLE" (+ vehicleId), resourceId | hire: { name, company },
//     signInAt, signOutAt?, reason }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3) return bad("Say why it's being added.");
  const signInAt = parseTime(body.signInAt);
  const job = typeof body.jobId === "string"
    ? await prisma.job.findUnique({ where: { id: body.jobId }, select: { id: true, date: true, assignments: { select: { resourceId: true } } } })
    : null;
  // Or an office / yard / truck sign-in.
  let point: { place: string; vehicleId: string | null; placeLabel: string } | null = null;
  if (!job && (body.place === "OFFICE" || body.place === "YARD")) point = { place: body.place, vehicleId: null, placeLabel: body.place === "OFFICE" ? "Office" : "Yard" };
  if (!job && body.place === "VEHICLE") {
    const truck = typeof body.vehicleId === "string" ? await prisma.resource.findUnique({ where: { id: body.vehicleId }, select: { id: true, name: true, type: true } }) : null;
    if (!truck || truck.type !== "VEHICLE") return bad("Pick the truck.");
    point = { place: "VEHICLE", vehicleId: truck.id, placeLabel: truck.name };
  }
  if (!job && !point) return bad("Pick the job, or the office / yard / truck.");
  const signOutAt = body.signOutAt ? parseTime(body.signOutAt) : null;
  if (!signInAt) return bad("Enter the sign-in time.");
  if (body.signOutAt && !signOutAt) return bad("The sign-out time isn't valid.");
  if (signOutAt && signOutAt <= signInAt) return bad("Sign-out must be after sign-in.");

  let who: { resourceId: string | null; workerName: string; company: string | null };
  if (typeof body.resourceId === "string" && body.resourceId) {
    const p = await prisma.resource.findUnique({ where: { id: body.resourceId }, select: { id: true, name: true, type: true } });
    if (!p || p.type !== "PERSONNEL") return bad("Pick someone from the Personnel register.");
    who = { resourceId: p.id, workerName: p.name, company: null };
  } else {
    const name = String(body.hire?.name ?? "").trim().slice(0, 60), company = String(body.hire?.company ?? "").trim().slice(0, 60);
    if (name.length < 2 || company.length < 2) return bad("Enter the worker's name and company.");
    who = { resourceId: null, workerName: name, company };
  }
  const date = job ? job.date.toISOString().slice(0, 10) : sydneyDate(signInAt);
  if (await lockedWeekFor(date)) return bad("That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its sign-ins can change.");
  const by = user?.name ?? "Office";
  const created = await prisma.siteAttendance.create({
    data: {
      jobId: job?.id ?? null,
      ...(point ?? {}),
      date,
      ...who,
      allocated: job ? !!who.resourceId && job.assignments.some((a) => a.resourceId === who.resourceId) : true,
      signInAt,
      signInMethod: "OFFICE",
      signOutAt,
      signOutMethod: signOutAt ? "OFFICE" : null,
      status: "CONFIRMED",
      confirmedBy: by,
      confirmedAt: new Date(),
      runBy: by,
      edits: { create: { field: "added", before: null, after: `${signInAt.toISOString()} - ${signOutAt?.toISOString() ?? "open"}`, reason, editedBy: by } },
    },
  });
  await syncSignInActualsQuietly([created.jobId]);
  return NextResponse.json({ id: created.id }, { status: 201 });
});

const sydneyDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
