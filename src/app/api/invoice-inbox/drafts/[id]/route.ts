import { NextRequest, NextResponse } from "next/server";
import { guardInvoiceInbox } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { decideDraft } from "@/lib/invoiceInbox";

// PATCH /api/invoice-inbox/drafts/:id
//   { action: "ADD", fields }  put it on a job (corrections in fields)
//   { action: "SKIP", reason } not a job cost / not ours
//   { action: "UNDO" }         take an added invoice back off its job
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const g = await guardInvoiceInbox();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const act =
    body.action === "ADD" ? { action: "ADD" as const, fields: typeof body.fields === "object" && body.fields ? body.fields : {} }
    : body.action === "SKIP" ? { action: "SKIP" as const, reason: typeof body.reason === "string" ? body.reason : undefined }
    : body.action === "UNDO" ? { action: "UNDO" as const }
    : null;
  if (!act) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const out = await decideDraft(params.id, act, g.user.name);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  return NextResponse.json({ ok: true });
});
