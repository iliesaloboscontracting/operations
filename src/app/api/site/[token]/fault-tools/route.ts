import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { linkSafe, pickerGroups } from "@/lib/toolFaults";

// GET /api/site/:token/fault-tools -> "Other Lobos tools" for Report a fault (Ilies, 27 Nov 2026 - "Their toolbox
// first, then every other Lobos tool, plus 'Not in the list'"). Supervisor links only, the same links that may send a
// FAULT (hand-over and office links: 403; driver, poster and dead links: 404). Every tool on the register outside the
// link's own toolboxes, grouped by toolbox, with its LOB tag and name ONLY - no serial number, notes, holder, brand,
// condition or anything else. The link's own toolboxes still come with GET /api/site/:token, as before.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  if (link.kind !== "SUPERVISOR") return NextResponse.json({ error: "Faults are reported from a supervisor's link." }, { status: 403 });
  const tools = await prisma.tool.findMany({
    where: { retiredAt: null, condition: { not: "Swapped out" } },
    select: { id: true, tag: true, name: true, toolboxId: true, toolbox: { select: { name: true, active: true } } },
  });
  const rows = tools.map((t) => ({ id: t.id, tag: t.tag, name: t.name, toolboxId: t.toolboxId, toolboxName: t.toolbox?.name ?? null, toolboxActive: t.toolbox?.active ?? false }));
  // Money guard: a tool or toolbox typed with a dollar figure in it is left off the phone's list (never sent).
  const groups = pickerGroups(rows.filter((t) => linkSafe([t.tag, t.name, t.toolboxName])), link.toolboxes.map((b) => b.id));
  const reply = { groups };
  if (!linkSafe(reply)) return NextResponse.json({ error: "The tool list couldn't be shown - pick 'Not in the list'." }, { status: 500 });
  return NextResponse.json(reply);
});
