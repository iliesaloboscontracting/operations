import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnRequest } from "@/lib/purchases/store";

// POST /api/accounts/purchases/:id { action: CHECK (amountExGst, accountsNote?) | ASK_INFO (question) |
// CLOSE (reason) | ORDERED (note?), version }
const ACCOUNTS_ACTIONS = ["CHECK", "ASK_INFO", "CLOSE", "ORDERED"] as const;
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const action = ACCOUNTS_ACTIONS.find((a) => a === b.action);
  if (!action) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const out = await actOnRequest((await params).id, action, { kind: "ACCOUNTS" }, { name: g.user.name, userId: g.user.id }, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
