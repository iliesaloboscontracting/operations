import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { recordDetail } from "@/lib/siteDocs/office";

// GET -> one pre-start / toolbox talk for the printable A4 page: what was covered, the crew and the supervisor who
// signed (late sign-ons marked). Read only - a sent record is never changed (no PATCH / PUT / DELETE).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  const r = await recordDetail((await paramsP).id, g.user);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ record: r });
});