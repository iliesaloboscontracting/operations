import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { toPublicResource } from "@/lib/serializeResource";
import { applyResourcePatch } from "@/lib/recordPatch";

// PATCH /api/resources/:id
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();
  // The checks and the update live in lib/recordPatch.ts (shared with approved changes, LCI phase 4).
  const out = await applyResourcePatch(params.id, body, { role: user?.role ?? null });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  const { resource } = out;
  toPublicResource(resource, user?.role ?? null);
  return NextResponse.json(resource);
});

// DELETE /api/resources/:id -> soft delete (mark inactive) to keep assignment history
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.resource.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ ok: true });
});
