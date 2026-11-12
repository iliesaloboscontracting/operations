import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { openQr } from "@/lib/prestart/historyGate";
import { machineHistory } from "@/lib/prestart/historyStore";
import { historyJson, historyParams } from "@/lib/prestart/historyResponse";

// GET /api/site/plant/:code/history?days=7|30|90 -> the machine's checks & service history (Ilies, 12 Nov 2026) - for
// the builder's site manager or anyone holding the sticker; no name needed. Read-only. Public like the rest of
// /api/site (rides the photos tunnel's api/site/.* route - no Cloudflare change). The QR code is the only key: a bad,
// switched-off or reprinted code is 404. 60 looks a QR in 10 minutes (viewLimit.ts). No money (linkSafe), no
// coordinates, phones or device ids, no photos, nothing of any other machine.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ code: string }> }) => {
  const q = await openQr(req, (await paramsP).code, "view");
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: q.status });
  const h = await machineHistory(q.machineId, historyParams(req.nextUrl.searchParams).days);
  if (!h) return NextResponse.json({ error: "This pre-start QR isn't active. Ask the office." }, { status: 404 });
  return historyJson(h);
});
