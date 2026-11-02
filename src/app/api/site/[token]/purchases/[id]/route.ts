import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnRequest, editOwnRequest, isEditAction } from "@/lib/purchases/store";
import { officePurchasesLink } from "@/lib/purchases/link";
import { purchaseBody } from "@/lib/purchases/serve";

// POST /api/site/:token/purchases/:id - only on the OFFICE link it was asked from:
//   { action: ANSWER (answer) | CANCEL, version }
//   { action: EDIT | ADD_QUOTE | EDIT_QUOTE, ... } - while it's with the approvers (2 Nov 2026).
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) => {
  const { token, id } = await params;
  const link = await officePurchasesLink(token);
  if (!link) return NextResponse.json({ error: "Not on this link." }, { status: 404 });
  const read = await purchaseBody(req); // 413 "Too large" when the body can't be read (7 MB option A)
  if ("denied" in read) return read.denied;
  const b = read.b;
  const who = { name: link.person.name, linkId: link.id };
  if (isEditAction(b.action)) {
    const out = await editOwnRequest(id, b.action, who, b);
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json(out);
  }
  if (b.action !== "ANSWER" && b.action !== "CANCEL") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const out = await actOnRequest(id, b.action, { kind: "REQUESTER" }, who, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
