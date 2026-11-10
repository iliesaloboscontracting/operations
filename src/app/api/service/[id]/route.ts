import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { hideTracked, updateTracked } from "@/lib/history/store";
import { pickServiceRecord } from "@/lib/pickServiceRecord";
import { withErrorHandling } from "@/lib/apiHandler";

// PATCH /api/service/:id -> edit a service record
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const current = await prisma.serviceRecord.findUnique({ where: { id: params.id }, select: { removedAt: true } });
  if (!current || current.removedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Every field that changed is kept in the record's history (keep forever, 10 Nov 2026).
  const record = await updateTracked("ServiceRecord", params.id, pickServiceRecord(body) as Record<string, unknown>, { by: await getCurrentUser(), source: "Service history edit" });
  return NextResponse.json(record);
});

// DELETE /api/service/:id { reason? } -> keep forever (Ilies, 10 Nov 2026): hidden (removedAt / By / Reason), never
// erased. A record made from an inbox invoice lets go of it, so the same invoice can be linked again.
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const out = await hideTracked("ServiceRecord", params.id, { by: await getCurrentUser(), reason: typeof body?.reason === "string" ? body.reason : null, source: "Service history (remove)" }, { extra: { invoiceDraftId: null } });
  if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
