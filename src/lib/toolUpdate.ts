// The one way a tool record is changed after it's registered: the tool form (PATCH /api/tools/:id), the toolbox
// check's "Mark missing" / "Belongs here" (which call that route) and finishing a yard stock take (Yard Stage B,
// 4 Nov 2026 - lib/stockTake/store.ts). The fields a person may set (lib/pickTool.ts), the coordinator / yard's
// hidden-amount rule (lib/toolTextWrite.ts), serial numbers never shared, and a toolbox change only through moveTool
// (logged, "held by" kept in step).
import type { Tool } from "@prisma/client";
import { prisma } from "./prisma";
import { pickTool, toolFieldError } from "./pickTool";
import { keepHiddenAmounts, seesAmountsStripped } from "./toolTextWrite";
import { moveTool } from "./toolMoves";
import { duplicateMessage, findDuplicate, serialKeyOf } from "./toolCreate";
import { updateTracked } from "./history/store";

export type ToolActor = { role: string | null; name: string | null; id?: string | null; source?: string };
export type ToolUpdateError = { error: string; status: number; duplicate?: unknown };

export async function updateTool(id: string, body: Record<string, unknown>, actor: ToolActor): Promise<{ tool: Tool } | ToolUpdateError> {
  const current = await prisma.tool.findUnique({ where: { id }, select: { retiredAt: true } });
  if (!current || current.retiredAt) return { error: "That tool isn't on the register any more.", status: 404 };
  const data = pickTool(body);
  // A toolbox change sets heldBy itself (below), so a heldBy in the same request is ignored.
  if ("toolboxId" in body) delete data.heldBy;
  // The coordinator and the yard computer see the tool with amounts taken out (Ilies, 4 Nov 2026 - the Hire rule): a
  // field sent back as shown is unchanged; changing one that holds an amount they can't see is refused (409).
  if (seesAmountsStripped(actor.role)) {
    const existing = await prisma.tool.findUnique({ where: { id } });
    if (!existing) return { error: "That tool isn't on the register any more.", status: 404 };
    const hidden = keepHiddenAmounts(data, existing as unknown as Record<string, unknown>);
    if (hidden) return hidden;
  }
  const invalid = toolFieldError(data);
  if (invalid) return { error: invalid, status: 400 };
  // Changing the serial: never onto one another tool already has.
  if ("serialNumber" in data) {
    const dup = await findDuplicate(data.serialNumber as string | null | undefined, id);
    if (dup) return { error: duplicateMessage(dup), duplicate: dup, status: 409 };
    data.serialKey = serialKeyOf(data.serialNumber as string | null | undefined);
    if (data.serialKey) data.plateUnreadable = false;
  }
  // A toolbox change goes through moveTool (logged, keeps "held by" in step).
  if ("toolboxId" in body) {
    await moveTool(id, (body.toolboxId as string) || null, typeof body.moveReason === "string" ? body.moveReason : null, actor.name);
  }
  // Every field that changed is kept in the tool's history (keep forever, 10 Nov 2026); a toolbox move is in ToolMovement.
  const tool = await updateTracked<Tool>("Tool", id, data as Record<string, unknown>, { by: { id: actor.id ?? null, name: actor.name }, source: actor.source ?? "Tool edit" });
  return { tool };
}

// Keep forever (Ilies, 10 Nov 2026): a tool is never deleted - Retire keeps it, with its moves, checks and faults, and
// takes it off every list, toolbox and stock take. It leaves its toolbox first (the move is logged as usual).
export async function retireTool(id: string, reason: string, actor: ToolActor): Promise<{ ok: true } | ToolUpdateError> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { error: "Say why the tool is being retired.", status: 400 };
  const tool = await prisma.tool.findUnique({ where: { id }, select: { retiredAt: true, toolboxId: true } });
  if (!tool || tool.retiredAt) return { error: "That tool isn't on the register any more.", status: 404 };
  if (tool.toolboxId) await moveTool(id, null, `Retired - ${why}`, actor.name);
  await updateTracked("Tool", id, { retiredAt: new Date(), retiredBy: actor.name ?? "Operations", retireReason: why, heldBy: "Retired" }, { by: { id: actor.id ?? null, name: actor.name }, source: "Retire tool", reason: why });
  return { ok: true };
}
