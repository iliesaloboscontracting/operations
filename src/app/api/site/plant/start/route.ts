import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { linkSafe } from "@/lib/receipts/rules";
import { startPlantCheck } from "@/lib/prestart/plant";

// POST /api/site/plant/start { ticket, kind: PRE | POST, resourceId? | hire?: { name, company }, deviceId? }
//   -> { token, kind }  (stage 2, 10 Nov 2026)
// Start of shift (PRE) / End of shift (POST) on a machine's pre-start QR: a check session and its 2-hour token, used
// with the same /api/site/in/prestart routes as trucks. Not a sign-in. 40 a QR and 12 a phone a Sydney day.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const out = await startPlantCheck(body && typeof body === "object" ? body : {});
  const status = "error" in out ? out.status : 201;
  const reply = "error" in out ? { error: out.error } : out;
  return linkSafe(reply) ? NextResponse.json(reply, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });
});
