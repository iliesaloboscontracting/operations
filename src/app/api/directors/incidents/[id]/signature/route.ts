import { NextRequest, NextResponse } from "next/server";
import { guardIncidents } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { incidentSignature } from "@/lib/siteDocs/incidents";
import { pngReply } from "@/lib/siteDocs/replies";

// GET -> the supervisor's signature on an incident report (PNG) - the owner and DIRECTOR logins only.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardIncidents();
  if ("denied" in g) return g.denied;
  const png = await incidentSignature((await paramsP).id);
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
  return pngReply(png);
});