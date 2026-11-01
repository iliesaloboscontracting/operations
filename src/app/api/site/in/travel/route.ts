import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readTravelPass } from "@/lib/signin";
import { assertNoMoney } from "@/lib/moneyGuard";
import { arrive, startHome, startOut, travelStatus } from "@/lib/travel/store";

// POST /api/site/in/travel - a worker's own phone, travelling to or from a regional job (2 Nov 2026).
//   { pass, deviceId, action: "STATUS" | "START_OUT" | "START_HOME" | "ARRIVED", jobId?, gps? }
// Public like the rest of /api/site (it rides the existing photos tunnel route api/site/.*). The pass is what a real
// sign-in scan gave this phone (lib/signin.ts makeTravelPass) - nobody starts travel for someone else. The time is
// the server's; one quiet GPS point at the start (and at Arrived), accounts / Admins only. Words and times only.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 64) : "";
  const resourceId = readTravelPass(body.pass, deviceId);
  if (!resourceId) return send({ error: "Sign in on site once with this phone first - then travel works here." }, 401);
  const out =
    body.action === "STATUS" ? await travelStatus(resourceId)
    : body.action === "START_OUT" ? await startOut(resourceId, { jobId: body.jobId, gps: body.gps, deviceId })
    : body.action === "START_HOME" ? await startHome(resourceId, { gps: body.gps, deviceId })
    : body.action === "ARRIVED" ? await arrive(resourceId, { gps: body.gps })
    : { error: "Unknown request.", status: 400 };
  if ("error" in out && "status" in out) return send({ error: out.error }, out.status);
  return send(out, 200);
});

// Nothing with a dollar figure ever leaves on a link.
function send(x: unknown, status: number) {
  if (!assertNoMoney(JSON.stringify(x))) return NextResponse.json({ error: "Something went wrong - tell the office." }, { status: 500 });
  return NextResponse.json(x, { status });
}
