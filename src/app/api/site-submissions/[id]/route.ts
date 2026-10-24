import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// PATCH /api/site-submissions/:id
//   { status: "REJECTED", note? }                 - not used (e.g. duplicate, blurry)
//   { status: "APPLIED", appliedRef }             - REGISTER: after the tool was saved (appliedRef = tool id)
//   { status: "APPLIED", notWorking? }            - FAULT: logs the fault on the tool now
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const sub = await prisma.siteSubmission.findUnique({
    where: { id: params.id },
    include: { siteLink: { select: { label: true, resource: { select: { name: true } } } } },
  });
  if (!sub) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (sub.status !== "PENDING") return NextResponse.json({ error: "This has already been dealt with." }, { status: 409 });

  const done = { reviewedBy: user?.name ?? null, reviewedAt: new Date() };
  if (body.status === "REJECTED") {
    const updated = await prisma.siteSubmission.update({
      where: { id: sub.id },
      data: { ...done, status: "REJECTED", appliedRef: typeof body.note === "string" ? body.note.slice(0, 200) : null },
    });
    return NextResponse.json(updated);
  }
  if (body.status !== "APPLIED") return NextResponse.json({ error: "status must be APPLIED or REJECTED" }, { status: 400 });

  if (sub.kind === "REGISTER") {
    const tool = typeof body.appliedRef === "string" ? await prisma.tool.findUnique({ where: { id: body.appliedRef }, select: { id: true } }) : null;
    if (!tool) return NextResponse.json({ error: "Save the tool first." }, { status: 400 });
    return NextResponse.json(await prisma.siteSubmission.update({ where: { id: sub.id }, data: { ...done, status: "APPLIED", appliedRef: tool.id } }));
  }

  if (sub.kind === "FAULT" && sub.toolId) {
    const photoId = (JSON.parse(sub.photoIds) as string[])[0] ?? null;
    const [issue] = await prisma.$transaction([
      prisma.toolIssue.create({
        data: { toolId: sub.toolId, description: sub.description ?? "", photoId, reportedBy: `${sub.siteLink.resource?.name ?? sub.siteLink.label ?? "Shared link"} (site)` },
      }),
      ...(photoId ? [prisma.toolPhoto.update({ where: { id: photoId }, data: { toolId: sub.toolId } })] : []),
      ...(body.notWorking !== false ? [prisma.tool.update({ where: { id: sub.toolId }, data: { condition: "Needs repair" } })] : []),
    ]);
    return NextResponse.json(await prisma.siteSubmission.update({ where: { id: sub.id }, data: { ...done, status: "APPLIED", appliedRef: issue.id } }));
  }
  return NextResponse.json({ error: "Nothing to apply for this item." }, { status: 400 });
});
