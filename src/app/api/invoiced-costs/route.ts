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
  const out = await readInvoice(body);
  if ("error" in out) return NextResponse.json({ error: out.error, ...(out.removedMatch ? { removedMatch: true } : {}) }, { status: 400 });
  const row = await prisma.invoicedCost.create({ data: { ...out.data, enteredBy: user?.name ?? null } });
  // PS-029: put back on after a removal ("Add again - the removal was wrong") - kept in the new line's history.
  if (out.againOf) await recordAddedAgain(row.id, out.againOf, user, body.addAgainReason, "Add invoice again (Tracking)");
  if (row.category === "TIP_FEES") syncTipMatchesSoon(); // it replaces the dockets it bills (Receipts R3)
  return NextResponse.json(row, { status: 201 });
});
