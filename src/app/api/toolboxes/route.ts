import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, guardTools } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { checkSupervisor } from "@/lib/toolboxServer";
import { lastCheckOf } from "@/lib/toolboxLastCheck";

// GET /api/toolboxes -> active toolboxes with their supervisor, tools and last check.
export const GET = withErrorHandling(async () => {
  const denied = await guardTools("VIEWER");
  if (denied) return denied;
  const boxes = await prisma.toolbox.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      supervisor: { select: { id: true, name: true, phone: true } },
      tools: {
        where: { retiredAt: null },
        orderBy: { tag: "asc" },
        select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, condition: true, ownership: true },
      },
      checks: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true, checkedBy: true, result: true } },
    },
  });
  // TT-001: a ticked check says so, with the box's last photo check beside it (a tick check never has photos).
  const photoChecks = await prisma.toolboxCheck.groupBy({
    by: ["toolboxId"],
    where: { toolboxId: { in: boxes.map((b) => b.id) }, photoIds: { not: "[]" } },
    _max: { createdAt: true },
  });
  const lastPhoto = new Map(photoChecks.map((p) => [p.toolboxId, p._max.createdAt]));
  return viewJson(
    boxes.map(({ checks, ...b }) => ({ ...b, lastCheck: lastCheckOf(checks[0], lastPhoto.get(b.id) ?? null) }))
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
