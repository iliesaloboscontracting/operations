import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { pickTool, toolFieldError } from "@/lib/pickTool";
import { withErrorHandling } from "@/lib/apiHandler";
import { moveTool } from "@/lib/toolMoves";
import { duplicateMessage, findDuplicate, serialKeyOf } from "@/lib/toolCreate";

// GET /api/tools/:id -> the tool with its photos, move history and faults.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const tool = await prisma.tool.findUnique({
    where: { id: params.id },
    include: {
      toolbox: { select: { id: true, name: true } },
      photos: { select: { id: true, kind: true, createdAt: true, takenBy: true }, orderBy: { createdAt: "desc" } },
      movements: { orderBy: { createdAt: "desc" } },
      issues: {
        orderBy: { createdAt: "desc" },
        include: { replacementTool: { select: { id: true, tag: true, name: true, serialNumber: true } } },
      },
    },
  });
  if (!tool) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(tool);
});

// PATCH /api/tools/:id { ...fields, toolboxId?, moveReason? }
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();
  const data = pickTool(body);
  const invalid = toolFieldError(data);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  // Changing the serial: never onto one another tool already has.
  if ("serialNumber" in data) {
    const dup = await findDuplicate(data.serialNumber, params.id);
    if (dup) return NextResponse.json({ error: duplicateMessage(dup), duplicate: dup }, { status: 409 });
    data.serialKey = serialKeyOf(data.serialNumber);
    if (data.serialKey) data.plateUnreadable = false;
  }
  // A toolbox change goes through moveTool (logged, keeps "held by" in step);
  // it also sets heldBy, so a heldBy in the same request is ignored.
  if ("toolboxId" in body) {
    delete data.heldBy;
    await moveTool(params.id, body.toolboxId || null, typeof body.moveReason === "string" ? body.moveReason : null, user?.name ?? null);
  }
  const tool = await prisma.tool.update({
    where: { id: params.id },
    data: data as any,
  });
  return NextResponse.json(tool);
});

export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.tool.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
