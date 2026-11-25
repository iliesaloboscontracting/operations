import { NextResponse } from "next/server";
import { guardTipsOrManager } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { noAsbestosForBatch } from "@/lib/receipts/batch";

// POST /api/receipts/batches/:id/no-asbestos -> { ok, changed, leftAsbestos, waiting }: "None of this batch is asbestos"
// (Ilies, 20 Nov 2026, option b; narrowed by DB-006, 23 Nov 2026). Sets not-asbestos on the batch's dockets still
// unanswered, not set aside, already read and not saying asbestos; leftAsbestos = ones that say asbestos (answered one by
// one), waiting = ones not read yet. Kept with who, when and which (ReceiptBatchEvent). Confirms nothing. Any Manager / Admin,
// and the coordinator (Ilies approved 25 Nov 2026) - a batch holds tip dockets only, and the store touches kind TIP only.
export const POST = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardTipsOrManager();
  if ("denied" in g) return g.denied;
  const out = await noAsbestosForBatch({ id: g.user.id, name: g.user.name }, (await paramsP).id);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
