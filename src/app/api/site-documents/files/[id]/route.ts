import { NextRequest, NextResponse } from "next/server";
import { guardSiteDocs } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { officeFile } from "@/lib/siteDocs/office";
import { fileReply } from "@/lib/siteDocs/replies";

// GET -> an office file (plan, SWMS version - archived and superseded ones too - or a topic PDF), inline with its real
// type, nosniff, a safe name and a CSP that runs nothing. Managers, Admins and the coordinator. Never deleted: there's
// no DELETE / PATCH / PUT - archiving is POST /api/site-documents/files/:id/archive.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const g = await guardSiteDocs();
  if ("denied" in g) return g.denied;
  const f = await officeFile((await paramsP).id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  return fileReply(f.bytes, f.mime, f.name);
});