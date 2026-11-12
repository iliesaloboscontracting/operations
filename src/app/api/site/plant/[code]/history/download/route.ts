import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { openQr } from "@/lib/prestart/historyGate";
import { machineHistory } from "@/lib/prestart/historyStore";
import { historyFile, historyParams } from "@/lib/prestart/historyResponse";
import { oneDownload } from "@/lib/prestart/viewLimit";

// GET /api/site/plant/:code/history/download?what=checks|service&days=7|30|90&format=pdf|csv (12 Nov 2026)
// The pre-start records (for the range) or the service history as a PDF (made on the server) or a CSV. The same QR
// lookup as the view; 20 downloads a QR an hour, one at a time. No money - the data passes linkSafe before the file.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ code: string }> }) => {
  const q = await openQr(req, (await paramsP).code, "download");
  if ("error" in q) return NextResponse.json({ error: q.error }, { status: q.status });
  const { days, what, format } = historyParams(req.nextUrl.searchParams);
  const out = await oneDownload(q.linkId, async () => {
    const h = await machineHistory(q.machineId, days);
    return h ? historyFile(h, what, format) : NextResponse.json({ error: "This pre-start QR isn't active. Ask the office." }, { status: 404 });
  });
  return out instanceof NextResponse ? out : NextResponse.json({ error: out.error }, { status: out.status });
});
