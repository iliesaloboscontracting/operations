import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addRate, listRates } from "@/lib/oncosts/store";

// On-cost rates (stage 3). Accounts and Admins see them; only an Admin enters one.
// GET -> each line with the rate in force today (or not set), and the full history.
// POST { line, label?, percent, base?, appliesTo?, thresholdRule?, thresholdAnnual?, effectiveFrom, note? }
export const GET = withErrorHandling(async () => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await listRates());
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  if (g.user.role !== "ADMIN") return NextResponse.json({ error: "Only an Admin enters on-cost rates." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const out = await addRate({ id: g.user.id, name: g.user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
