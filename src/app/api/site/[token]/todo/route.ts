import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { LINK_WHERE, linkVisible, todoView } from "@/lib/siteRequests";
import { ON_TODO } from "@/lib/requestTypes";

// GET /api/site/:token/todo - the requests Ilies has handed to this office
// person (Alex): to do / on it / waiting on a site answer, plus what was
// finished in the last 7 days.
// Only a personal office link - a shared Yard link has no to-do list.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link || link.kind !== "OFFICE" || !link.person.id) return NextResponse.json({ error: "No to-do list on this link." }, { status: 404 });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.siteRequest.findMany({
    // Queries have their own "Questions from the office" list on the link.
    where: { assigneeId: link.person.id, ...LINK_WHERE, kind: { not: "QUERY" }, OR: [{ status: { in: ON_TODO } }, { status: "DONE", doneAt: { gte: since } }] },
    orderBy: { neededBy: "asc" },
    take: 100,
    include: { events: { orderBy: { at: "asc" } } },
  });
  return NextResponse.json({ person: link.person.name, todo: rows.filter(linkVisible).map(todoView) });
});
