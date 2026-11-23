import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveReceiptLink } from "@/lib/siteLinks";
import { assertNoMoney } from "@/lib/moneyGuard";
import { crewMessages, markSeen } from "@/lib/signinMessages/store";

// Message at sign-in (23 Nov 2026) - a person's own SUPERVISOR or DRIVER link home shows their messages too, with the
// same "Got it" (seen once overall). Only those two kinds (resolveReceiptLink: a person's own link); never an OFFICE,
// HANDOVER or POSTER link - they answer 404 here. SM-001: the link's secret is the person's own, so their messages to
// them (PEOPLE) show here as well as the "everyone" ones (knownDevice: true).
//
// GET  -> { messages: [{ id, text, sent }] }
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await params).token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const body = { messages: await crewMessages({ resourceId: link.person.id }, { knownDevice: true }) };
  if (!assertNoMoney(JSON.stringify(body))) return NextResponse.json({ messages: [] });
  return NextResponse.json(body);
});

// POST { messageId, deviceId? } -> "Got it".
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await params).token);
  if (!link) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (typeof b?.messageId !== "string" || !b.messageId) return NextResponse.json({ error: "Which message?" }, { status: 400 });
  const out = await markSeen(b.messageId, { resourceId: link.person.id }, { deviceId: typeof b.deviceId === "string" ? b.deviceId : null, where: "LINK", knownDevice: true, siteLinkId: link.id });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});
