import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { viewJson } from "@/lib/coordinatorView";
import { recordMovement } from "@/lib/inventory/store";

// POST /api/inventory/:id/movements (Yard Stage C, Ilies 4 Nov 2026) - Managers and up, the coordinator, the yard
// computer (guardTools("MANAGER")):
//   { kind: "IN", qty, reason? }                  - stock received
//   { kind: "OUT", qty, projectId?, reason? }     - taken out (to a site); never below zero ("Count it first")
//   { kind: "COUNT", countedQty, reason? }        - counted the shelf: the stock is set to it
// Every one is recorded with who and when; 409 if the stock changed since it was read.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const out = await recordMovement(params.id, await req.json().catch(() => ({})), { id: user.id, name: user.name });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return viewJson(out, { status: 201 });
});
