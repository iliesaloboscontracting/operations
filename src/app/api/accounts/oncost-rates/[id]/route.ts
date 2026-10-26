import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { retireRate } from "@/lib/oncosts/store";

// POST /api/accounts/oncost-rates/:id { reason } -> retire a wrong rate (Admin only). Never edited or deleted.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  if (g.user.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin retires on-cost rates." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const out = await retireRate({ id: g.user.id, name: g.user.name }, (await paramsP).id, body?.reason);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
