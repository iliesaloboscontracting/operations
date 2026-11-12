import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeMachineHistory } from "@/lib/prestart/historyStore";
import { historyJson, historyParams } from "@/lib/prestart/historyResponse";

// GET /api/plant/:id/history?days=7|30|90 -> the same checks & service history the machine's QR shows (12 Nov 2026),
// on the Plant page - Managers and Admins. Plant and attachments only. The same DTO: no money even here.
export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const h = await officeMachineHistory((await paramsP).id, historyParams(req.nextUrl.searchParams).days);
  if (!h) return NextResponse.json({ error: "That isn't a plant item." }, { status: 404 });
  return historyJson(h);
});
