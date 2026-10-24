import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { OPEN_STATUSES } from "@/lib/requestTypes";
import { hireForLink } from "@/lib/hireCheck";
import { LINK_WHERE } from "@/lib/siteRequests";

// GET /api/site/:token -> who the link belongs to and their toolbox(es) with
// the tools in each (for picking a tool when reporting a fault). Tool names
// and serials only - nothing else from Operations is reachable from here.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const toolboxes = await prisma.toolbox.findMany({
    where: { id: { in: link.toolboxes.map((b) => b.id) } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tools: {
        where: { condition: { not: "Swapped out" } },
        orderBy: { tag: "asc" },
        select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true },
      },
    },
  });
  // Counts for the request buttons: a supervisor's open requests (and how
  // many the office has a question on), an office person's to-do list.
  // ...and how many hire items are waiting for the hire check.
  const [openRequests, needsAnswer, todo, hire] = await Promise.all([
    link.kind === "OFFICE" ? 0 : prisma.siteRequest.count({ where: { siteLinkId: link.id, ...LINK_WHERE, status: { in: OPEN_STATUSES } } }),
    link.kind === "OFFICE" ? 0 : prisma.siteRequest.count({ where: { siteLinkId: link.id, ...LINK_WHERE, status: "NEEDS_INFO" } }),
    link.kind === "OFFICE" && link.person.id ? prisma.siteRequest.count({ where: { assigneeId: link.person.id, ...LINK_WHERE, kind: { not: "QUERY" }, status: "TODO" } }) : 0,
    link.kind === "OFFICE" ? [] : hireForLink(link),
  ]);
  return NextResponse.json({ person: link.person.name, kind: link.kind, shared: link.shared, toolboxes, openRequests, needsAnswer, todo, hireItems: hire.length, hireToCheck: hire.filter((h) => h.askNow).length });
});
