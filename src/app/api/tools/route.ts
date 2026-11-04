import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { createTool } from "@/lib/toolCreate";

export const GET = withErrorHandling(async () => {
  const denied = await guardTools("VIEWER");
  if (denied) return denied;
  const tools = await prisma.tool.findMany({
    orderBy: { tag: "asc" },
    include: {
      toolbox: { select: { id: true, name: true } },
      photos: { where: { kind: { in: ["PLATE", "CONDITION"] } }, select: { id: true, kind: true }, orderBy: { createdAt: "desc" } },
      _count: { select: { issues: { where: { status: { in: ["REPORTED", "SWAP_REQUESTED"] } } } } },
    },
  });
  return viewJson(
    tools.map(({ _count, ...t }) => ({ ...t, openIssues: _count.issues }))
  );
});

// POST /api/tools { ...fields, toolboxId?, photoIds? }
// photoIds are the plate/condition photos uploaded while registering. Same
// rules as every other way in (lib/toolCreate.ts): a serial or "plate not
// readable", and never the same serial twice.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();
  const result = await createTool(body, {
    photoIds: Array.isArray(body.photoIds) ? body.photoIds : [],
    toolboxId: typeof body.toolboxId === "string" && body.toolboxId ? body.toolboxId : null,
    addedFrom: "OFFICE",
    addedBy: user?.name ?? null,
    needsCheck: false,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, duplicate: result.duplicate ?? null }, { status: result.status });
  return viewJson(await prisma.tool.findUnique({ where: { id: result.tool.id } }), { status: 201 });
});
