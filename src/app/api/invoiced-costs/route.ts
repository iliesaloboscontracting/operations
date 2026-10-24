import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readInvoice } from "@/lib/invoicedCosts";

// POST /api/invoiced-costs - add a supplier invoice to a project (Manager+;
// Tracking is a money view). Rules in lib/invoicedCosts.ts.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const out = await readInvoice(body);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  const row = await prisma.invoicedCost.create({ data: { ...out.data, enteredBy: user?.name ?? null } });
  return NextResponse.json(row, { status: 201 });
});
