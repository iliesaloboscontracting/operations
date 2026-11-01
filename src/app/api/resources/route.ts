import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOrCoordinator, getCurrentUser } from "@/lib/auth";
import { pickResourceData, PAY_RATE_FIELDS } from "@/lib/resourceFields";
import { hireRegisterError } from "@/lib/hireServer";
import { withErrorHandling } from "@/lib/apiHandler";
import { toPublicResource } from "@/lib/serializeResource";
import { hireDateError } from "@/lib/dateRules";
import { coordinatorHireWrite, toCoordinatorHire } from "@/lib/coordinatorHire";

// GET /api/resources?type=PERSONNEL,EQUIPMENT&category=LABOUR
// Includes assignments (+ job) so the UI can show "where is it today".
// The COORDINATOR login (2 Nov 2026) gets the Hire register only (type=HIRE), in the money-free shape of
// lib/coordinatorHire.ts; any other register is refused to him.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("VIEWER");
  if (denied) return denied;
  const type = req.nextUrl.searchParams.get("type");
  const category = req.nextUrl.searchParams.get("category");
  const user = await getCurrentUser();
  const coordinator = user?.role === "COORDINATOR";
  if (coordinator && type !== "HIRE") return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });

  const resources = await prisma.resource.findMany({
    where: {
      active: true,
      ...(type ? { type: { in: type.split(",") } } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: { name: "asc" },
    include: {
      assignments: {
        select: {
          id: true,
          job: { select: { id: true, title: true, date: true, shift: true } },
        },
      },
    },
  });

  if (coordinator) return NextResponse.json(resources.map(toCoordinatorHire));
  for (const r of resources) toPublicResource(r, user?.role ?? null);

  return NextResponse.json(resources);
});

// POST /api/resources -> add a register item (the coordinator: a hire item, no money fields)
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const coordinator = user?.role === "COORDINATOR";
  let body = await req.json();
  if (coordinator) {
    const ok = coordinatorHireWrite(body && typeof body === "object" ? body : {}, null);
    if ("error" in ok) return NextResponse.json({ error: ok.error }, { status: ok.status });
    body = ok.body;
  }

  if (!body.name || !body.type) {
    return NextResponse.json(
      { error: "name and type are required" },
      { status: 400 }
    );
  }

  if (PAY_RATE_FIELDS.some((f) => f in body)) {
    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Only an admin can set pay rate details" }, { status: 403 });
    }
  }

  const data = pickResourceData(body) as Record<string, unknown>;
  const hireError = hireDateError(data as Parameters<typeof hireDateError>[0]);
  if (hireError) return NextResponse.json({ error: hireError }, { status: 400 });
  const registerError = await hireRegisterError(data);
  if (registerError) return NextResponse.json({ error: registerError }, { status: 400 });

  const resource = await prisma.resource.create({
    data: data as any,
  });

  return NextResponse.json(coordinator ? toCoordinatorHire(resource) : resource, { status: 201 });
});
