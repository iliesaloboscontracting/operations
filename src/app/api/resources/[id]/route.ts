import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, guardOrCoordinator, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { toPublicResource } from "@/lib/serializeResource";
import { applyResourcePatch } from "@/lib/recordPatch";
import { coordinatorHireWrite, toCoordinatorHire } from "@/lib/coordinatorHire";

// PATCH /api/resources/:id
// The COORDINATOR login (2 Nov 2026): hire items only, the hire fields only, no money in or out
// (lib/coordinatorHire.ts) - then the same rules as everyone (lib/recordPatch.ts).
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  let body = await req.json();
  const coordinator = user?.role === "COORDINATOR";
  if (coordinator) {
    const existing = await prisma.resource.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "That item isn't on the register any more." }, { status: 404 });
    const ok = coordinatorHireWrite(body && typeof body === "object" ? body : {}, existing);
    if ("error" in ok) return NextResponse.json({ error: ok.error }, { status: ok.status });
    body = ok.body;
  }
  // The checks and the update live in lib/recordPatch.ts (shared with approved changes, LCI phase 4).
  const out = await applyResourcePatch(params.id, body, { role: user?.role ?? null, name: user?.name ?? null });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  const { resource } = out;
  if (coordinator) return NextResponse.json(toCoordinatorHire(resource));
  toPublicResource(resource, user?.role ?? null);
  return NextResponse.json(resource);
});

// DELETE /api/resources/:id -> soft delete (mark inactive) to keep assignment history.
// Managers and Admins only - the coordinator doesn't archive hire items (Ilies, 2 Nov 2026).
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
