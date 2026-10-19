// Runs one toolbox check: read the photos, compare with what should be in
// the toolbox (lib/toolboxCheck.ts) and record it. Used by the office page and
// by supervisors on the Site photos page. It changes no tool.
import { prisma } from "./prisma";
import { readToolboxPhotos } from "./toolVision";
import { compareToolbox, type CheckResult } from "./toolboxCheck";

export async function runToolboxCheck(toolboxId: string, photos: { id: string; fileName: string }[], checkedBy: string | null) {
  const reading = await readToolboxPhotos(photos.map((p) => p.fileName));
  const tools = await prisma.tool.findMany({
    where: { condition: { not: "Swapped out" } },
    select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, toolboxId: true, toolbox: { select: { name: true } } },
  });
  const result: CheckResult = compareToolbox(
    toolboxId,
    reading,
    tools.map(({ toolbox, ...t }) => ({ ...t, toolboxName: toolbox?.name ?? null }))
  );
  const check = await prisma.toolboxCheck.create({
    data: { toolboxId, photoIds: JSON.stringify(photos.map((p) => p.id)), result: JSON.stringify(result), checkedBy },
  });
  return { check, result };
}
