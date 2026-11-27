import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { parseUnlisted, suggestMatches } from "@/lib/toolFaults";
import { matchTools } from "@/lib/toolFaultStore";

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
    include: { siteLink: { select: { label: true, resource: { select: { name: true } } } } },
  });
  // Tool / toolbox / check details, looked up in one go.
  const toolIds = rows.map((r) => r.toolId).filter((x): x is string => !!x);
  const boxIds = rows.map((r) => r.toolboxId).filter((x): x is string => !!x);
  const checkIds = rows.map((r) => r.checkId).filter((x): x is string => !!x);
  const photoIdsAll = rows.flatMap((r) => {
    try {
      return JSON.parse(r.photoIds) as string[];
    } catch {
      return [];
    }
  });
  const [tools, boxes, checks, photoKinds] = await Promise.all([
    prisma.tool.findMany({ where: { id: { in: toolIds } }, select: { id: true, tag: true, name: true, serialNumber: true, condition: true } }),
    prisma.toolbox.findMany({ where: { id: { in: boxIds } }, select: { id: true, name: true } }),
    prisma.toolboxCheck.findMany({ where: { id: { in: checkIds } }, select: { id: true, result: true } }),
    prisma.toolPhoto.findMany({ where: { id: { in: photoIdsAll } }, select: { id: true, kind: true } }),
  ]);
  const parse = (s: string | null | undefined) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  // "Not in the list" faults (27 Nov 2026): what the photo showed, and likely tools from the register - plain-code
  // matching (lib/toolFaults.ts), worked out fresh each time so it follows the register. A suggestion only.
  const unlisted = new Map(rows.filter((r) => r.kind === "FAULT").map((r) => [r.id, parseUnlisted(r.reading)] as const).filter(([, u]) => !!u));
  const register = rows.some((r) => r.status === "PENDING" && unlisted.has(r.id) && unlisted.get(r.id)?.seen) ? await matchTools() : [];
  return NextResponse.json(
    rows.map(({ siteLink, ...r }) => ({
      ...r,
      from: siteLink.resource?.name ?? siteLink.label ?? "Shared link",
      photoIds: parse(r.photoIds) ?? [],
      // Which photo is which - a site submission may have either, both or none.
      photos: ((parse(r.photoIds) ?? []) as string[]).map((id) => ({ id, kind: photoKinds.find((p) => p.id === id)?.kind ?? "" })),
      reading: unlisted.has(r.id) ? null : parse(r.reading),
      ...(unlisted.has(r.id)
        ? { unlisted: { status: unlisted.get(r.id)!.status, reason: unlisted.get(r.id)!.reason ?? null, seen: unlisted.get(r.id)!.seen ?? null, suggestions: r.status === "PENDING" ? suggestMatches(unlisted.get(r.id)!.seen, register) : [] } }
        : {}),
      tool: tools.find((t) => t.id === r.toolId) ?? null,
      toolbox: boxes.find((b) => b.id === r.toolboxId) ?? null,
      checkResult: parse(checks.find((c) => c.id === r.checkId)?.result),
    }))
  );
});
