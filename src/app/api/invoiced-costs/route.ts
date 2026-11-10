import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readInvoice, recordAddedAgain } from "@/lib/invoicedCosts";
import { syncTipMatchesSoon } from "@/lib/receipts/tipStore";

// POST /api/invoiced-costs - add a supplier invoice to a project (Manager+;
// Tracking is a money view). Rules in lib/invoicedCosts.ts.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const out = await readInvoice(body, undefined, { role: user?.role ?? null });
  if ("error" in out) return NextResponse.json({ error: out.error, ...(out.removedMatch ? { removedMatch: true, removed: out.removed } : {}) }, { status: out.status ?? 400 });
  // PS-029 / PS-036: put back on after a removal (Admin, "Add again") - the line and its history row in one transaction.
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.invoicedCost.create({ data: { ...out.data, enteredBy: user?.name ?? null } });
    if (out.againOf) await recordAddedAgain(tx, r.id, out.againOf, user, body.addAgainReason, "Add invoice again (Tracking)");
    return r;
  });
  if (row.category === "TIP_FEES") syncTipMatchesSoon(); // it replaces the dockets it bills (Receipts R3)
  return NextResponse.json(row, { status: 201 });
});
