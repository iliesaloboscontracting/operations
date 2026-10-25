import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeList } from "@/lib/receipts/store";

// GET /api/receipts?day=&jobId=&vehicleId=&person=&kind=TIP|FUEL|ODOMETER&asbestos=yes|no
// The office list of receipts and odometer photos (R1: photos only - reading comes in R2). Manager+.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const pick = (k: string) => q.get(k)?.slice(0, 100) || undefined;
  return NextResponse.json(await officeList({ day: pick("day"), jobId: pick("jobId"), vehicleId: pick("vehicleId"), person: pick("person"), kind: pick("kind"), asbestos: pick("asbestos") }));
});
