import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { liveJobFields } from "@/lib/jobs";

// GET /api/jobs/completed -> every job marked Completed, newest first.
// This is the "Completed" folder: jobs land here once their status is set to
// Completed (and leave the Command Centre board), and moving one back to Active
// returns it to the board for its date.
export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;

  const jobs = await prisma.job.findMany({
    where: { status: "COMPLETED" },
    orderBy: { date: "desc" },
    include: {
      project: { select: { name: true, client: true, jobNo: true, address: true } },
      assignments: { include: { resource: true }, orderBy: { createdAt: "asc" } },
    },
  });

  const out = jobs.map(({ project, ...j }) => ({
    ...j,
    ...liveJobFields({ title: j.title, client: j.client, siteCode: j.siteCode, siteAddress: j.siteAddress, project }),
    date: j.date.toISOString().slice(0, 10),
  }));
  return NextResponse.json(out);
});
