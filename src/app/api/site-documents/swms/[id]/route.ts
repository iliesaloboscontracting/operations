import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isAgent, swmsRegister } from "@/lib/siteDocs/office";

// GET -> one SWMS version's sign-on register: who signed and when (crew and supervisor), and - for the current version -
// who is on site today and hasn't signed it. The printable A4 sign-on sheet reads this. Managers, Admins and the
// coordinator (the Building Agent login gets the names, never the signatures: signaturesHidden).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  const r = await swmsRegister((await paramsP).id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...r, signaturesHidden: isAgent(g.user) });
});