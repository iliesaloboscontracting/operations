import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createRequest, listForAccounts, projectChoices } from "@/lib/purchases/store";

// Accounts -> Purchases (stage 6, docs/accounts/STAGE6-DESIGN.md §3). The ACCOUNTS login and Admins only.
// GET  -> approved requests to order, and the history (amounts included). Approving is Ilies's / the directors'
//         (28 Oct 2026) - accounts no longer check first.
// POST { what, why?, qty?, supplier?, linkUrl?, neededBy?, projectId? } -> a request made by accounts.
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json({ ...(await listForAccounts()), projects: await projectChoices() });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await createRequest({ kind: "APP", userId: g.user.id, name: g.user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
