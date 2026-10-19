// The only way a tool changes toolbox: updates its home toolbox, keeps
// "held by" in step (the toolbox's supervisor, or Yard), and logs the move.
import { prisma } from "./prisma";

export async function moveTool(toolId: string, toToolboxId: string | null, reason: string | null, movedBy: string | null) {
  const tool = await prisma.tool.findUnique({
    where: { id: toolId },
    select: { toolboxId: true, toolbox: { select: { name: true } } },
  });
  if (!tool) throw new Error("That tool doesn't exist anymore.");
  if (tool.toolboxId === toToolboxId) return;
  const target = toToolboxId
    ? await prisma.toolbox.findUnique({
        where: { id: toToolboxId },
        select: { name: true, supervisor: { select: { name: true } } },
      })
    : null;
  if (toToolboxId && !target) throw new Error("That toolbox doesn't exist anymore.");
  await prisma.$transaction([
    prisma.tool.update({
      where: { id: toolId },
      data: { toolboxId: toToolboxId, heldBy: target ? target.supervisor?.name ?? target.name : "Yard" },
    }),
    prisma.toolMovement.create({
      data: {
        toolId,
        fromToolboxId: tool.toolboxId,
        toToolboxId,
        fromName: tool.toolbox?.name ?? "Yard",
        toName: target?.name ?? "Yard",
        reason,
        movedBy,
      },
    }),
  ]);
}
