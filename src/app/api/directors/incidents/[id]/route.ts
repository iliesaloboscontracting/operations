import { NextRequest, NextResponse } from "next/server";
import { guardIncidents } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { incidentDetail } from "@/lib/siteDocs/incidents";

// GET -> one incident report (printable) with its follow-up notes. The owner and DIRECTOR logins only. A sent report is
// never changed (no PATCH / PUT / DELETE) - follow-up is POST /api/directors/incidents/:id/events.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardIncidents();
  if ("denied" in g) return g.denied;
  const d = await incidentDetail((await paramsP).id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ incident: d }, { headers: { "Cache-Control": "no-store" } }); // SD-004
});