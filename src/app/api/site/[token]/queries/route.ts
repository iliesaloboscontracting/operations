import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { LINK_WHERE, linkVisible } from "@/lib/siteRequests";
import { answerQuery, assigneeView, ANSWERABLE } from "@/lib/findings/queries";

// Questions from the office on a person's own site link (Phase 2, 25 Oct
// 2026): only queries asked of this register person, only operational and
// money-free (links ride the public photos tunnel), only the question - never
// the finding behind it.
// GET  -> open questions, plus answered / closed ones from the last 7 days
// POST { id, answer, file?, fileName? } -> answer one
async function personFor(token: string) {
  const link = await resolveLink(token);
  return link && !link.shared && link.person.id && (link.kind === "SUPERVISOR" || link.kind === "OFFICE") ? link : null;
}

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await personFor(params.token);
  if (!link) return NextResponse.json({ queries: [] });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.siteRequest.findMany({
    where: { kind: "QUERY", assigneeId: link.person.id, ...LINK_WHERE, OR: [{ status: { in: [...ANSWERABLE, "ANSWERED"] } }, { updatedAt: { gte: since } }] },
    orderBy: { neededBy: "asc" },
    include: { events: { orderBy: { at: "asc" } } },
    take: 50,
  });
  return NextResponse.json({ queries: rows.filter(linkVisible).map((r) => assigneeView(r, true)) });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await personFor(params.token);
  if (!link) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const r = typeof body.id === "string" ? await prisma.siteRequest.findUnique({ where: { id: body.id } }) : null;
  if (!r || r.kind !== "QUERY" || r.assigneeId !== link.person.id || !linkVisible(r)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const out = await answerQuery(r, body, { name: link.person.name });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  return NextResponse.json({ ok: true });
});
