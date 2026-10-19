import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { jobLabel, makeTicket, openJob, openJobsAtProject, readRotatingCode, resolvePoster, type Method } from "@/lib/signin";

// GET /api/site/in/:code - a crew member's phone has scanned a sign-in QR
// (the supervisor's changing code, or the site poster). Public, like the rest
// of /api/site. Returns the job(s) open for sign-in there, that job's crew
// names (first-time pick), and a 15-minute ticket to sign in/out with.
// Nothing else from Operations - no times, no money, no other sites.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: { code: string } }) => {
  const code = decodeURIComponent(params.code);
  let method: Method;
  let linkId: string;
  let jobs: Awaited<ReturnType<typeof openJobsAtProject>>;

  if (code.includes(".")) {
    const q = readRotatingCode(code);
    if (!q) return gone("That code has expired - scan the supervisor's screen again.");
    const link = await prisma.siteLink.findUnique({ where: { id: q.linkId }, select: { revokedAt: true, expiresAt: true } });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) return gone("That sign-in code isn't active any more.");
    const job = await openJob(q.jobId);
    if (!job) return gone("That job isn't open for sign-in today.");
    method = "SUPERVISOR_QR";
    linkId = q.linkId;
    jobs = [job];
  } else {
    const poster = await resolvePoster(code);
    if (!poster) return gone("This sign-in poster isn't active. Ask your supervisor.");
    jobs = await openJobsAtProject(poster.projectId);
    if (jobs.length === 0) return gone("There's no work on the board at this site today - check with your supervisor.");
    method = "POSTER";
    linkId = poster.id;
  }

  return NextResponse.json({
    method,
    ticket: makeTicket({ jobIds: jobs.map((j) => j.id), method, linkId }),
    jobs: jobs.map((j) => ({
      id: j.id,
      label: jobLabel(j),
      times: j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : null,
      crew: j.assignments.map((a) => a.resource),
    })),
  });
});

const gone = (error: string) => NextResponse.json({ error }, { status: 404 });
