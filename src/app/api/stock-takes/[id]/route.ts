import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // no amount reaches the coordinator / yard computer
import { withErrorHandling } from "@/lib/apiHandler";
import { cancelStockTake, finishStockTake, getStockTake, setNote } from "@/lib/stockTake/store";

const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

// GET /api/stock-takes/:id -> the stock take with every line (read-only once finished or cancelled).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardTools("VIEWER");
  if (denied) return denied;
  const s = await getStockTake((await paramsP).id);
  if (!s) return NextResponse.json({ error: "That stock take isn't there." }, { status: 404 });
  return viewJson(s);
});

// POST /api/stock-takes/:id
//   { action: "NOTE", note }
//   { action: "CANCEL" }                                  nothing on the register changes
//   { action: "FINISH", missing: [lineId], leave: [lineId], note? }
//     every tool not found must be in missing (confirmed - set to Missing) or leave (left as it is), or 409 with
//     { undecided }. Found tools' conditions are applied through the ordinary tool update (lib/toolUpdate.ts).
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const id = (await paramsP).id;
  const user = (await getCurrentUser())!;
  const actor = { id: user.id, name: user.name, role: user.role };
  const body = await req.json().catch(() => ({}));
  const out =
    body.action === "NOTE" ? await setNote(id, body.note, actor)
    : body.action === "CANCEL" ? await cancelStockTake(id, actor)
    : body.action === "FINISH" ? await finishStockTake(id, { missing: strings(body.missing), leave: strings(body.leave) }, body.note, actor)
    : { error: "Unknown action.", status: 400 };
  if ("error" in out) return NextResponse.json("undecided" in out && out.undecided ? { error: out.error, undecided: out.undecided } : { error: out.error }, { status: out.status });
  return viewJson(out);
});
