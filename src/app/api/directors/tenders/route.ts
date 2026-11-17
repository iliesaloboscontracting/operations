import { NextRequest, NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadBoard } from "@/lib/tenders/board";
import { isIsoDate } from "@/lib/tenders/rules";

// GET /api/directors/tenders?from&to -> the Directors "Tenders" tab (17 Nov 2026): Estimating's tender register via
// tenders-board.v1, server to server. Director access only - prices included (Ilies: prices are for directors).
// Not switched on / not reachable / refused -> { state } and no figures.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return NextResponse.json({ error: "Pick valid dates." }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
  const s = await loadBoard({ from: from ?? undefined, to: to ?? undefined });
  if (s.state !== "OK") return NextResponse.json(s.state === "REFUSED" ? { state: s.state, status: s.status, code: s.code } : { state: s.state });
  return NextResponse.json({ state: "OK", board: s.board });
});
