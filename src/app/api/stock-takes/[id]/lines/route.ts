import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addExtra, dropExtra, lineAction, moveExtraToYard } from "@/lib/stockTake/store";

// POST /api/stock-takes/:id/lines - counting, while the stock take is open (Managers and up, the coordinator, the yard).
//   { action: "FOUND", lineId, conditionSeen? }      ticked by hand (conditionSeen: Good | Needs repair | null = as is)
//   { action: "NOT_FOUND", lineId }                  "not here"
//   { action: "UNTICK", lineId }
//   { action: "CONDITION", lineId, conditionSeen }
//   { action: "ADD_EXTRA", toolId, conditionSeen? }  a tool the register has elsewhere, found here
//   { action: "DROP", lineId }                       an extra added by mistake
//   { action: "MOVE_TO_YARD", lineId }               an extra: the register moves it to the yard (lib/toolMoves.ts)
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const id = (await paramsP).id;
  const user = (await getCurrentUser())!;
  const actor = { id: user.id, name: user.name, role: user.role };
  const body = await req.json().catch(() => ({}));
  const lineId = typeof body.lineId === "string" ? body.lineId : "";
  const conditionSeen = body.conditionSeen === undefined ? null : body.conditionSeen;
  const a = body.action;
  const out =
    a === "FOUND" || a === "NOT_FOUND" || a === "UNTICK" || a === "CONDITION" ? await lineAction(id, lineId, { action: a, conditionSeen }, actor)
    : a === "ADD_EXTRA" ? await addExtra(id, typeof body.toolId === "string" ? body.toolId : "", conditionSeen, actor)
    : a === "DROP" ? await dropExtra(id, lineId)
    : a === "MOVE_TO_YARD" ? await moveExtraToYard(id, lineId, actor)
    : { error: "Unknown action.", status: 400 };
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
