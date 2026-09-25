import { NextRequest, NextResponse } from "next/server";
import { upcomingStarts } from "@/lib/alerts";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// GET /api/alerts?date=YYYY-MM-DD&days=7 -> projects starting within the window
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD is required" }, { status: 400 });
  }
  const days = Number(req.nextUrl.searchParams.get("days") ?? 7) || 7;
  return NextResponse.json(await upcomingStarts(date, days));
});
