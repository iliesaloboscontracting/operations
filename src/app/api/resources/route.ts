import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickResourceData } from "@/lib/resourceFields";
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

  const resource = await prisma.resource.create({
    data: pickResourceData(body) as any,
  });

  return NextResponse.json(resource, { status: 201 });
});
