import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";

// GET /api/site/:token -> who the link belongs to and their toolbox(es) with
// the tools in each (for picking a tool when reporting a fault). Tool names
// and serials only - nothing else from Operations is reachable from here.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: { token: string } }) => {
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
  return NextResponse.json({ person: link.person.name, kind: link.kind, shared: link.shared, toolboxes });
});
