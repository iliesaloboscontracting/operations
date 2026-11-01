import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { recordSend, lastSent } from "@/lib/boardGuard/store";

// POST /api/board/sends { date, how: COPY | EMAIL } -> the day's sheet went out from the board's Export (allocation
// guard, 2 Nov 2026). The server takes its own copy of what the board holds for that day - nothing from the browser is
// stored but the day and how it went. Returns the day's send info, as GET /api/board/check does.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date=YYYY-MM-DD is required" }, { status: 400 });
  const how = body.how === "EMAIL" ? "EMAIL" : body.how === "COPY" ? "COPY" : null;
  if (!how) return NextResponse.json({ error: "how must be COPY or EMAIL" }, { status: 400 });
  await recordSend(user!, date, how);
  return NextResponse.json({ sent: await lastSent(date) }, { status: 201 });
});
