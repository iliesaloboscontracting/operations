import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { searchPlantPeople } from "@/lib/prestart/plant";

// GET /api/site/plant/search?ticket=&q= - names from the Personnel register for someone not on the operators' list
// (3+ letters, at most 6). Needs a valid plant ticket (a sign-in ticket doesn't do).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const out = await searchPlantPeople(req.nextUrl.searchParams.get("ticket"), req.nextUrl.searchParams.get("q") ?? "");
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
