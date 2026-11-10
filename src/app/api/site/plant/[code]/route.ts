import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { linkSafe } from "@/lib/receipts/rules";
import { scanPlant } from "@/lib/prestart/plant";

// GET /api/site/plant/:code -> { ticket, machine, crew } - a phone has scanned a machine's pre-start QR (stage 2,
// 10 Nov 2026). Public, like the rest of /api/site (rides the photos tunnel's api/site/.* route). Never a sign-in: the
// ticket is a plant ticket, which the sign-in routes refuse. Names only - no money, nothing else from Operations.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ code: string }> }) => {
  const params = await paramsP;
  const out = await scanPlant(decodeURIComponent(params.code));
  const status = "error" in out ? out.status : 200;
  const body = "error" in out ? { error: out.error } : out;
  return linkSafe(body) ? NextResponse.json(body, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });
});
