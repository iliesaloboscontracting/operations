import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { answerQuery, assigneeView } from "@/lib/findings/queries";
import { markRead } from "@/lib/infoRequests/store";

// POST /api/queries/:id { answer, file?, fileName? } -> the person asked
// answers. { action: "READ" } marks an FYI read (Task I). Only the login it
// was asked of; an answer then waits on Ilies. Never changes any record.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id } });
  if (!r || r.kind !== "QUERY" || r.assigneeUserId !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = body.action === "READ" ? await markRead(r, { name: user.name, id: user.id }) : await answerQuery(r, body, { name: user.name, userId: user.id });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  const fresh = await prisma.siteRequest.findUnique({ where: { id: r.id }, include: { events: { orderBy: { at: "asc" } } } });
  return NextResponse.json({ query: assigneeView(fresh!, false) });
});
