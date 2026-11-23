import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveBinLink } from "@/lib/siteLinks";
import { uploadBinPhoto } from "@/lib/bins/store";

// POST /api/site/:token/bins/photos { dataUrl } -> { id }
// One bin photo (delivered / picked up) through a supervisor's or DRIVER link, up to a daily limit. Stored like a
// receipt photo (lib/receipts/files.ts: JPEG / PNG / WebP, 8 MB, first bytes checked). Attached when the bin is sent.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveBinLink((await paramsP).token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await uploadBinPhoto(link, body?.dataUrl);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.id }, { status: 201 });
});
