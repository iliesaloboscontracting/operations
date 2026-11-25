import { NextRequest, NextResponse } from "next/server";
import { guardVariations } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { AGENT_NO_FILES } from "@/lib/variations/rules";
import { isAgent, signaturePng } from "@/lib/variations/store";

// GET /api/variations/:id/signature/customer|lobos -> the finger signature (PNG) - Managers, Admins and the
// coordinator only, never public and never on a link; never the Building Agent login (VD-002). Not cached by anything
// shared, and served so a browser can only ever show it as an image (VD-004: a sandboxing CSP, nosniff).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string; role: string }> }) => {
  const g = await guardVariations();
  if ("denied" in g) return g.denied;
  if (isAgent(g.user)) return NextResponse.json({ error: AGENT_NO_FILES }, { status: 403 });
  const { id, role } = await paramsP;
  const png = await signaturePng(id, role.toUpperCase());
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
