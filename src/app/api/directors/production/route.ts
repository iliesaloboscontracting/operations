import { NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { productionView } from "@/lib/production/store";
import { EVIDENCE_BAR } from "@/lib/production/benchmarks";

// GET /api/directors/production -> the same production benchmarks as Operations -> Production (LCI 5b,
// productionView(), no new maths), for the Directors screen. Director access; read-only, hours only. There's
// no offering from here - offering stays with the owner and director-access Admins in Operations.
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  return NextResponse.json({ ...(await productionView()), bar: EVIDENCE_BAR });
});
