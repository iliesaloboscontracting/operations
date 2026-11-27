import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveBinLink } from "@/lib/siteLinks";
import { tipperLoadsOn } from "@/lib/bins/tipperRules";
import { isDriverLink, uploadTipperPhoto } from "@/lib/bins/tipperStore";

// POST /api/site/:token/tipper-loads/photos { dataUrl } -> { id }
// One photo of a tipper load through a DRIVER link, up to a daily limit. Stored like a receipt / bin photo
// (lib/receipts/files.ts: JPEG / PNG / WebP, 8 MB, first bytes checked, RECEIPT_FILE_DIR). Attached when the load is sent.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveBinLink((await paramsP).token);
  if (!isDriverLink(link)) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  if (!tipperLoadsOn()) return NextResponse.json({ error: "Tipper loads are switched off for now - call the office." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const out = await uploadTipperPhoto(link, body?.dataUrl);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.id }, { status: 201 });
});
