import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnItem } from "@/lib/accounts/store";

// POST /api/accounts/items/:id { action: EDIT (fields) | DONE | CANCEL | REOPEN }
// DONE on a repeating item moves it to its next date; a one-off closes.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await actOnItem(g.user.name, (await params).id, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
