import { NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { noAsbestosForBatch } from "@/lib/receipts/batch";

// POST /api/receipts/batches/:id/no-asbestos -> { ok, changed }: "None of this batch is asbestos" (Ilies, 20 Nov 2026,
// option b). Sets not-asbestos on the batch's dockets still unanswered and not set aside; kept with who and when
// (ReceiptBatchEvent). Confirms nothing. Any Manager / Admin.
export const POST = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const out = await noAsbestosForBatch({ id: user.id, name: user.name }, (await paramsP).id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
