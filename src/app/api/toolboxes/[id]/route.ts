import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { checkSupervisor } from "@/lib/toolboxServer";

// PATCH /api/toolboxes/:id { name?, supervisorId?, notes?, active? }
// Retiring a toolbox (active: false) is only allowed once it's empty, so no
// tool is left pointing at a box nobody can see.
export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
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
