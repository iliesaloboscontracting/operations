import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { checkSupervisor } from "@/lib/toolboxServer";

// PATCH /api/toolboxes/:id { name?, supervisorId?, notes?, active?, toolsToYard? }
// Retiring a toolbox (active: false) is only allowed once it's empty, so no
// tool is left pointing at a box nobody can see. With toolsToYard: true its
// tools go back to the Yard first (each move recorded) - "Remove toolbox" for
// someone no longer with us (Ilies, 25 Oct 2026).
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A toolbox needs a name." }, { status: 400 });
    data.name = name;
  }
  if ("supervisorId" in body) {
    const bad = await checkSupervisor(body.supervisorId);
    if (bad) return bad;
    data.supervisorId = body.supervisorId || null;
  }
  if ("notes" in body) data.notes = body.notes || null;
  if ("active" in body) {
    if (body.active === false && body.toolsToYard === true) {
      const box = await prisma.toolbox.findUnique({ where: { id: params.id }, select: { name: true } });
      if (!box) return NextResponse.json({ error: "That toolbox isn't there any more." }, { status: 404 });
      const user = await getCurrentUser();
      const inBox = await prisma.tool.findMany({ where: { toolboxId: params.id }, select: { id: true } });
      await prisma.$transaction([
        ...inBox.map((t) => prisma.tool.update({ where: { id: t.id }, data: { toolboxId: null, heldBy: "Yard" } })),
        ...inBox.map((t) => prisma.toolMovement.create({ data: { toolId: t.id, fromToolboxId: params.id, toToolboxId: null, fromName: box.name, toName: "Yard", reason: "Toolbox removed", movedBy: user?.name ?? null } })),
      ]);
    }
    if (body.active === false && (await prisma.tool.count({ where: { toolboxId: params.id } })) > 0) {
      return NextResponse.json({ error: "Move the tools out of this toolbox before retiring it." }, { status: 409 });
    }
    data.active = !!body.active;
  }
  const box = await prisma.toolbox.update({ where: { id: params.id }, data });
  // Tools in it are "held by" the supervisor - keep that in step.
  if ("supervisorId" in body) {
    const sup = box.supervisorId ? await prisma.resource.findUnique({ where: { id: box.supervisorId }, select: { name: true } }) : null;
    await prisma.tool.updateMany({ where: { toolboxId: box.id }, data: { heldBy: sup?.name ?? box.name } });
  }
  return NextResponse.json(box);
});
