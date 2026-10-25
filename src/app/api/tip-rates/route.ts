import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addRate, listRates } from "@/lib/receipts/tipStore";

// Tip rates (Receipts R3): $/tonne ex GST per tip site and waste type, by the date they start.
// GET  -> every rate (in force, superseded, retired) and the site + waste combinations on dockets
//         that no rate covers yet. Manager+ (money: never a Viewer, never a link).
// POST { tipSite, wasteType, ratePerTonneExGst, validFrom, source, note? } -> a new rate. Admin only;
//         a price change is a new rate with a later start date (the old one stays as history).
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  return NextResponse.json(await listRates());
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("ADMIN");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const out = await addRate({ name: user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
