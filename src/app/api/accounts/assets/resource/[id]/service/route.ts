import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { linkInvoice } from "@/lib/assets/store";

// POST /api/accounts/assets/resource/:id/service { invoiceDraftId } -> link a mechanic's invoice from the
// invoices inbox as a service on this vehicle / plant item. 409 when that invoice is already linked.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const draftId = body && typeof body.invoiceDraftId === "string" ? body.invoiceDraftId : "";
  if (!draftId) return NextResponse.json({ error: "Pick the invoice." }, { status: 400 });
  const out = await linkInvoice(g.user.name, (await params).id, draftId);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
