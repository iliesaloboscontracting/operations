import { NextRequest, NextResponse } from "next/server";
import { guardVariations } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeList, toPriceCard } from "@/lib/variations/store";

// GET /api/variations?projectId=&status=TO_PRICE|PRICED|SENT_TO_CLIENT -> the signed dockets, newest first
// GET /api/variations?summary=1 -> the coordinator's "Variations to price" card (how many, the latest few)
// Managers, Admins (the owner) and the coordinator only (guardVariations). No prices anywhere in this feature.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardVariations();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams;
  if (q.get("summary") === "1") return NextResponse.json(await toPriceCard());
  const pick = (k: string) => q.get(k)?.slice(0, 40) || undefined;
  return NextResponse.json(await officeList({ projectId: pick("projectId"), status: pick("status") }));
});
