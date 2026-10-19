import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { checkSupervisor } from "@/lib/toolboxServer";

// GET /api/toolboxes -> active toolboxes with their supervisor, tools and last check.
export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const boxes = await prisma.toolbox.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      supervisor: { select: { id: true, name: true, phone: true } },
      tools: {
        orderBy: { tag: "asc" },
        select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true, ownership: true },
      },
      checks: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true, checkedBy: true, result: true } },
    },
  });
  return NextResponse.json(
    boxes.map(({ checks, ...b }) => {
      const last = checks[0];
      let summary: { missing: number; foreign: number } | null = null;
      if (last) {
        try {
          const r = JSON.parse(last.result);
          summary = { missing: r.missing?.length ?? 0, foreign: r.foreign?.length ?? 0 };
        } catch {
          summary = null;
        }
      }
      return { ...b, lastCheck: last ? { id: last.id, createdAt: last.createdAt, checkedBy: last.checkedBy, ...summary } : null };
    })
  );
});

// POST /api/toolboxes { name, supervisorId?, notes? }
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A toolbox needs a name." }, { status: 400 });
  const supervisorError = await checkSupervisor(body.supervisorId);
  if (supervisorError) return supervisorError;
  const box = await prisma.toolbox.create({
    data: { name, supervisorId: body.supervisorId || null, notes: body.notes || null },
  });
  return NextResponse.json(box, { status: 201 });
});
