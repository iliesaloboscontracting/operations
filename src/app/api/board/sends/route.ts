import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { recordSend, lastSent, sendDateProblem } from "@/lib/boardGuard/store";

// POST /api/board/sends { date, how: COPY | EMAIL } -> the day's sheet went out from the board's Export (allocation
// guard, 2 Nov 2026). The server takes its own copy of what the board holds for that day - nothing from the browser is
// stored but the day and how it went. BG-001: a day from a week back to two weeks ahead only; the same person's repeat
// within 2 minutes is the same send; at most 30 a day each (429). Returns the day's send info, as GET /api/board/check.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("VIEWER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const problem = sendDateProblem(body.date);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const how = body.how === "EMAIL" ? "EMAIL" : body.how === "COPY" ? "COPY" : null;
  if (!how) return NextResponse.json({ error: "how must be COPY or EMAIL" }, { status: 400 });
  const r = await recordSend(user!, body.date, how);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ sent: await lastSent(body.date) }, { status: 201 });
});
