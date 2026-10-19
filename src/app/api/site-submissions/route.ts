import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// GET /api/site-submissions -> what's come in from site: everything waiting
// for the office, plus the last 14 days of handled items and supervisors'
// own toolbox checks.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await prisma.siteSubmission.findMany({
    where: { OR: [{ status: "PENDING" }, { createdAt: { gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { siteLink: { select: { resource: { select: { name: true } } } } },
  });
  // Tool / toolbox / check details, looked up in one go.
  const toolIds = rows.map((r) => r.toolId).filter((x): x is string => !!x);
  const boxIds = rows.map((r) => r.toolboxId).filter((x): x is string => !!x);
  const checkIds = rows.map((r) => r.checkId).filter((x): x is string => !!x);
  const [tools, boxes, checks] = await Promise.all([
    prisma.tool.findMany({ where: { id: { in: toolIds } }, select: { id: true, tag: true, name: true, serialNumber: true, condition: true } }),
    prisma.toolbox.findMany({ where: { id: { in: boxIds } }, select: { id: true, name: true } }),
    prisma.toolboxCheck.findMany({ where: { id: { in: checkIds } }, select: { id: true, result: true } }),
  ]);
  const parse = (s: string | null | undefined) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  return NextResponse.json(
    rows.map(({ siteLink, ...r }) => ({
      ...r,
      from: siteLink.resource.name,
      photoIds: parse(r.photoIds) ?? [],
      reading: parse(r.reading),
      tool: tools.find((t) => t.id === r.toolId) ?? null,
      toolbox: boxes.find((b) => b.id === r.toolboxId) ?? null,
      checkResult: parse(checks.find((c) => c.id === r.checkId)?.result),
    }))
  );
});
