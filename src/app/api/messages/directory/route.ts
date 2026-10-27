import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { directory } from "@/lib/messages/store";
import { appViewer } from "@/lib/messages/who";

// GET /api/messages/directory -> who this login can start a one-to-one with: every other active office login (Operations
// AI by that name). Names and roles only.
export const GET = withErrorHandling(async () => {
  const v = await appViewer();
  if ("denied" in v) return v.denied;
  return NextResponse.json(await directory(v.me));
});
