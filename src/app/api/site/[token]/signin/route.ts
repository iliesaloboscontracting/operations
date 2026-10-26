import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink, siteUrl, type ResolvedLink } from "@/lib/siteLinks";
import { syncSignInActualsQuietly } from "@/lib/signInActuals";
import { createHandover, jobLabel, openJob, openJobsFor, ROTATE_SECONDS, rotatingCode, sydneyTime, takesSignIns } from "@/lib/signin";

// The supervisor's side of crew sign-in, through their own link (or a
// stand-in's one-day hand-over link). Supervisors confirm or reject poster
// sign-ins and tick in crew without a phone - they never change a time; only
// the office does that (Manager+, /attendance).
//
// GET  -> their open jobs, each with the current QR (changes every 30s - the
//         phone polls) and the crew's sign-in state.
// POST { action: "CONFIRM" | "REJECT", attendanceId }
//      { action: "MANUAL_IN", jobId, resourceId }   (time = now)
//      { action: "MANUAL_OUT", attendanceId }       (time = now)
//      { action: "MANUAL_OUT_MANY", attendanceIds } (time = now - several at once, 24 Oct 2026)
//      { action: "HANDOVER", jobId, resourceId }    -> { url } one-day link
async function jobsFor(link: ResolvedLink) {
  if (link.kind === "HANDOVER") {
    const j = link.jobId ? await openJob(link.jobId) : null;
    return j ? [j] : [];
  }
  return link.person.id ? openJobsFor(link.person.id) : [];
}

async function load(req: NextRequest, token: string) {
  const link = await resolveLink(token);
  if (!link) return { ok: false as const, res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  if (link.kind === "OFFICE") return { ok: false as const, res: NextResponse.json({ error: "Crew sign-in runs from a supervisor's link." }, { status: 403 }) };
  return { ok: true as const, link, jobs: await jobsFor(link) };
}

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const r = await load(req, params.token);
  if (!r.ok) return r.res;
  const { link, jobs } = r;
  const attendances = await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, removedAt: null },
    orderBy: { signInAt: "asc" },
  });
  return NextResponse.json({
    person: link.person.name,
    handover: link.kind === "HANDOVER",
    rotateSeconds: ROTATE_SECONDS,
    jobs: jobs.map((j) => {
      const mine = attendances.filter((a) => a.jobId === j.id);
      const row = (a: (typeof mine)[number]) => ({
        id: a.id,
        in: sydneyTime(a.signInAt),
        out: sydneyTime(a.signOutAt),
        method: a.signInMethod,
        outMethod: a.signOutMethod,
        status: a.status,
      });
      // Allocated crew first (with their latest sign-in), then anyone else
      // who signed in: hire / subcontractors, people moved here.
      const crew = j.assignments.map(({ resource }) => {
        const last = mine.filter((a) => a.resourceId === resource.id).at(-1);
        return { resourceId: resource.id, name: resource.name, company: null, allocated: true, attendance: last ? row(last) : null };
      });
      const others = mine
        .filter((a) => !a.resourceId || !j.assignments.some((x) => x.resource.id === a.resourceId))
        .map((a) => ({ resourceId: a.resourceId, name: a.workerName, company: a.company, allocated: false, attendance: row(a) }));
      return {
        id: j.id,
        label: jobLabel(j),
        times: j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : null,
        qrUrl: siteUrl(`in/${rotatingCode(j.id, link.id)}`, req.nextUrl.origin),
        crew: [...crew, ...others],
        toConfirm: mine.filter((a) => a.status === "TO_CONFIRM").map((a) => ({ ...row(a), name: a.workerName, company: a.company })),
      };
    }),
  });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const r = await load(req, params.token);
  if (!r.ok) return r.res;
  const { link, jobs } = r;
  const body = await req.json().catch(() => ({}));
  const by = `${link.person.name} (site)`;
  const jobIds = jobs.map((j) => j.id);

  const attendance = typeof body.attendanceId === "string"
    ? await prisma.siteAttendance.findFirst({ where: { id: body.attendanceId, jobId: { in: jobIds } } })
    : null;

  switch (body.action) {
    case "CONFIRM":
    case "REJECT": {
      if (!attendance) return bad("That sign-in isn't on your jobs.");
      if (attendance.status !== "TO_CONFIRM") return bad("That one's already been dealt with - the office can change it.");
      await prisma.siteAttendance.update({
        where: { id: attendance.id },
        data: { status: body.action === "CONFIRM" ? "CONFIRMED" : "REJECTED", confirmedBy: by, confirmedAt: new Date() },
      });
      await syncSignInActualsQuietly([attendance.jobId]);
      return NextResponse.json({ ok: true });
    }
    case "MANUAL_IN": {
      const job = jobs.find((j) => j.id === body.jobId);
      if (!job) return bad("Pick one of your jobs.");
      if (!takesSignIns(job)) return bad("That shift has finished - tick them in on today's job.");
      const person = typeof body.resourceId === "string"
        ? await prisma.resource.findUnique({ where: { id: body.resourceId }, select: { id: true, name: true, type: true } })
        : null;
      if (!person || person.type !== "PERSONNEL") return bad("Pick someone from the crew.");
      const open = await prisma.siteAttendance.findFirst({ where: { jobId: job.id, resourceId: person.id, signOutAt: null, status: { not: "REJECTED" } } });
      if (open) return bad(`${person.name} is already signed in since ${sydneyTime(open.signInAt)}.`);
      await prisma.siteAttendance.create({
        data: {
          jobId: job.id,
          date: job.date.toISOString().slice(0, 10),
          resourceId: person.id,
          workerName: person.name,
          allocated: job.assignments.some((a) => a.resource.id === person.id),
          signInAt: new Date(),
          signInMethod: "MANUAL",
          status: "CONFIRMED",
          runBy: link.person.name,
        },
      });
      return NextResponse.json({ ok: true });
    }
    case "MANUAL_OUT": {
      if (!attendance) return bad("That sign-in isn't on your jobs.");
      if (attendance.signOutAt) return bad("Already signed out - the office can change the time.");
      await prisma.siteAttendance.update({ where: { id: attendance.id }, data: { signOutAt: new Date(), signOutMethod: "MANUAL" } });
      await syncSignInActualsQuietly([attendance.jobId]);
      return NextResponse.json({ ok: true });
    }
    case "MANUAL_OUT_MANY": {
      const ids = Array.isArray(body.attendanceIds) ? body.attendanceIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 100) : [];
      const rows = await prisma.siteAttendance.findMany({ where: { id: { in: ids }, jobId: { in: jobIds }, signOutAt: null, status: { not: "REJECTED" } } });
      if (!rows.length) return bad("Nobody picked is still signed in.");
      await prisma.siteAttendance.updateMany({ where: { id: { in: rows.map((x) => x.id) } }, data: { signOutAt: new Date(), signOutMethod: "MANUAL" } });
      await syncSignInActualsQuietly([...new Set(rows.map((x) => x.jobId))]);
      return NextResponse.json({ ok: true, signedOut: rows.length });
    }
    case "HANDOVER": {
      if (link.kind !== "SUPERVISOR") return bad("Only the supervisor can hand over.");
      const job = jobs.find((j) => j.id === body.jobId);
      if (!job) return bad("Pick one of your jobs.");
      if (!job.assignments.some((a) => a.resource.id === body.resourceId) || body.resourceId === link.person.id) {
        return bad("Pick someone else from this job's crew.");
      }
      const out = await createHandover(job.id, String(body.resourceId), by);
      if (!out.ok) return bad(out.error);
      return NextResponse.json({ ok: true, name: out.name, url: siteUrl(out.secret, req.nextUrl.origin) }, { status: 201 });
    }
    default:
      return bad("Unknown request.");
  }
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
