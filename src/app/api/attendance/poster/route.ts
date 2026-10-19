import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { hashSecret, newLinkSecret, siteUrl } from "@/lib/siteLinks";

// POST /api/attendance/poster { projectId } -> { url, project }
// A new sign-in poster QR for a site. The link is shown once, to print;
// making a new one ("Reprint") switches the old poster off straight away.
// POST /api/attendance/poster { projectId, off: true } switches it off.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const project = typeof body.projectId === "string"
    ? await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true, address: true } })
    : null;
  if (!project) return NextResponse.json({ error: "Pick a project." }, { status: 400 });
  const revokeOld = prisma.siteLink.updateMany({ where: { kind: "POSTER", projectId: project.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (body.off === true) {
    await revokeOld;
    return NextResponse.json({ ok: true });
  }
  const secret = newLinkSecret();
  await prisma.$transaction([
    revokeOld,
    prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), kind: "POSTER", projectId: project.id, label: project.name, createdBy: user?.name ?? null } }),
  ]);
  return NextResponse.json({ url: siteUrl(`in/${secret}`, req.nextUrl.origin), project: project.name, address: project.address }, { status: 201 });
});
