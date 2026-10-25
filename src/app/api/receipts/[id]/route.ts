import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { receiptAction } from "@/lib/receipts/office";

// POST /api/receipts/:id  (type: "ODOMETER" for an odometer reading)
//   { op: "CORRECT", fields: {...}, confirm? } -> correct what was read (kept with who and when)
//   { op: "CONFIRM" }                          -> it's right
//   { op: "REJECT", reason }                   -> set aside (not counted)
//   { op: "READ_AGAIN" }                       -> Claude reads it again (not after a person corrected it)
// Manager+.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await receiptAction({ name: user.name }, (await paramsP).id, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
