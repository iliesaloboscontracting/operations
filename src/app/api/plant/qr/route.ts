import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { makePlantQr, plantQrs } from "@/lib/prestart/plant";

// Plant pre-start QR stickers (stage 2, Ilies 10 Nov 2026) - Managers and Admins, from the Plant page.
// GET  -> [{ resourceId, createdAt, createdBy }]    the machines with a QR switched on
// POST { resourceId } -> { url, title, subtitle }   a new QR (shown once, to print); the old one stops at once
// POST { resourceId, off: true } -> { ok }          switch it off
// Lobos-owned plant only (Resource EQUIPMENT, OWNED) - not attachments, not hired plant.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  return NextResponse.json(await plantQrs());
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const out = await makePlantQr(body?.resourceId, body?.off === true, user?.name ?? null, req.nextUrl.origin);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: "url" in out ? 201 : 200 });
});
