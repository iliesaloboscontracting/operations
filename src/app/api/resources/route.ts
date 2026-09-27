import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { pickResourceData, PAY_RATE_FIELDS } from "@/lib/resourceFields";
import { withErrorHandling } from "@/lib/apiHandler";

// GET /api/resources?type=PERSONNEL,EQUIPMENT&category=LABOUR
// Includes assignments (+ job) so the UI can show "where is it today".
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const type = req.nextUrl.searchParams.get("type");
  const category = req.nextUrl.searchParams.get("category");

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

  // Individual pay rate is sensitive personal compensation data - only an
  // Admin gets it in the response at all, regardless of who can otherwise
  // view this register.
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") {
    for (const r of resources) {
      for (const f of PAY_RATE_FIELDS) delete (r as Record<string, unknown>)[f];
    }
  }

  return NextResponse.json(resources);
});

// POST /api/resources -> add a register item
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();

  if (!body.name || !body.type) {
    return NextResponse.json(
      { error: "name and type are required" },
      { status: 400 }
    );
  }

  if (PAY_RATE_FIELDS.some((f) => f in body)) {
    const user = await getCurrentUser();
    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Only an admin can set pay rate details" }, { status: 403 });
    }
  }

  const resource = await prisma.resource.create({
    data: pickResourceData(body) as any,
  });

  return NextResponse.json(resource, { status: 201 });
});
