import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { offer } from "@/lib/production/store";

// POST /api/production/offer { code, unit } -> offer that code's benchmark to Estimating
// (production-suggestion.v1). The owner or director access only - one deliberate tap per suggestion,
// never automatic. Below the evidence bar it's refused; Estimating down or the key missing -> FAILED,
// nothing marked as offered.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await offer({ id: user.id, name: user.name, directorAccess: user.directorAccess }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error, ...("offer" in out ? { offer: out.offer } : {}) }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
