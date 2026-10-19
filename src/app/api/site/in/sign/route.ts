import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { jobLabel, openAttendance, openJob, readTicket, sydneyTime } from "@/lib/signin";

// POST /api/site/in/sign - a crew member signing in or out from their phone.
//   { ticket, jobId, action: "STATUS" | "IN" | "OUT", deviceId?,
//     resourceId? | hire?: { name, company } }
// The time is the server's, never the phone's. Poster sign-ins and sign-outs
// wait for the site supervisor to confirm (status TO_CONFIRM).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const ticket = readTicket(body.ticket);
  if (!ticket) return bad("That scan has expired - scan the code again.", 401);
  if (typeof body.jobId !== "string" || !ticket.jobIds.includes(body.jobId)) return bad("Pick the job you're on.");
  const job = await openJob(body.jobId);
  if (!job) return bad("That job isn't open for sign-in any more.");

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
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : null;
  const site = jobLabel(job);
  const open = await openAttendance(job.id, who);

  if (body.action === "STATUS") {
    return NextResponse.json({ signedIn: !!open, since: open ? sydneyTime(open.signInAt) : null, site });
  }

  const now = new Date();
  const toConfirm = ticket.method === "POSTER";
  const runBy = ticket.method === "SUPERVISOR_QR"
    ? (await prisma.siteLink.findUnique({ where: { id: ticket.linkId }, select: { resource: { select: { name: true } } } }))?.resource?.name ?? null
    : "Site poster";

  if (body.action === "IN") {
    if (open) return bad(`You're already signed in here since ${sydneyTime(open.signInAt)}.`, 409);
    const today = await prisma.siteAttendance.count({ where: { jobId: job.id } });
    if (today >= 300) return bad("Too many sign-ins on this job today - call the office.", 429);
    // Signed in at another site and moved here: that one ends now, and the
    // supervisor confirms it.
    const elsewhere = await prisma.siteAttendance.findMany({
      where: {
        jobId: { not: job.id },
        signOutAt: null,
        status: { not: "REJECTED" },
        ...(who.resourceId ? { resourceId: who.resourceId } : { resourceId: null, workerName: who.workerName, company: who.company }),
        signInAt: { gte: new Date(now.getTime() - 20 * 3_600_000) },
      },
      select: { id: true },
    });
    if (elsewhere.length) {
      await prisma.siteAttendance.updateMany({
        where: { id: { in: elsewhere.map((e) => e.id) } },
        data: { signOutAt: now, signOutMethod: "MOVED", status: "TO_CONFIRM" },
      });
    }
    const allocated = !!who.resourceId && job.assignments.some((a) => a.resource.id === who.resourceId);
    await prisma.siteAttendance.create({
      data: {
        jobId: job.id,
        date: job.date.toISOString().slice(0, 10),
        ...who,
        allocated,
        deviceId,
        signInAt: now,
        signInMethod: ticket.method,
        status: toConfirm ? "TO_CONFIRM" : "CONFIRMED",
        runBy,
      },
    });
    return NextResponse.json({
      ok: true,
      message: `Signed in at ${sydneyTime(now)} - ${site}.${toConfirm ? " Your supervisor will confirm it." : ""}`,
    });
  }

  if (body.action === "OUT") {
    if (!open) return bad("You're not signed in on this job.", 404);
    await prisma.siteAttendance.update({
      where: { id: open.id },
      data: { signOutAt: now, signOutMethod: ticket.method, ...(toConfirm ? { status: "TO_CONFIRM" } : {}) },
    });
    return NextResponse.json({ ok: true, message: `Signed out at ${sydneyTime(now)} - ${site}. See you next time.` });
  }
  return bad("Unknown request.");
});

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 60) : "");
