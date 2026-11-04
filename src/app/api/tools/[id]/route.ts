import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { updateTool } from "@/lib/toolUpdate";

// GET /api/tools/:id -> the tool with its photos, move history and faults.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardTools("VIEWER");
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
  return viewJson(tool);
});

// PATCH /api/tools/:id { ...fields, toolboxId?, moveReason? }
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();
  // The rules live in lib/toolUpdate.ts (shared with finishing a yard stock take, 4 Nov 2026).
  const out = await updateTool(params.id, body && typeof body === "object" ? body : {}, { role: user?.role ?? null, name: user?.name ?? null });
  if ("error" in out) return NextResponse.json({ error: out.error, ...(out.duplicate ? { duplicate: out.duplicate } : {}) }, { status: out.status });
  return viewJson(out.tool); // the coordinator / yard computer never see an amount in its notes
});

export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  await prisma.tool.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
