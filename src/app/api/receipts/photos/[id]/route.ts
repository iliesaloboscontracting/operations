import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readReceiptPhoto, receiptMimeOf } from "@/lib/receipts/files";

// GET /api/receipts/photos/:id -> a receipt or odometer photo, Manager+ (dockets can show prices).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const photo = await prisma.receiptPhoto.findUnique({ where: { id: (await paramsP).id }, select: { fileName: true } });
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readReceiptPhoto(photo.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": receiptMimeOf(photo.fileName), "Cache-Control": "private, max-age=86400" },
  });
});
