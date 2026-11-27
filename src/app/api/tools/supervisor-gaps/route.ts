import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { emptyToolboxGap } from "@/lib/toolFaults";

// GET /api/tools/supervisor-gaps -> active supervisors with no tools in any toolbox (Ilies, 27 Nov 2026: "Shows the
// empty-toolbox gap to the office too"). Information only - the small note on the Tools page. Names and counts only.
// Managers and Admins (guard("MANAGER"), like From site): the coordinator and the yard computer keep exactly the Tools
// access they had - this note isn't part of it.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const people = await prisma.resource.findMany({
    where: {
      active: true,
      OR: [
        { siteLinks: { some: { kind: "SUPERVISOR", revokedAt: null } } },
        { toolboxes: { some: { active: true } } },
      ],
    },
    select: {
      id: true,
      name: true,
      siteLinks: { where: { kind: "SUPERVISOR", revokedAt: null }, select: { id: true }, take: 1 },
      toolboxes: {
        where: { active: true },
        select: { name: true, _count: { select: { tools: { where: { retiredAt: null, condition: { not: "Swapped out" } } } } } },
      },
    },
  });
  const rows = emptyToolboxGap(
    people.map((p) => ({ id: p.id, name: p.name, hasLink: p.siteLinks.length > 0, toolboxes: p.toolboxes.map((b) => ({ name: b.name, tools: b._count.tools })) })),
  );
  return NextResponse.json({ supervisors: rows });
});
