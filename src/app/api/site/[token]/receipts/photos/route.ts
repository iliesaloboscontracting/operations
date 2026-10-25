import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveReceiptLink } from "@/lib/siteLinks";
import { uploadReceiptPhoto } from "@/lib/receipts/store";

// POST /api/site/:token/receipts/photos { dataUrl } -> { id }
// One receipt photo through a supervisor's or DRIVER link, up to a daily limit. It's attached when
// the receipt is sent.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await paramsP).token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await uploadReceiptPhoto(link, body?.dataUrl);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.id }, { status: 201 });
});
