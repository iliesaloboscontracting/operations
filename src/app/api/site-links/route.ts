import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { hashSecret, newLinkSecret, siteUrl } from "@/lib/siteLinks";

// GET /api/site-links -> every supervisor's link (never the link itself - only
// a hash is stored), newest first.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const links = await prisma.siteLink.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, createdAt: true, createdBy: true, lastUsedAt: true, revokedAt: true,
      resource: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
  });
  return NextResponse.json(links);
});

// POST /api/site-links { resourceId } -> { id, url }
// Makes a new link for a supervisor (someone in charge of a toolbox). The full
// link is returned ONCE, to be sent to them; it can't be looked up again.
// Making a new link switches off that person's old one.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const person = typeof body.resourceId === "string"
    ? await prisma.resource.findUnique({
        where: { id: body.resourceId },
        select: { id: true, type: true, toolboxes: { where: { active: true }, select: { id: true } } },
      })
    : null;
  if (!person || person.type !== "PERSONNEL") return NextResponse.json({ error: "Pick someone from the Personnel register." }, { status: 400 });
  if (person.toolboxes.length === 0) {
    return NextResponse.json({ error: "Site links are for supervisors - make them the supervisor of a toolbox first." }, { status: 400 });
  }
  const secret = newLinkSecret();
  const [, link] = await prisma.$transaction([
    prisma.siteLink.updateMany({ where: { resourceId: person.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), resourceId: person.id, createdBy: user?.name ?? null } }),
  ]);
  return NextResponse.json({ id: link.id, url: siteUrl(secret, req.nextUrl.origin) }, { status: 201 });
});
