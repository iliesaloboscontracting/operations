import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickTool } from "@/lib/pickTool";

export async function GET() {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const tools = await prisma.tool.findMany({ orderBy: { tag: "asc" } });
  return NextResponse.json(tools);
}

export async function POST(req: NextRequest) {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  if (!body.tag || !body.name) {
    return NextResponse.json({ error: "tag and name are required" }, { status: 400 });
  }
  try {
    const tool = await prisma.tool.create({ data: pickTool(body) as any });
    return NextResponse.json(tool, { status: 201 });
  } catch {
    return NextResponse.json({ error: "That tag already exists" }, { status: 409 });
  }
}
