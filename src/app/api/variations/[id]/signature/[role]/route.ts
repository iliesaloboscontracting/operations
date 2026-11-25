import { NextRequest, NextResponse } from "next/server";
import { guardVariations } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { signaturePng } from "@/lib/variations/store";

// GET /api/variations/:id/signature/customer|lobos -> the finger signature (PNG) - Managers, Admins and the
// coordinator only, never public and never on a link. Not cached by anything shared.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; role: string }> }) => {
  const g = await guardVariations();
  if ("denied" in g) return g.denied;
  const { id, role } = await paramsP;
  const png = await signaturePng(id, role.toUpperCase());
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
  });
});
