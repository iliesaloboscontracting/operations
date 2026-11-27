import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readReceiptPhoto, receiptMimeOf } from "@/lib/receipts/files";

// GET /api/bins/tipper-loads/photos/:id -> a tipper load photo - Managers, Admins and the coordinator, who read the Bins
// page. Only photos attached to a load; a phone never loads one back.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const photo = await prisma.tipperLoadPhoto.findUnique({ where: { id: (await paramsP).id }, select: { fileName: true, loadId: true } });
  if (!photo || !photo.loadId) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readReceiptPhoto(photo.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": receiptMimeOf(photo.fileName), "Cache-Control": "private, max-age=86400" },
  });
});
