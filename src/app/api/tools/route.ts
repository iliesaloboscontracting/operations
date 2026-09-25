import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { pickTool } from "@/lib/pickTool";
import { withErrorHandling } from "@/lib/apiHandler";

export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const tools = await prisma.tool.findMany({ orderBy: { tag: "asc" } });
  return NextResponse.json(tools);
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json();
  if (!body.tag || !body.name) {
    return NextResponse.json({ error: "tag and name are required" }, { status: 400 });
  }
  // pickTool()/prisma.tool.create() throwing on a duplicate tag is now caught by
  // withErrorHandling's P2002 branch - this try/catch just keeps the message
  // specific to "tag", which the shared handler's generic wording can't know.
  try {
    const tool = await prisma.tool.create({ data: pickTool(body) as any });
    return NextResponse.json(tool, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "That tag already exists" }, { status: 409 });
    }
    throw err;
  }
});
