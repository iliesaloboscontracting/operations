import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { boardCheck } from "@/lib/boardGuard/store";

// GET /api/board/check?date=YYYY-MM-DD&purpose=edit|send|status (allocation guard, 2 Nov 2026) -> { prompt, sent }.
// prompt: "did you mean another day?" before the first change to a day (edit) or before its sheet goes out (send), or
// null. sent: the day's last sheet sent - when, by whom - and what has changed on the board since. status: sent only
// (the banner, after each change - BG-005). Anyone who can open the board (Viewers export sheets too); one-page logins
// (Timesheets, Director, Accounts) are refused by guard().
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isISODate(date)) return NextResponse.json({ error: "date must be a real YYYY-MM-DD date" }, { status: 400 });
  const p = req.nextUrl.searchParams.get("purpose");
  const purpose = p === "send" ? "send" : p === "status" ? "status" : "edit";
  return NextResponse.json(await boardCheck(user!.id, date, purpose));
});
