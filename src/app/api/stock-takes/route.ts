import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // no amount reaches the coordinator / yard computer
import { withErrorHandling } from "@/lib/apiHandler";
import { listStockTakes, startStockTake } from "@/lib/stockTake/store";
import { isOpenish } from "@/lib/stockTake/rules";

// Yard stock takes (Yard Stage B, Ilies 4 Nov 2026). Same access as the rest of Tools (lib/auth.ts guardTools):
// looking - Viewers and up, the coordinator, the yard computer; starting / counting / finishing / cancelling -
// Managers and up, the coordinator, the yard computer. Logins only - no site link reaches these.
// GET  -> { open, history } (history: finished and cancelled, newest first, with their counts)
// POST { location: "YARD", note? } -> 201 { id }; 409 if the yard already has one open
export const GET = withErrorHandling(async () => {
  const denied = await guardTools("VIEWER");
  if (denied) return denied;
  const all = await listStockTakes();
  // ST-001 (Ilies approved 4 Nov 2026): a stock take being finished is still the open one (FINISHING - resume it).
  return viewJson({ open: all.find((s) => isOpenish(s.status)) ?? null, history: all.filter((s) => !isOpenish(s.status)) });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await startStockTake(typeof body.location === "string" ? body.location : "YARD", body.note, { id: user.id, name: user.name, role: user.role });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
