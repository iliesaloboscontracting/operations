import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardTipsOrManager } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readReceiptPhoto, receiptMimeOf } from "@/lib/receipts/files";
import { tipsOnlyMayViewPhoto } from "@/lib/receipts/tipsAccess";

// GET /api/receipts/photos/:id -> a receipt or odometer photo, Manager+ (dockets can show prices). The coordinator
// (Ilies approved 25 Nov 2026): only a photo on a TIP docket that isn't own money - anything else is 404 for him.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardTipsOrManager();
  if ("denied" in g) return g.denied;
  const photo = await prisma.receiptPhoto.findUnique({
    where: { id: (await paramsP).id },
    select: { fileName: true, odometerReadingId: true, receipt: { select: { kind: true, ownMoney: true } } },
  });
  if (!photo || (g.tipsOnly && !tipsOnlyMayViewPhoto(photo))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readReceiptPhoto(photo.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": receiptMimeOf(photo.fileName), "Cache-Control": "private, max-age=86400" },
  });
});
