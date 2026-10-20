import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { pickResourceData, PAY_RATE_FIELDS } from "@/lib/resourceFields";
import { hireRegisterError } from "@/lib/hireServer";
import { withErrorHandling } from "@/lib/apiHandler";
import { toPublicResource } from "@/lib/serializeResource";
import { hireDateError } from "@/lib/dateRules";

// PATCH /api/resources/:id
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json();

  if (PAY_RATE_FIELDS.some((f) => f in body)) {
    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Only an admin can change pay rate details" }, { status: 403 });
    }
  }

  const data = pickResourceData(body) as Record<string, unknown>;
  if ("onHireDate" in data || "offHireDate" in data) {
    const existing = await prisma.resource.findUnique({
      where: { id: params.id },
      select: { onHireDate: true, offHireDate: true },
    });
    const hireError = hireDateError({ ...(existing ?? {}), ...data } as Parameters<typeof hireDateError>[0]);
    if (hireError) return NextResponse.json({ error: hireError }, { status: 400 });
  }
  const registerError = await hireRegisterError(data);
  if (registerError) return NextResponse.json({ error: registerError }, { status: 400 });

  const resource = await prisma.resource.update({
    where: { id: params.id },
    data: data as any,
  });
  toPublicResource(resource, user?.role ?? null);
  return NextResponse.json(resource);
});

// DELETE /api/resources/:id -> soft delete (mark inactive) to keep assignment history
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.resource.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ ok: true });
});
