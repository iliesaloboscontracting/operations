import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { NEXT_BODY_LIMIT, UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";
import { addBatchPhoto } from "@/lib/receipts/batch";

// POST /api/receipts/batches/:id { dataUrl } -> { id }: one photo of the batch (one per request, 7 MB a file) becomes a
// TIP receipt, read in the background like a phone-sent docket. Only the batch's own uploader, while it's open.
// 409 = the same photo is already in; 429 = a cap. Manager+.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  // The size is checked before the body is read.
  if (Number(req.headers.get("content-length") ?? 0) > NEXT_BODY_LIMIT) return NextResponse.json({ error: UPLOAD_TOO_LARGE }, { status: 413 });
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const out = await addBatchPhoto({ id: user.id, name: user.name }, (await paramsP).id, read.b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
