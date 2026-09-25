import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickServiceRecord } from "@/lib/pickServiceRecord";

// GET /api/resources/:id/service -> that resource's service history, newest first
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const records = await prisma.serviceRecord.findMany({
    where: { resourceId: params.id },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(records);
}

// POST /api/resources/:id/service -> add a service record
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!body.date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }
  const record = await prisma.serviceRecord.create({
    data: { resourceId: params.id, ...pickServiceRecord(body) } as any,
  });
  return NextResponse.json(record, { status: 201 });
}
