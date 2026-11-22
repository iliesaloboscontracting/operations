import { NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { noAsbestosForBatch } from "@/lib/receipts/batch";

// POST /api/receipts/batches/:id/no-asbestos -> { ok, changed, leftAsbestos, waiting }: "None of this batch is asbestos"
// (Ilies, 20 Nov 2026, option b; narrowed by DB-006, 23 Nov 2026). Sets not-asbestos on the batch's dockets still
// unanswered, not set aside, already read and not saying asbestos; leftAsbestos = ones that say asbestos (answered one by
// one), waiting = ones not read yet. Kept with who, when and which (ReceiptBatchEvent). Confirms nothing. Any Manager / Admin.
export const POST = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const out = await noAsbestosForBatch({ id: user.id, name: user.name }, (await paramsP).id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
