import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { retireRate } from "@/lib/receipts/tipStore";

// POST /api/tip-rates/:id { op: "RETIRE", reason } -> a mistyped or wrong rate stops counting (kept,
// never deleted). Admin only.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  if (body?.op !== "RETIRE") return NextResponse.json({ error: "Retire is the only change - a new price is a new rate." }, { status: 400 });
  const out = await retireRate({ name: user.name }, (await paramsP).id, body.reason);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
