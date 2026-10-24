import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readInvoice } from "@/lib/invoicedCosts";

// PATCH /api/invoiced-costs/:id - correct an entered invoice (Manager+). The
// whole invoice is re-checked as one, same rules as adding it.
export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const existing = await prisma.invoicedCost.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await readInvoice({ ...existing, ...body }, existing.id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  const row = await prisma.invoicedCost.update({ where: { id: existing.id }, data: { ...out.data, enteredBy: user?.name ?? null } });
  return NextResponse.json(row);
});

// DELETE /api/invoiced-costs/:id - remove an invoice entered by mistake.
// Admin only: it takes real cost off a project.
export const DELETE = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const existing = await prisma.invoicedCost.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.invoicedCost.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
});
