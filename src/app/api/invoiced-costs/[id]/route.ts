import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readInvoice, removeInvoicedCost } from "@/lib/invoicedCosts";
import { syncTipMatchesSoon } from "@/lib/receipts/tipStore";

// PATCH /api/invoiced-costs/:id - correct an entered invoice (Manager+). The
// whole invoice is re-checked as one, same rules as adding it.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const existing = await prisma.invoicedCost.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await readInvoice({ ...existing, ...body }, existing.id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  const row = await prisma.invoicedCost.update({ where: { id: existing.id }, data: { ...out.data, enteredBy: user?.name ?? null } });
  if (row.category === "TIP_FEES" || existing.category === "TIP_FEES") syncTipMatchesSoon(); // re-match its dockets (Receipts R3)
  return NextResponse.json(row);
});

// DELETE /api/invoiced-costs/:id - remove an invoice entered by mistake.
// Admin only: it takes real cost off a project.
export const DELETE = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("ADMIN");
  if (denied) return denied;
  // The same code as an approved "Remove supplier invoice" change (lib/invoicedCosts.ts).
  const out = await removeInvoicedCost(params.id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
