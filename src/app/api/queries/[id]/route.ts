import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { answerQuery, assigneeView } from "@/lib/findings/queries";

// POST /api/queries/:id { answer, file?, fileName? } -> the person asked
// answers. Only the login it was asked of; then it waits on Ilies.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = await prisma.siteRequest.findUnique({ where: { id: params.id } });
  if (!r || r.kind !== "QUERY" || r.assigneeUserId !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const out = await answerQuery(r, await req.json().catch(() => ({})), { name: user.name, userId: user.id });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  const fresh = await prisma.siteRequest.findUnique({ where: { id: r.id }, include: { events: { orderBy: { at: "asc" } } } });
  return NextResponse.json({ query: assigneeView(fresh!, false) });
});
