import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeMachineHistory } from "@/lib/prestart/historyStore";
import { historyFile, historyParams } from "@/lib/prestart/historyResponse";

// GET /api/plant/:id/history/download?what=checks|service&days=7|30|90&format=pdf|csv (12 Nov 2026) - the same files
// as the QR's download, on the Plant page. Managers and Admins.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const { days, what, format } = historyParams(req.nextUrl.searchParams);
  const h = await officeMachineHistory((await paramsP).id, days);
  if (!h) return NextResponse.json({ error: "That isn't a plant item." }, { status: 404 });
  return historyFile(h, what, format);
});
