import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { answerQuery, assigneeView } from "@/lib/findings/queries";
import { markRead } from "@/lib/infoRequests/store";
import { readJsonBody } from "@/lib/jsonBody";
import { UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";

// POST /api/queries/:id { answer, file?, fileName? } -> the person asked
// answers. { action: "READ" } marks an FYI read (Task I). Only the login it
// was asked of; an answer then waits on Ilies. Never changes any record.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id } });
  if (!r || r.kind !== "QUERY" || r.assigneeUserId !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // 7 MB a file; a body too big to read (over Next's 10 MB limit) is 413 "Too large (7 MB per file)" (2 Nov 2026).
  const read = await readJsonBody(req, UPLOAD_TOO_LARGE);
  if ("denied" in read) return read.denied;
  const body = read.b;
  const out = body.action === "READ" ? await markRead(r, { name: user.name, id: user.id }) : await answerQuery(r, body, { name: user.name, userId: user.id });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  const fresh = await prisma.siteRequest.findUnique({ where: { id: r.id }, include: { events: { orderBy: { at: "asc" } } } });
  return NextResponse.json({ query: assigneeView(fresh!, false) });
});
