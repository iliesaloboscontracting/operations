import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { nameWithoutAmounts } from "@/lib/dailyLog/money";
import { jobLabel, makeOdometerToken, openJob, pointOf, readTicket, sydneyTime, takesSignIns } from "@/lib/signin";
import { todaySydney } from "@/lib/today";
import { syncSignInActualsQuietly } from "@/lib/signInActuals";
import { parseGps } from "@/lib/payroll/rules";

// POST /api/site/in/sign - someone signing in or out from their phone.
//   { ticket, jobId, action: "STATUS" | "IN" | "OUT", deviceId?,
//     resourceId? | hire?: { name, company } }
// For an office / yard / truck QR, "jobId" is the point (the ticket's link).
// The time is the server's, never the phone's. Site poster sign-ins and
// sign-outs wait for the site supervisor to confirm (TO_CONFIRM); office,
// yard and truck sign-ins count straight away (Ilies, 20 Oct 2026) - odd ones
// are flagged on the Sign-ins page instead.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const ticket = readTicket(body.ticket);
  if (!ticket) return bad("That scan has expired - scan the code again.", 401);
  if (typeof body.jobId !== "string" || !ticket.jobIds.includes(body.jobId)) return bad("Pick where you're signing in.");

  // Where: a job on the board, or a sign-in point.
  let where: {
    jobId: string | null;
    place: string | null;
    vehicleId: string | null;
    label: string;
    date: string;
    allocatedIds: string[] | null; // null = everyone counts as allocated (points)
    projectId: string | null;
  };
  if (ticket.method === "POINT") {
    const link = await prisma.siteLink.findUnique({
      where: { id: ticket.linkId },
      select: { id: true, place: true, revokedAt: true, resource: { select: { id: true, name: true } } },
    });
    const point = link && !link.revokedAt ? pointOf(link) : null;
    if (!point) return bad("This sign-in QR isn't active any more.");
    where = { jobId: null, place: point.place, vehicleId: point.vehicleId, label: point.label, date: todaySydney(), allocatedIds: null, projectId: null };
  } else {
    const job = await openJob(body.jobId);
    if (!job) return bad("That job isn't open for sign-in any more.");
    // An earlier job kept open only so people still on it can sign out.
    if (body.action === "IN" && !takesSignIns(job)) return bad("That shift has finished - sign in to today's job.");
    where = {
      jobId: job.id, place: null, vehicleId: null, label: jobLabel(job),
      date: job.date.toISOString().slice(0, 10), allocatedIds: job.assignments.map((a) => a.resource.id), projectId: job.project?.id ?? null,
    };
  }

  // Who: someone from the Personnel register, or a hire / subcontractor
  // worker giving their name and company.
  let who: { resourceId: string | null; workerName: string; company: string | null };
  if (typeof body.resourceId === "string" && body.resourceId) {
    const p = await prisma.resource.findUnique({ where: { id: body.resourceId }, select: { id: true, name: true, type: true } });
    if (!p || p.type !== "PERSONNEL") return bad("Pick your name again.");
    who = { resourceId: p.id, workerName: p.name, company: null };
  } else {
    const name = clean(body.hire?.name), company = clean(body.hire?.company);
    if (name.length < 2 || company.length < 2) return bad("Enter your full name and the company you're from.");
    who = { resourceId: null, workerName: name, company };
  }
  const whoWhere = who.resourceId ? { resourceId: who.resourceId } : { resourceId: null, workerName: who.workerName, company: who.company };
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : null;
  const now = new Date();
  const recent = { gte: new Date(now.getTime() - 20 * 3_600_000) };
  // Their open sign-in here: same job, or same point (and same truck).
  const hereWhere = where.jobId ? { jobId: where.jobId } : { jobId: null, place: where.place, vehicleId: where.vehicleId, signInAt: recent };
  let open = await prisma.siteAttendance.findFirst({
    where: { ...hereWhere, ...whoWhere, signOutAt: null, status: { not: "REJECTED" } },
    orderBy: { signInAt: "desc" },
  });
  // Signing out the next morning from the site poster, they may pick today's
  // job: find their sign-in from last night at the same site (21 Oct 2026).
  // Not for signing in - a forgotten sign-out mustn't block a new day.
  if (!open && body.action !== "IN" && where.projectId) {
    open = await prisma.siteAttendance.findFirst({
      where: { job: { projectId: where.projectId }, ...whoWhere, signOutAt: null, status: { not: "REJECTED" }, signInAt: recent },
      orderBy: { signInAt: "desc" },
    });
  }

  if (body.action === "STATUS") {
    return NextResponse.json({ signedIn: !!open, since: open ? sydneyTime(open.signInAt) : null, site: where.label });
  }

  const toConfirm = ticket.method === "POSTER";
  const runBy =
    ticket.method === "SUPERVISOR_QR"
      ? (await prisma.siteLink.findUnique({ where: { id: ticket.linkId }, select: { resource: { select: { name: true } } } }))?.resource?.name ?? null
      : ticket.method === "POSTER" ? "Site poster" : `${where.label} QR`;

  if (body.action === "IN") {
    if (open) return bad(`You're already signed in here since ${sydneyTime(open.signInAt)}.`, 409);
    const sinceMidnight = await prisma.siteAttendance.count({ where: { ...(where.jobId ? { jobId: where.jobId } : { place: where.place, vehicleId: where.vehicleId, date: where.date }) } });
    if (sinceMidnight >= 300) return bad("Too many sign-ins here today - call the office.", 429);
    // Signed in somewhere else (another site, another truck) and moved here:
    // that one ends now. A site one goes to its supervisor to confirm.
    const elsewhere = await prisma.siteAttendance.findMany({
      where: { ...whoWhere, signOutAt: null, status: { not: "REJECTED" }, signInAt: recent, NOT: hereWhere },
      select: { id: true, jobId: true },
    });
    for (const e of elsewhere) {
      await prisma.siteAttendance.update({
        where: { id: e.id },
        data: { signOutAt: now, signOutMethod: "MOVED", ...(e.jobId ? { status: "TO_CONFIRM" } : {}) },
      });
    }
    const signedIn = await prisma.siteAttendance.create({
      data: {
        jobId: where.jobId,
        place: where.place,
        vehicleId: where.vehicleId,
        placeLabel: where.place ? where.label : null,
        date: where.date,
        ...who,
        allocated: where.allocatedIds ? !!who.resourceId && where.allocatedIds.includes(who.resourceId) : true,
        deviceId,
        signInAt: now,
        signInMethod: ticket.method,
        status: toConfirm ? "TO_CONFIRM" : "CONFIRMED",
        runBy,
        // Accounts stage 2 (Ilies: GPS "with sign in", never tracked): where the phone was at this moment
        // only, if it said. Missing / refused never stops a sign-in. Accounts / Admin see it; nobody else.
        ...parseGps(body.gps),
      },
    });
    // Anywhere they were just moved off now has their hours.
    await syncSignInActualsQuietly(elsewhere.map((e) => e.jobId));
    return NextResponse.json({
      ok: true,
      message: `Signed in at ${sydneyTime(now)} - ${where.label}.${toConfirm ? " Your supervisor will confirm it." : ""}`,
      // On a truck: the next screen asks for an odometer photo (Receipts R1).
      ...(where.place === "VEHICLE" ? { odometer: makeOdometerToken(signedIn.id) } : {}),
    });
  }

  if (body.action === "OUT") {
    if (!open) return bad("You're not signed in here.", 404);
    await prisma.siteAttendance.update({
      where: { id: open.id },
      data: { signOutAt: now, signOutMethod: ticket.method, ...(toConfirm ? { status: "TO_CONFIRM" } : {}) },
    });
    await syncSignInActualsQuietly([open.jobId]);
    return NextResponse.json({ ok: true, message: `Signed out at ${sydneyTime(now)} - ${where.label}. See you next time.` });
  }
  return bad("Unknown request.");
});

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
// A hire worker's typed name / company: never an amount in it (SEC-010) - it's shown on the log screen and the report.
const clean = (v: unknown) => (typeof v === "string" ? nameWithoutAmounts(v.replace(/\s+/g, " ").trim()).slice(0, 60) : "");
