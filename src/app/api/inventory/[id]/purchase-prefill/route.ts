import { NextRequest, NextResponse } from "next/server";
import { guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { purchasePrefill, stockStatus } from "@/lib/inventory/rules";

// GET /api/inventory/:id/purchase-prefill (Yard Stage C, Ilies 4 Nov 2026) - what "Request a purchase" on a
// below-minimum item puts in the ordinary purchase form: { kind: "PURCHASE", what, qty, why }. Only for those who raise
// purchase requests in the app (Managers, Admins, the coordinator - never the yard computer). Nothing is created here:
// the person checks the form and sends it, and the usual approvers, quotes and prices apply (prices live only there).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const it = await prisma.inventoryItem.findUnique({ where: { id: params.id }, select: { name: true, unit: true, onHand: true, minLevel: true, active: true } });
  if (!it || !it.active) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const prefill = purchasePrefill(it);
  if (!prefill) return NextResponse.json({ error: "Set a minimum for it first." }, { status: 400 });
  return NextResponse.json({ prefill, belowMinimum: stockStatus(it) === "BELOW" });
});
