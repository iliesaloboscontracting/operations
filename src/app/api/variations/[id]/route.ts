import { NextRequest, NextResponse } from "next/server";
import { guardVariations } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeDetail } from "@/lib/variations/store";

// GET /api/variations/:id -> one signed docket for the printable page, with its office status history.
// Managers, Admins and the coordinator only. Read-only: a sent docket is never changed (no PATCH / PUT / DELETE) -
// the office status is its own record (POST /api/variations/:id/status).
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardVariations();
  if ("denied" in g) return g.denied;
  const d = await officeDetail((await paramsP).id, g.user);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ docket: d });
});
