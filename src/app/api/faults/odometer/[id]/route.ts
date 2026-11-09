import { NextRequest, NextResponse } from "next/server";
import { guardFaults } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readReceiptPhoto, receiptMimeOf } from "@/lib/receipts/files";
import { odometerPhoto } from "@/lib/prestart/store";

// GET /api/faults/odometer/:id -> a truck sign-in's odometer photo, for the Checks tab on /faults (stage 1b, 10 Nov
// 2026). Behind a login (guardFaults - Managers, Admins, the coordinator, the yard), never on a link. Only a photo that
// belongs to an odometer reading: tip dockets and fuel receipts stay on Receipts (Manager+).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardFaults();
  if ("denied" in g) return g.denied;
  const p = await odometerPhoto(params.id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bytes = await readReceiptPhoto(p.fileName).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "The photo file is missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": receiptMimeOf(p.fileName), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
});
