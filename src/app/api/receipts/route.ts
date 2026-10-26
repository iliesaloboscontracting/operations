import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeList } from "@/lib/receipts/store";
import { jobsForCorrection } from "@/lib/receipts/office";
import { tipMismatches } from "@/lib/receipts/tipStore";
import { jobIndicators, truckIndicatorList } from "@/lib/receipts/indicatorStore";

// GET /api/receipts?day=&jobId=&vehicleId=&person=&kind=TIP|FUEL|ODOMETER&asbestos=yes|no&check=1
// The office list of receipts and odometer photos, with what was read (R2). check=1 -> "Check these".
// GET /api/receipts?jobs=1&current=<jobId> -> jobs a tip docket can be moved to. Manager+ (prices).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const pick = (k: string) => q.get(k)?.slice(0, 100) || undefined;
  if (q.get("jobs") === "1") return NextResponse.json({ jobs: await jobsForCorrection(pick("current") ?? null) });
  // Tip dockets vs tip invoices, both ways (R3).
  if (q.get("mismatches") === "1") return NextResponse.json(await tipMismatches());
  // Indicators (R4): per job (tip loads, tonnes, cost, $/t, asbestos) and per truck (km, fuel, L/100 km).
  // vehicleId=<id> -> just that truck (the Vehicles register).
  if (q.get("indicators") === "1") {
    const vehicleId = pick("vehicleId");
    return NextResponse.json(vehicleId ? { trucks: await truckIndicatorList(vehicleId) } : { jobs: await jobIndicators(), trucks: await truckIndicatorList() });
  }
  return NextResponse.json(await officeList({ day: pick("day"), jobId: pick("jobId"), vehicleId: pick("vehicleId"), person: pick("person"), kind: pick("kind"), asbestos: pick("asbestos"), check: pick("check") }));
});
