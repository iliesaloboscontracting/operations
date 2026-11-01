import { NextRequest, NextResponse } from "next/server";
import { guardOrCoordinator } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // the coordinator gets no dollar figure (2 Nov 2026)
import { withErrorHandling } from "@/lib/apiHandler";
import { docketsForDay } from "@/lib/receipts/indicatorStore";

// GET /api/day-review/dockets?date=YYYY-MM-DD -> tip dockets sent for each of that day's jobs (Receipts
// R4): how many, tonnes read so far, asbestos loads, how many still to read or check. Viewer+ like Day
// Review - no prices (money-guarded).
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("VIEWER");
  if (denied) return denied;
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date is required" }, { status: 400 });
  return viewJson(await docketsForDay(date));
});
