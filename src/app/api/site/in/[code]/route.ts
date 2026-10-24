import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { jobLabel, makeTicket, openJob, openJobsAtProject, pointCrew, readRotatingCode, resolvePoster, type Method } from "@/lib/signin";

// GET /api/site/in/:code - a phone has scanned a sign-in QR: the supervisor's
// changing code, a site poster, or a fixed office / yard / truck QR. Public,
// like the rest of /api/site. Returns where they're signing in (a job, or the
// point), the names to pick from the first time, and a 15-minute ticket to
// sign in/out with. Nothing else from Operations - no times, no money, no
// other sites.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ code: string }> }) => {
  const params = await paramsP;
  const code = decodeURIComponent(params.code);
  let method: Method;
  let linkId: string;
  let jobs: { id: string; label: string; times: string | null; crew: { id: string; name: string }[] }[];

  if (code.includes(".")) {
    const q = readRotatingCode(code);
    if (!q) return gone("That code has expired - scan the supervisor's screen again.");
    const link = await prisma.siteLink.findUnique({ where: { id: q.linkId }, select: { revokedAt: true, expiresAt: true } });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) return gone("That sign-in code isn't active any more.");
    const job = await openJob(q.jobId);
    if (!job) return gone("That job isn't open for sign-in today.");
    method = "SUPERVISOR_QR";
    linkId = q.linkId;
    jobs = [shape(job)];
  } else {
    const poster = await resolvePoster(code);
    if (!poster) return gone("This sign-in QR isn't active. Ask the office.");
    if (poster.type === "POINT") {
      // Office / yard / truck: one "job" that is the point itself.
      method = "POINT";
      linkId = poster.id;
      jobs = [{ id: poster.id, label: poster.label, times: null, crew: await pointCrew(poster.place) }];
    } else {
      const open = await openJobsAtProject(poster.projectId);
      if (open.length === 0) return gone("There's no work on the board at this site today - check with your supervisor.");
      method = "POSTER";
      linkId = poster.id;
      jobs = open.map(shape);
    }
  }

  return NextResponse.json({
    method,
    ticket: makeTicket({ jobIds: jobs.map((j) => j.id), method, linkId }),
    jobs,
  });
});

const shape = (j: Awaited<ReturnType<typeof openJobsAtProject>>[number]) => ({
  id: j.id,
  label: jobLabel(j),
  times: j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : null,
  crew: j.assignments.map((a) => a.resource),
});
const gone = (error: string) => NextResponse.json({ error }, { status: 404 });
