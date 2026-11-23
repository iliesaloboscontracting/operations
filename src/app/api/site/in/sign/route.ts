import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { JOB_CANCELLED_SIGN_IN, createSignIn } from "@/lib/signInCreate";
import { withErrorHandling } from "@/lib/apiHandler";
import { nameWithoutAmounts } from "@/lib/dailyLog/money";
import { makeOdometerToken, makePrestartToken, makeTravelPass, openJob, pointOf, readTicket, shiftLabel, sydneyTime } from "@/lib/signin";
import { askText, decideSignIn, recentNightShift, type ShiftAnswer, type ShiftAsk } from "@/lib/shiftRollover";
import { tipRunOn } from "@/lib/tipRun/rules";
import { endOutOnSignIn, hasRegionalWork, homeOffered } from "@/lib/travel/store";
import { walkaroundRequiredFor } from "@/lib/prestart/store";
import { truckPrestartPending } from "@/lib/prestart/today";
import { passAllowed } from "@/lib/travel/rules";
import { looksLikeLobos } from "@/lib/staffMatch";
import { todaySydney } from "@/lib/today";
import { syncPersonDayQuietly, syncSignInActualsQuietly } from "@/lib/signInActuals";
import { endOpenElsewhere } from "@/lib/signinOverlap";
import { parseGps } from "@/lib/payroll/rules";
import { outsideWindow, posterRefusal, type PosterWindow } from "@/lib/posterGuard/rules";
import { posterWindowOn, projectHours, windowForJob } from "@/lib/posterGuard/store";

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

  // Where: a job on the board, or a sign-in point. Site poster only (11 Nov 2026): posterWin = when its sign-IN window
  // is open (1 h before the start to 2 h after the finish).
  let where: Where;
  let posterWin: PosterWindow | null = null;
  let job: OpenJob | null = null;
  if (ticket.method === "POINT") {
    const link = await prisma.siteLink.findUnique({
      where: { id: ticket.linkId },
      select: { id: true, place: true, revokedAt: true, resource: { select: { id: true, name: true } } },
    });
    const point = link && !link.revokedAt ? pointOf(link) : null;
    if (!point) return bad("This sign-in QR isn't active any more.");
    where = { jobId: null, place: point.place, vehicleId: point.vehicleId, label: point.label, date: todaySydney(), allocatedIds: null, projectId: null };
  } else {
    job = await openJob(body.jobId);
    if (!job) return bad("That job isn't open for sign-in any more.");
    // Whether a NEW sign-in may go here (an earlier job kept open only for signing out; tonight's night shift before
    // noon; just off a night shift) is decided below, once we know who it is - lib/shiftRollover.ts decideSignIn.
    ({ where, posterWin } = await atJob(job, ticket.method));
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
    // TF-008 (Ilies: "everyone is lobos contracting"): Lobos, Lobos Civil, Lobos Demolition, Lobos Contracting are all
    // staff - a "hire" sign-in never reaches the staff timesheet. The office can still add one if it must.
    if (looksLikeLobos(company)) return bad("You're Lobos staff - pick your name instead (tap \"I'm not on this list\" to search).");
    who = { resourceId: null, workerName: name, company };
  }
  const whoWhere = who.resourceId ? { resourceId: who.resourceId } : { resourceId: null, workerName: who.workerName, company: who.company };
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : null;
  const now = new Date();
  // Shift rollover (19 Nov 2026, Ilies): a NEW sign-in on a job - tonight's night shift only from noon, and just off a
  // night shift (6 h) it asks first: "Back on the same shift" (that night job again) or "This is a new shift". STATUS
  // runs the same decision so the phone shows Sign in only when there's somewhere it can go. Never for signing out.
  let shiftAnswer: ShiftAnswer | null = null;
  let signInClosed: string | null = null;
  let ask: ShiftAsk | null = null;
  if (job && (body.action === "IN" || body.action === "STATUS")) {
    const d = decideSignIn({ chosen: job, prior: await recentNightShift(who, now), answer: body.shiftAnswer, now, tipRunOn: tipRunOn() && !!who.resourceId });
    if (d.kind === "REFUSE") signInClosed = d.error;
    else if (d.kind === "ASK") ask = d.ask;
    else {
      shiftAnswer = d.answer;
      if (body.action === "IN" && d.jobId !== job.id) {
        const same = await openJob(d.jobId);
        if (!same) return bad("That shift isn't open for sign-in any more.");
        job = same;
        ({ where, posterWin } = await atJob(same, ticket.method));
      }
    }
  }
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
    const closed = signInClosed ?? (ticket.method === "POSTER" ? outsideWindow(posterWin, now) : null);
    return NextResponse.json({
      signedIn: !!open, since: open ? sydneyTime(open.signInAt) : null, site: where.label, ...(closed ? { signInClosed: closed } : {}),
      ...(open ? await resumePrestart(open, deviceId) : {}),
    });
  }

  const toConfirm = ticket.method === "POSTER";
  const runBy =
    ticket.method === "SUPERVISOR_QR"
      ? (await prisma.siteLink.findUnique({ where: { id: ticket.linkId }, select: { resource: { select: { name: true } } } }))?.resource?.name ?? null
      : ticket.method === "POSTER" ? "Site poster" : `${where.label} QR`;

  if (body.action === "IN") {
    if (open) return bad(`You're already signed in here since ${sydneyTime(open.signInAt)}.`, 409);
    if (signInClosed) return bad(signInClosed);
    // Just off a night shift: the phone shows the question (lib/shiftRollover.ts) and sends the answer back.
    if (ask) return NextResponse.json({ error: askText(ask), ask }, { status: 409 });
    // The site poster's window (11 Nov 2026, Ilies): refused outside it - no sign-in saved and nothing else changed
    // (no other open sign-in of theirs is ended). Sign-out is never windowed; nor is any other way of signing in.
    const refusal = posterRefusal({ action: "IN", method: ticket.method, window: posterWin, now, windowOn: posterWindowOn() });
    if (refusal) return bad(refusal, 403);
    const sinceMidnight = await prisma.siteAttendance.count({ where: { ...(where.jobId ? { jobId: where.jobId } : { place: where.place, vehicleId: where.vehicleId, date: where.date }) } });
    if (sinceMidnight >= 300) return bad("Too many sign-ins here today - call the office.", 429);
    // Signed in somewhere else (another site, another truck) and moved here:
    // that one ends now. A site one goes to its supervisor to confirm.
    // (Fix 1, 2 Nov 2026: the same helper every sign-in path uses, with a note kept on the ended line.)
    const signedIn = await createSignIn({
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
        shiftAnswer, // SAME / NEW when they were asked (19 Nov 2026); null otherwise
    });
    if (!signedIn) return bad(JOB_CANCELLED_SIGN_IN, 409); // PS-031: the job was cancelled a moment ago
    // PS-035: only once this sign-in is saved (a refused one leaves the other open sign-in as it was).
    const elsewhere = await endOpenElsewhere({ who, at: now, here: { jobId: where.jobId, place: where.place, vehicleId: where.vehicleId }, label: where.label, by: runBy ?? "Sign-in", siteToConfirm: true });
    // Anywhere they were just moved off now has their hours.
    await syncSignInActualsQuietly([...elsewhere.map((e) => e.jobId), where.jobId]);
    await syncPersonDayQuietly(who.resourceId, where.date);
    // Regional travel (2 Nov 2026): arriving on site ends their outward travel to this project.
    const travelEnded = where.jobId ? await endOutOnSignIn(who.resourceId, where.projectId, signedIn.id, now) : null;
    return NextResponse.json({
      ok: true,
      message: `Signed in at ${sydneyTime(now)} - ${where.label}.${toConfirm ? " Your supervisor will confirm it." : ""}${travelEnded ? " " + travelEnded : ""}`,
      ...(await travelFor(who.resourceId, deviceId, where.date, { jobId: where.jobId, method: ticket.method, allocatedIds: where.allocatedIds })),
      // On a truck: the next screen asks for an odometer photo (Receipts R1).
      ...(where.place === "VEHICLE" ? { odometer: makeOdometerToken(signedIn.id) } : {}),
      // ...then the pre-start checklist (8 Nov 2026). The sign-in above is already saved - the check never holds it up.
      ...(where.place === "VEHICLE" ? { prestart: makePrestartToken(signedIn.id, "PRE") } : {}),
      // Stage 1b (10 Nov 2026): the day's first pre-start for this truck needs the walk-around photos and the odometer
      // (no "Can't now"). Only a hint for the screen - a failure here never touches the sign-in, and the check decides.
      ...(where.place === "VEHICLE" && where.vehicleId
        ? { walkaroundRequired: await walkaroundRequiredFor(where.vehicleId, "VEHICLE").catch(() => false) } : {}),
      // Ilies, 23 Nov 2026: with no pre-start on the truck yet today the driver can't skip it ("Do it later" is gone) -
      // the sign-in time above is already saved; reopening the QR on this phone comes back to it (STATUS below).
      ...(where.place === "VEHICLE" ? { prestartRequired: await truckPrestartPending(signedIn.id).catch(() => false) } : {}),
    });
  }

  if (body.action === "OUT") {
    if (!open) return bad("You're not signed in here.", 404);
    await prisma.siteAttendance.update({
      where: { id: open.id },
      data: { signOutAt: now, signOutMethod: ticket.method, ...(toConfirm ? { status: "TO_CONFIRM" } : {}) },
    });
    await syncSignInActualsQuietly([open.jobId]);
    await syncPersonDayQuietly(who.resourceId, open.date);
    // The shift they actually signed out of (last night's, found at the same site) - named with its day (19 Nov 2026).
    const outJob = open.jobId && open.jobId !== where.jobId
      ? await prisma.job.findUnique({ where: { id: open.jobId }, select: { title: true, shift: true, date: true, project: { select: { name: true } } } })
      : null;
    const regional = !!open.jobId && (await homeOffered(who.resourceId, where.projectId));
    return NextResponse.json({
      ok: true,
      message: `Signed out at ${sydneyTime(now)} - ${outJob ? shiftLabel(outJob) : where.label}. See you next time.`,
      ...(await travelFor(who.resourceId, deviceId, where.date, { jobId: where.jobId, method: ticket.method, allocatedIds: where.allocatedIds })),
      // Regional job: "Travelling home" comes next on the phone.
      ...(regional ? { travelHome: true } : {}),
      // ...and "Start tip run" (19 Nov 2026) for the driver going back to tip the truck - their own phone, no sign-in.
      ...(regional && who.resourceId && tipRunOn() ? { tipRun: true } : {}),
      // Off a truck: the short post-check comes next (8 Nov 2026), for the sign-in just closed.
      ...(open.place === "VEHICLE" && open.vehicleId ? { postcheck: makePrestartToken(open.id, "POST") } : {}),
    });
  }
  return bad("Unknown request.");
});

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Reopening the truck QR with a required pre-start still to send (Ilies, 23 Nov 2026): the phone is taken straight back
// into it. Only for the phone that signed in (its device id), only while the sign-in is open (PS-006: a PRE token is never
// handed out after sign-out) and only in this reply's body - never the address (PS-005). A failure here never touches the
// sign-in or the Sign out button.
async function resumePrestart(open: { id: string; place: string | null; vehicleId: string | null; deviceId: string | null; signOutAt: Date | null }, deviceId: string | null) {
  if (open.place !== "VEHICLE" || !open.vehicleId || open.signOutAt || !deviceId || open.deviceId !== deviceId) return {};
  try {
    if (!(await truckPrestartPending(open.id))) return {};
    const odo = await prisma.odometerReading.findUnique({ where: { siteAttendanceId: open.id }, select: { status: true } });
    // PT-002 (Ilies approved 23 Nov 2026): an odometer token only while the photo isn't in (none yet, or SKIPPED - let
    // through on a full limit) - a sent reading can't be replaced from a resumed screen.
    const odometerSent = !!odo && odo.status !== "SKIPPED";
    return {
      prestartRequired: true,
      prestart: makePrestartToken(open.id, "PRE"),
      walkaroundRequired: await walkaroundRequiredFor(open.vehicleId, "VEHICLE").catch(() => true),
      // The odometer step again when it isn't in yet (the pre-start screen can also take it).
      ...(!odometerSent ? { odometer: makeOdometerToken(open.id) } : {}),
      odometerSent,
    };
  } catch {
    return {};
  }
}

type OpenJob = NonNullable<Awaited<ReturnType<typeof openJob>>>;
type Where = {
  jobId: string | null;
  place: string | null;
  vehicleId: string | null;
  label: string;
  date: string;
  allocatedIds: string[] | null; // null = everyone counts as allocated (points)
  projectId: string | null;
};
// A job's "where" (and the poster's window for it). shiftLabel: a night shift says plainly which day its hours count
// to (19 Nov 2026).
async function atJob(j: OpenJob, method: string): Promise<{ where: Where; posterWin: PosterWindow | null }> {
  return {
    posterWin: method === "POSTER" && posterWindowOn() ? windowForJob(j, await projectHours(j.project?.id)) : null,
    where: {
      jobId: j.id, place: null, vehicleId: null, label: shiftLabel(j),
      date: j.date.toISOString().slice(0, 10), allocatedIds: j.assignments.map((a) => a.resource.id), projectId: j.project?.id ?? null,
    },
  };
}
// Regional travel (2 Nov 2026): the phone is told whether its owner has regional work coming up (it then shows the
// travel page link), and gets its travel pass ONLY from a sign-in on the supervisor's QR, on a job they're allocated
// to, with regional work on their board (AT-001, Ilies: "Supervisor QR only" - lib/travel/rules.ts passAllowed).
async function travelFor(resourceId: string | null, deviceId: string | null, date: string, s: { jobId: string | null; method: string; allocatedIds: string[] | null }) {
  if (!resourceId || !deviceId) return {};
  const regionalWork = await hasRegionalWork(resourceId, date);
  const allocated = !!s.allocatedIds && s.allocatedIds.includes(resourceId);
  return { travelLink: regionalWork, ...(passAllowed({ jobId: s.jobId, method: s.method, allocated, regionalWork }) ? { travelPass: makeTravelPass(resourceId, deviceId) } : {}) };
}
// A hire worker's typed name / company: never an amount in it (SEC-010) - it's shown on the log screen and the report.
const clean = (v: unknown) => (typeof v === "string" ? nameWithoutAmounts(v.replace(/\s+/g, " ").trim()).slice(0, 60) : "");
