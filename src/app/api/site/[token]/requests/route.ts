import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { savePhoto } from "@/lib/toolPhotos";
import { createRequest, siteView, sitesFor } from "@/lib/siteRequests";
import { OPEN_STATUSES } from "@/lib/requestTypes";
import { notifyNewRequest } from "@/lib/requestAlerts";
import { suggestInBackground } from "@/lib/requestReminders";

// Site requests from a supervisor's link (or a stand-in's one-day hand-over
// link) - 21 Oct 2026.
// GET  -> their requests (open ones, plus anything from the last 14 days) and
//         the sites they can ask for
// POST { kind, priority, neededBy, projectId, details, note?, photo? (data URL), who? }
const DAILY_LIMIT = 40;

async function linkFor(token: string) {
  const link = await resolveLink(token);
  if (!link) return { res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  if (link.kind === "OFFICE") return { res: NextResponse.json({ error: "Requests are made from a supervisor's link." }, { status: 403 }) };
  return { link };
}

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const { link, res } = await linkFor(params.token);
  if (!link) return res;
  const since = new Date(Date.now() - 14 * 86_400_000);
  const mine = link.person.id && !link.shared ? { OR: [{ siteLinkId: link.id }, { requestedById: link.person.id }] } : { siteLinkId: link.id };
  const [requests, sites] = await Promise.all([
    prisma.siteRequest.findMany({
      where: { AND: [mine, { OR: [{ status: { in: OPEN_STATUSES } }, { updatedAt: { gte: since } }] }] },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { events: { orderBy: { at: "asc" } } },
    }),
    sitesFor(link),
  ]);
  return NextResponse.json({ requests: requests.map(siteView), sites });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const { link, res } = await linkFor(params.token);
  if (!link) return res;
  const today = await prisma.siteRequest.count({ where: { siteLinkId: link.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= DAILY_LIMIT) return NextResponse.json({ error: "That's the most requests this link can send in a day - call the office." }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  let photoFile: string | null = null;
  if (body.photo) {
    const saved = await savePhoto(body.photo);
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
    photoFile = saved.fileName;
  }
  const out = await createRequest(link, body, photoFile);
  if ("error" in out || !out.request) return NextResponse.json({ error: out.error ?? "Couldn't send it." }, { status: 400 });
  await notifyNewRequest(out.request);
  suggestInBackground(out.request.id);
  return NextResponse.json({ request: siteView(out.request) }, { status: 201 });
});
