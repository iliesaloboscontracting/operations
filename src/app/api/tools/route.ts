import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { pickTool, toolFieldError } from "@/lib/pickTool";
import { withErrorHandling } from "@/lib/apiHandler";
import { moveTool } from "@/lib/toolMoves";

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
// photoIds are the plate/condition photos uploaded while registering.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();
  if (!body.tag || !body.name) {
    return NextResponse.json({ error: "tag and name are required" }, { status: 400 });
  }
  const data = pickTool(body);
  const invalid = toolFieldError(data);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  // pickTool()/prisma.tool.create() throwing on a duplicate tag is now caught by
  // withErrorHandling's P2002 branch - this try/catch just keeps the message
  // specific to "tag", which the shared handler's generic wording can't know.
  let tool;
  try {
    tool = await prisma.tool.create({ data: data as any });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "That tag already exists" }, { status: 409 });
    }
    throw err;
  }
  const photoIds = Array.isArray(body.photoIds) ? body.photoIds.filter((x: unknown) => typeof x === "string") : [];
  if (photoIds.length) {
    await prisma.toolPhoto.updateMany({ where: { id: { in: photoIds }, toolId: null }, data: { toolId: tool.id } });
  }
  if (typeof body.toolboxId === "string" && body.toolboxId) {
    await moveTool(tool.id, body.toolboxId, "Registered into this toolbox", user?.name ?? null);
  }
  return NextResponse.json(await prisma.tool.findUnique({ where: { id: tool.id } }), { status: 201 });
});
