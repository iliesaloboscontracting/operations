import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard } from "@/lib/auth";
import { audiencesFor } from "@/lib/findings/actions";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeView } from "@/lib/siteRequests";
import { NEEDS_ILIES, OFFICE_KINDS, OPEN_STATUSES } from "@/lib/requestTypes";

// GET /api/requests           -> open requests, plus anything closed in the last 14 days
// GET /api/requests?count=1   -> { waiting } for the menu badge (new / seen / can't-do)
// &scope=office on any of these -> the directors & accounts board instead of site requests
// GET /api/requests?all=1     -> everything (history, newest first, up to 500)
// Manager+ can look; only an Admin decides (see [id]).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  // Actions and queries carry an audience (Phase 2): Managers see operational
  // and commercial ones, director-only ones only reach directors. Every
  // site request is operational, so this list is unchanged for them.
  // ?scope=office -> queries and actions to and from the directors and accounts;
  // otherwise (site) everything else. Each board and badge counts only its own.
  const kinds = q.get("scope") === "office" ? { in: OFFICE_KINDS } : { notIn: OFFICE_KINDS };
  const seen = { audience: { in: audiencesFor((await getCurrentUser())!) }, kind: kinds };
  if (q.get("count")) {
    // Waiting on a decision, plus reminders that have come due (23 Oct 2026).
    const [decide, reminders] = await Promise.all([
      prisma.siteRequest.count({ where: { ...seen, status: { in: NEEDS_ILIES } } }),
      prisma.siteRequest.count({ where: { ...seen, status: { in: OPEN_STATUSES }, remindAt: { lte: new Date() } } }),
    ]);
    return NextResponse.json({ waiting: decide + reminders, decide, reminders });
  }
  const since = new Date(Date.now() - 14 * 86_400_000);
  const rows = await prisma.siteRequest.findMany({
    where: q.get("all") ? seen : { ...seen, OR: [{ status: { in: OPEN_STATUSES } }, { updatedAt: { gte: since } }] },
    include: { events: { orderBy: { at: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  // Who a request can be handed to: office people with their own link (Alex).
  const links = await prisma.siteLink.findMany({
    where: { kind: "OFFICE", revokedAt: null, resourceId: { not: null } },
    select: { resource: { select: { id: true, name: true } } },
  });
  const assignees = [...new Map(links.filter((l) => l.resource).map((l) => [l.resource!.id, l.resource!])).values()];
  return NextResponse.json({ requests: rows.map(officeView), assignees });
});
