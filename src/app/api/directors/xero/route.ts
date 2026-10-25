import { NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { xeroStatus } from "@/lib/xero/live/service";

// GET /api/directors/xero -> the live Xero connection's status (G3): set up
// or not, connected organisation, last read, last problem. Director access.
// Never a token or a key.
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  return NextResponse.json(await xeroStatus((await getCurrentUser())!));
});
