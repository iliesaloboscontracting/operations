import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// PATCH /api/site-links/:id { revoke: true } -> switches the link off for good.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (body.revoke !== true) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const link = await prisma.siteLink.update({ where: { id: params.id }, data: { revokedAt: new Date() } });
  return NextResponse.json({ id: link.id, revokedAt: link.revokedAt });
});
