import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createTool } from "@/lib/toolCreate";

export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const tools = await prisma.tool.findMany({
    orderBy: { tag: "asc" },
    include: {
      toolbox: { select: { id: true, name: true } },
      photos: { where: { kind: { in: ["PLATE", "CONDITION"] } }, select: { id: true, kind: true }, orderBy: { createdAt: "desc" } },
      _count: { select: { issues: { where: { status: { in: ["REPORTED", "SWAP_REQUESTED"] } } } } },
    },
  });
  return NextResponse.json(
    tools.map(({ _count, ...t }) => ({ ...t, openIssues: _count.issues }))
  );
});

// POST /api/tools { ...fields, toolboxId?, photoIds? }
// photoIds are the plate/condition photos uploaded while registering. Same
// rules as every other way in (lib/toolCreate.ts): a serial or "plate not
// readable", and never the same serial twice.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
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
  return NextResponse.json(await prisma.tool.findUnique({ where: { id: result.tool.id } }), { status: 201 });
});
