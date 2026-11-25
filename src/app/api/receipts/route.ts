import { NextRequest, NextResponse } from "next/server";
import { guardTipsOrManager } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeList } from "@/lib/receipts/store";
import { jobsForCorrection } from "@/lib/receipts/office";
import { tipMismatches } from "@/lib/receipts/tipStore";
import { projectChoices } from "@/lib/purchases/store";
import { jobIndicators, truckIndicatorList } from "@/lib/receipts/indicatorStore";
import { filtersFor, indicatorsFor } from "@/lib/receipts/tipsAccess";

const FORBIDDEN = () => NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });

// GET /api/receipts?day=&jobId=&vehicleId=&person=&kind=TIP|FUEL|ODOMETER&asbestos=yes|no&check=1
// The office list of receipts and odometer photos, with what was read (R2). check=1 -> "Check these".
// GET /api/receipts?jobs=1&current=<jobId> -> jobs a tip docket can be moved to. Manager+ (prices).
// The coordinator (Ilies approved 25 Nov 2026, tipsOnly): tip dockets only - kind is forced to TIP, no truck filter,
// no batch project picker (starting a batch stays Manager+), indicators per job only and never a truck.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardTipsOrManager();
  if ("denied" in g) return g.denied;
  const { tipsOnly } = g;
  const q = req.nextUrl.searchParams;
  const pick = (k: string) => q.get(k)?.slice(0, 100) || undefined;
  if (q.get("jobs") === "1") return NextResponse.json({ jobs: await jobsForCorrection(pick("current") ?? null, pick("projectId") ?? null) });
  // The projects a batch of dockets can be uploaded for (the office project picker: not archived, all statuses).
  if (q.get("batchProjects") === "1") return tipsOnly ? FORBIDDEN() : NextResponse.json({ projects: await projectChoices({ allStatuses: true }) });
  // Tip dockets vs tip invoices, both ways (R3).
  if (q.get("mismatches") === "1") return NextResponse.json(await tipMismatches());
  // Indicators (R4): per job (tip loads, tonnes, cost, $/t, asbestos) and per truck (km, fuel, L/100 km).
  // vehicleId=<id> -> just that truck (the Vehicles register). The coordinator: jobs only.
  if (q.get("indicators") === "1") {
    const ask = indicatorsFor(tipsOnly, pick("vehicleId"));
    if (!ask.allowed) return FORBIDDEN();
    if (ask.vehicleId) return NextResponse.json({ trucks: await truckIndicatorList(ask.vehicleId) });
    return NextResponse.json(ask.trucks ? { jobs: await jobIndicators(), trucks: await truckIndicatorList() } : { jobs: await jobIndicators() });
  }
  const filters = filtersFor({ day: pick("day"), jobId: pick("jobId"), vehicleId: pick("vehicleId"), person: pick("person"), kind: pick("kind"), asbestos: pick("asbestos"), check: pick("check") }, tipsOnly);
  return NextResponse.json(await officeList(filters, { tipsOnly }));
});
