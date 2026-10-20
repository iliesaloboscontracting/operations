import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { hashSecret, newLinkSecret, siteUrl } from "@/lib/siteLinks";
import { createHandover } from "@/lib/signin";
import { isLead } from "@/lib/leads";

// GET /api/site-links -> every supervisor's link (never the link itself - only
// a hash is stored), newest first.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  // Phone links only - site posters and one-day hand-overs live on Sign-ins.
  const links = await prisma.siteLink.findMany({
    where: { kind: { in: ["SUPERVISOR", "OFFICE"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, kind: true, label: true, createdAt: true, createdBy: true, lastUsedAt: true, revokedAt: true,
      resource: { select: { id: true, name: true } },
      _count: { select: { submissions: true } },
    },
  });
  return NextResponse.json(links);
});

// POST /api/site-links { resourceId, kind? } | { shared: "Yard" } -> { id, url }
// kind SUPERVISOR (default): for someone in charge of a toolbox.
// kind OFFICE: for office / yard staff capturing tools into the inventory -
// anyone in the Personnel register.
// shared "Yard" (19 Oct 2026): one office/yard link not tied to a person -
// anyone working in the yard uses it and types their name on the phone.
// The full link is returned ONCE, to be sent to them; it can't be looked up
// again. Making a new link switches off that person's old one of the same kind.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  // { kind: "HANDOVER", resourceId, jobId }: the office hands a job's sign-in to
  // a stand-in lead for the day (lib/signin.ts).
  if (body.kind === "HANDOVER") {
    const out = await createHandover(String(body.jobId ?? ""), String(body.resourceId ?? ""), user?.name ?? null);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json({ url: siteUrl(out.secret, req.nextUrl.origin), name: out.name }, { status: 201 });
  }
  if (body.shared !== undefined) {
    if (body.shared !== "Yard") return NextResponse.json({ error: "Unknown shared link." }, { status: 400 });
    const secret = newLinkSecret();
    const [, link] = await prisma.$transaction([
      prisma.siteLink.updateMany({ where: { resourceId: null, label: "Yard", revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), label: "Yard", kind: "OFFICE", createdBy: user?.name ?? null } }),
    ]);
    return NextResponse.json({ id: link.id, url: siteUrl(secret, req.nextUrl.origin) }, { status: 201 });
  }
  const person = typeof body.resourceId === "string"
    ? await prisma.resource.findUnique({
        where: { id: body.resourceId },
        select: { id: true, type: true, category: true, role: true, toolboxes: { where: { active: true }, select: { id: true } } },
      })
    : null;
  if (!person || person.type !== "PERSONNEL") return NextResponse.json({ error: "Pick someone from the Personnel register." }, { status: 400 });
  const kind = body.kind === "OFFICE" ? "OFFICE" : "SUPERVISOR";
  // Supervisor links: anyone in charge of a toolbox, or a Site Manager /
  // supervisor (they run crew sign-in even without a toolbox).
  const leads = person.toolboxes.length > 0 || isLead(person);
  if (kind === "SUPERVISOR" && !leads) {
    return NextResponse.json({ error: "Supervisor links are for site managers and supervisors - set them as a Site Manager or give them a toolbox first." }, { status: 400 });
  }
  const secret = newLinkSecret();
  const [, link] = await prisma.$transaction([
    prisma.siteLink.updateMany({ where: { resourceId: person.id, kind, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), resourceId: person.id, kind, createdBy: user?.name ?? null } }),
  ]);
  return NextResponse.json({ id: link.id, url: siteUrl(secret, req.nextUrl.origin) }, { status: 201 });
});
