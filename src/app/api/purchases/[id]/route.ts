import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnRequest, editOwnRequest, isEditAction } from "@/lib/purchases/store";

// POST /api/purchases/:id - the person who asked, on their own request only (anyone else gets 404):
//   { action: ANSWER (answer) | CANCEL, version }
//   { action: EDIT (what?, why?, qty?, kind?, neededBy?) | ADD_QUOTE (quote) | EDIT_QUOTE (quoteId, quote), version }
//   - the edits only while it's with the approvers (2 Nov 2026).
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const id = (await params).id;
  const who = { name: user.name, userId: user.id };
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
