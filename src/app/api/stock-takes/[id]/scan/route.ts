import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { viewJson } from "@/lib/coordinatorView"; // no amount reaches the coordinator / yard computer
import { withErrorHandling } from "@/lib/apiHandler";
import { VisionNotConfigured } from "@/lib/toolVision";
import { scanShelf } from "@/lib/stockTake/store";

// POST /api/stock-takes/:id/scan { photoIds } - "Scan a shelf": 1-4 CHECK photos (uploaded first through
// /api/tools/photos, as a toolbox check does), read by the toolbox check's photo reading (the existing Claude call - no
// new connection) and matched in plain code. Tools it identifies are ticked found (via PHOTO - anyone can undo);
// tools the register has in a toolbox become extras; the rest are listed. SCAN_LIMIT readings per stock take.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const id = (await paramsP).id;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  try {
    const out = await scanShelf(id, body.photoIds, { id: user.id, name: user.name, role: user.role });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    return viewJson(out);
  } catch (e) {
    if (e instanceof VisionNotConfigured) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
});
