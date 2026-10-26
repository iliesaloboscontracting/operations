import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { pushPublicKey } from "@/lib/push";

// Phone alerts for site requests - Admin only (Ilies is the one who decides).
// GET    -> { publicKey, devices }   the key the browser subscribes with
// POST   { subscription, label }    this phone/browser wants alerts
// DELETE { endpoint }               this phone/browser stops them
// Since 26 Oct 2026 the accounts login can turn on its own phone for due-date alerts too.
async function guardPush() {
  const user = await getCurrentUser();
  if (user?.role === "ACCOUNTS") return null;
  return guard("ADMIN");
}

export const GET = withErrorHandling(async () => {
  const denied = await guardPush();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const devices = await prisma.pushDevice.findMany({
    where: { userId: user.id },
    select: { id: true, endpoint: true, label: true, createdAt: true, lastSentAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ publicKey: pushPublicKey(), devices });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardPush();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const sub = body.subscription ?? {};
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub.keys?.auth === "string" ? sub.keys.auth : "";
  if (!/^https:\/\/\S{10,1000}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: "That browser didn't give a usable notification address." }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : null;
  await prisma.pushDevice.upsert({
    where: { endpoint },
    update: { userId: user.id, p256dh, auth, label, failures: 0 },
    create: { userId: user.id, endpoint, p256dh, auth, label },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardPush();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  if (typeof body.endpoint === "string") await prisma.pushDevice.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
});
