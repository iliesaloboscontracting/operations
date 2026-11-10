import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readInvoice, removeInvoicedCost } from "@/lib/invoicedCosts";
import { syncTipMatchesSoon } from "@/lib/receipts/tipStore";
import { updateTracked } from "@/lib/history/store";

// PATCH /api/invoiced-costs/:id - correct an entered invoice (Manager+). The
// whole invoice is re-checked as one, same rules as adding it.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const existing = await prisma.invoicedCost.findUnique({ where: { id: params.id } });
  if (!existing || existing.removedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await readInvoice({ ...existing, ...body }, existing.id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  // Every field that changed is kept in the invoice line's history (keep forever, 10 Nov 2026).
  const row = await updateTracked("InvoicedCost", existing.id, { ...out.data, enteredBy: user?.name ?? null }, { by: user, source: "Invoice correction (Tracking)" }) as { category: string };
  if (row.category === "TIP_FEES" || existing.category === "TIP_FEES") syncTipMatchesSoon(); // re-match its dockets (Receipts R3)
  return NextResponse.json(row);
});

// DELETE /api/invoiced-costs/:id { reason? } - remove an invoice entered by mistake.
// Admin only: it takes real cost off a project. Keep forever (10 Nov 2026): hidden from every total, never erased.
export const DELETE = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : null;
  // The same code as an approved "Remove supplier invoice" change (lib/invoicedCosts.ts).
  const out = await removeInvoicedCost(params.id, { by: user, reason, source: "Remove invoice (Tracking)" });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
