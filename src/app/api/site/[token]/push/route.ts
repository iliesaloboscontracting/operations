import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { pushPublicKey } from "@/lib/push";
import { isPushHost } from "@/lib/pushHost";

// Phone alerts on a supervisor's link (24 Oct 2026) - e.g. the 20-minute
// "still signed in" reminder. Supervisor and one-day hand-over links only.
// GET -> { publicKey }   POST { subscription, label }   DELETE { endpoint }
async function linkFor(token: string) {
  const link = await resolveLink(token);
  return link && (link.kind === "SUPERVISOR" || link.kind === "HANDOVER") ? link : null;
}

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await linkFor(params.token);
  if (!link) return NextResponse.json({ error: "Alerts are for supervisors' links." }, { status: 404 });
  return NextResponse.json({ publicKey: pushPublicKey() });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await linkFor(params.token);
  if (!link) return NextResponse.json({ error: "Alerts are for supervisors' links." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const sub = body.subscription ?? {};
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub.keys?.auth === "string" ? sub.keys.auth : "";
  // SEC-013: only a real browser push service (lib/pushHost.ts) - never another server we'd then send requests to.
  if (!/^https:\/\/\S{10,1000}$/.test(endpoint) || !isPushHost(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: "That phone didn't give a usable notification address." }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : null;
  // Max 5 phones per link - enough for a phone or two, not a mailing list.
  const count = await prisma.siteLinkPushDevice.count({ where: { siteLinkId: link.id, NOT: { endpoint } } });
  if (count >= 5) return NextResponse.json({ error: "Too many phones on this link - ask the office." }, { status: 400 });
  await prisma.siteLinkPushDevice.upsert({
    where: { endpoint },
    update: { siteLinkId: link.id, p256dh, auth, label, failures: 0 },
    create: { siteLinkId: link.id, endpoint, p256dh, auth, label },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await linkFor(params.token);
  if (!link) return NextResponse.json({ error: "Alerts are for supervisors' links." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.endpoint === "string") await prisma.siteLinkPushDevice.deleteMany({ where: { endpoint: body.endpoint, siteLinkId: link.id } });
  return NextResponse.json({ ok: true });
});
