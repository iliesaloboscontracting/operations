import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { hashSecret, newLinkSecret, siteUrl } from "@/lib/siteLinks";

// POST /api/attendance/poster -> { url, title, subtitle, place }
//   { projectId }                 a site's sign-in poster
//   { place: "OFFICE" | "YARD" }  the office / yard sign-in QR
//   { vehicleId }                 a Lobos-owned truck's QR (for the cab)
// The link is shown once, to print; making a new one ("Reprint") switches
// the old one off straight away. Add { off: true } to just switch it off.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));

  let target: { where: Record<string, unknown>; data: Record<string, unknown>; title: string; subtitle: string | null; place: string | null };
  if (typeof body.projectId === "string") {
    const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true, address: true } });
    if (!project) return bad("Pick a project.");
    target = { where: { projectId: project.id }, data: { projectId: project.id, label: project.name }, title: project.name, subtitle: project.address, place: null };
  } else if (body.place === "OFFICE" || body.place === "YARD") {
    const name = body.place === "OFFICE" ? "Office" : "Yard";
    target = { where: { place: body.place }, data: { place: body.place, label: name }, title: `Lobos ${name}`, subtitle: null, place: body.place };
  } else if (typeof body.vehicleId === "string") {
    const truck = await prisma.resource.findUnique({ where: { id: body.vehicleId }, select: { id: true, name: true, type: true, ownership: true, identifier: true, category: true } });
    // Lobos-owned trucks only (Ilies, 20 Oct 2026) - not trailers ("Other").
    if (!truck || truck.type !== "VEHICLE" || truck.ownership !== "OWNED" || truck.category === "Other") return bad("Truck QRs are for Lobos-owned trucks only.");
    target = {
      where: { place: "VEHICLE", resourceId: truck.id },
      data: { place: "VEHICLE", resourceId: truck.id, label: truck.name },
      title: truck.name,
      subtitle: truck.identifier ? `Rego ${truck.identifier}` : null,
      place: "VEHICLE",
    };
  } else {
    return bad("Pick a site, the office, the yard or a truck.");
  }

  const revokeOld = prisma.siteLink.updateMany({ where: { kind: "POSTER", revokedAt: null, ...target.where }, data: { revokedAt: new Date() } });
  if (body.off === true) {
    await revokeOld;
    return NextResponse.json({ ok: true });
  }
  const secret = newLinkSecret();
  await prisma.$transaction([
    revokeOld,
    prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), kind: "POSTER", createdBy: user?.name ?? null, ...target.data } }),
  ]);
  return NextResponse.json(
    { url: siteUrl(`in/${secret}`, req.nextUrl.origin), title: target.title, subtitle: target.subtitle, place: target.place },
    { status: 201 }
  );
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
