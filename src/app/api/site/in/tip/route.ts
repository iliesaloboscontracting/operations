import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readTravelPass } from "@/lib/signin";
import { assertNoMoney } from "@/lib/moneyGuard";
import { finishTipRun, startTipRun, tipRunStatus } from "@/lib/tipRun/store";

// POST /api/site/in/tip - a worker's own phone, a tip run after a regional shift (19 Nov 2026, shift rollover).
//   { pass, deviceId, action: "STATUS" | "START" | "FINISH", attendanceId? }
// Public like the rest of /api/site (it rides the existing photos tunnel route api/site/.*). The pass is the travel
// pass a real sign-in scan gave this phone (lib/signin.ts makeTravelPass) - nobody starts a tip run for someone else.
// The time is the server's. No GPS. Words, times and hours only. TIP_RUN=off refuses START (lib/tipRun/rules.ts).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
  const resourceId = readTravelPass(body.pass, deviceId);
  if (!resourceId) return send({ error: "Sign in on site once with this phone first (your supervisor's QR) - then tip runs work here." }, 401);
  const out =
    body.action === "STATUS" ? await tipRunStatus(resourceId)
    : body.action === "START" ? await startTipRun(resourceId, { attendanceId: body.attendanceId, deviceId })
    : body.action === "FINISH" ? await finishTipRun(resourceId)
    : { error: "Unknown request.", status: 400 };
  if ("error" in out && "status" in out) return send({ error: out.error }, out.status);
  return send(out, 200);
});

// Nothing with a dollar figure ever leaves on a link.
function send(x: unknown, status: number) {
  if (!assertNoMoney(JSON.stringify(x))) return NextResponse.json({ error: "Something went wrong - tell the office." }, { status: 500 });
  return NextResponse.json(x, { status });
}
