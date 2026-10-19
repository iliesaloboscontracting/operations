import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// GET /api/tool-issues -> open faults (reported or waiting on a Hilti swap), oldest first.
export const GET = withErrorHandling(async () => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const issues = await prisma.toolIssue.findMany({
    where: { status: { in: ["REPORTED", "SWAP_REQUESTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      tool: {
        select: {
          id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, itemNo: true,
          ownership: true, fleetRef: true, toolbox: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json(issues);
});
