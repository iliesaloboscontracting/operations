import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { moveTool } from "@/lib/toolMoves";

// Where a fault can go next. SWAPPED / FIXED / CLOSED are final.
const NEXT: Record<string, string[]> = {
  REPORTED: ["SWAP_REQUESTED", "FIXED", "CLOSED"],
  SWAP_REQUESTED: ["SWAPPED", "FIXED", "CLOSED"],
};

// PATCH /api/tool-issues/:id { status?, swapRef?, replacementToolId?, resolution? }
// SWAPPED needs the replacement tool (register it by photo first): the
// replacement takes the faulty tool's place in its toolbox, and the faulty
// tool leaves the toolbox marked "Swapped out" (with Hilti).
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const issue = await prisma.toolIssue.findUnique({
    where: { id: params.id },
    include: { tool: { select: { id: true, tag: true, toolboxId: true } } },
  });
  if (!issue) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if ("swapRef" in body) data.swapRef = typeof body.swapRef === "string" && body.swapRef.trim() ? body.swapRef.trim() : null;
  if ("resolution" in body) data.resolution = typeof body.resolution === "string" && body.resolution.trim() ? body.resolution.trim() : null;

  const status = body.status;
  if (status && status !== issue.status) {
    if (!(NEXT[issue.status] ?? []).includes(status)) {
      return NextResponse.json({ error: `A ${issue.status.toLowerCase().replace("_", " ")} fault can't be changed to ${String(status).toLowerCase()}.` }, { status: 409 });
    }
    data.status = status;
    if (["SWAPPED", "FIXED", "CLOSED"].includes(status)) data.resolvedAt = new Date();

    if (status === "SWAPPED") {
      const replacementId = typeof body.replacementToolId === "string" ? body.replacementToolId : "";
      const replacement = replacementId
        ? await prisma.tool.findUnique({ where: { id: replacementId }, select: { id: true, tag: true } })
        : null;
      if (!replacement || replacement.id === issue.tool.id) {
        return NextResponse.json({ error: "Pick the replacement tool Hilti sent (register it first if it's new)." }, { status: 400 });
      }
      data.replacementToolId = replacement.id;
      const by = user?.name ?? null;
      await moveTool(replacement.id, issue.tool.toolboxId, `Hilti swap - replaces ${issue.tool.tag}`, by);
      await moveTool(issue.tool.id, null, `Swapped out with Hilti for ${replacement.tag}`, by);
      await prisma.tool.update({ where: { id: issue.tool.id }, data: { condition: "Swapped out", heldBy: "Hilti" } });
    }
    if (status === "FIXED") {
      await prisma.tool.update({ where: { id: issue.tool.id }, data: { condition: "Good" } });
    }
  }

  const updated = await prisma.toolIssue.update({ where: { id: issue.id }, data });
  return NextResponse.json(updated);
});
